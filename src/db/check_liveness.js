// ============================================================================
// LIVENESS CHECK — verify deal listings still exist on the source portal.
// ----------------------------------------------------------------------------
// `properties` accumulates history and never auto-removes; many old listings are
// already sold/delisted. This fetches each lead's URL and marks dead ones
// is_active=false + delisted_at, so the dashboard stops surfacing dead links.
// Conservative: only deactivates on clear signals (404/410, explicit removal
// text, or redirect away from the detail page) — never on uncertainty.
//
// Run:  node src/db/check_liveness.js          (checks all current leads A/B/C)
//       node src/db/check_liveness.js --all     (checks every active listing)
// ============================================================================

const supabase = require('./client');
const axios = require('axios');

const CONCURRENCY = 6;
const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Removal markers — SPECIFIC phrases only (diacritics-stripped, lowercased).
// Loose tokens like "404" / "vyprsel" / "prodano" were removed: they appear in
// live pages (assets, agent text) and caused false positives.
const DEAD_MARKERS = [
    'byl odstranen', 'byla odstranena', 'byl smazan', 'byla smazana', 'jiz byl smazan',
    'jiz neni aktivni', 'jiz neni k dispozici', 'inzerat nenalezen', 'inzerat neexistuje',
    'nabidka jiz neni', 'nabidka neexistuje', 'byl deaktivovan', 'byla deaktivovana',
    'platnost inzeratu vyprsela', 'inzerat byl ukoncen', 'tento inzerat byl'
];

function strip(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function looksDead(portal, status, finalUrl, body) {
    if (status === 404 || status === 410) return true;
    const b = strip(body);
    if (DEAD_MARKERS.some(m => b.includes(m))) return true;
    // redirected away from a detail page (e.g. back to a category/listing index)
    if (finalUrl) {
        const f = finalUrl.toLowerCase();
        if (portal === 'bazos' && !f.includes('/inzerat/')) return true;
        if (portal === 'annonce' && !f.includes('/inzerat/')) return true;
        if (portal === 'avizo' && !/\/reality\/.+\d/.test(f)) return true;
    }
    // suspiciously tiny page = error/placeholder (only very small)
    if (body && body.length < 200) return true;
    return false;
}

async function checkOne(row) {
    try {
        const resp = await axios.get(row.url, {
            timeout: TIMEOUT_MS, maxRedirects: 5, validateStatus: () => true,
            headers: { 'User-Agent': UA, 'Accept-Language': 'cs,en;q=0.8' }
        });
        const finalUrl = resp.request?.res?.responseUrl || resp.request?.responseURL || row.url;
        const dead = looksDead(row.portal, resp.status, finalUrl, typeof resp.data === 'string' ? resp.data : '');
        return { id: row.id, dead };
    } catch (e) {
        // network/timeouts: do NOT deactivate (could be transient) — leave as-is
        return { id: row.id, dead: false, error: e.code || e.message };
    }
}

async function runPool(rows, worker) {
    const results = [];
    let i = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (i < rows.length) {
            const idx = i++;
            results.push(await worker(rows[idx]));
        }
    });
    await Promise.all(workers);
    return results;
}

async function run() {
    const all = process.argv.includes('--all');
    console.log(`=== LIVENESS CHECK (${all ? 'all active listings' : 'current leads'}) ===`);

    let query = supabase.from('properties').select('id, url, portal')
        .eq('is_active', true).not('url', 'is', null);
    if (!all) query = query.not('lead_tier', 'is', null);

    const { data, error } = await query.limit(2000);
    if (error) throw new Error(error.message);
    console.log(`Checking ${data.length} listings...`);

    const results = await runPool(data, checkOne);
    const dead = results.filter(r => r.dead);

    // Deactivate dead ones
    const now = new Date().toISOString();
    let n = 0;
    for (const d of dead) {
        const { error: e } = await supabase.from('properties')
            .update({ is_active: false, delisted_at: now }).eq('id', d.id);
        if (!e) n++;
    }

    console.log(`Dead/removed: ${dead.length}  ->  deactivated ${n}.`);
    console.log(`Still live: ${results.length - dead.length}.`);
}

if (require.main === module) {
    run().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { run, looksDead, checkOne };
