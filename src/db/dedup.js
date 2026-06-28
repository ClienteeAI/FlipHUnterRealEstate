// ============================================================================
// CROSS-PORTAL DEDUP — the same flat often sits on annonce + avizo + bazos at
// once (or is re-listed). Collapse exact matches so the dashboard shows it once.
// Key = phone + area + disposition + price-bucket (all four equal = same flat).
// Keeps the best copy (owner > earliest > cheapest); marks the rest as duplicate
// (lead_tier=null, eval_status='duplicate') so they drop out of the dashboard.
// Uses existing columns only. Run after evaluate.
//
//   node src/db/dedup.js
// ============================================================================

const supabase = require('./client');
const PAGE = 1000;
const CHUNK = 100;

function normPhone(p) { let s = String(p || '').replace(/\D/g, ''); if (s.length > 9) s = s.slice(-9); return s; }

async function loadActive() {
    let all = [], from = 0;
    for (;;) {
        const { data, error } = await supabase.from('properties')
            .select('id, contact_phone, area_m2, disposition, price_numeric, is_agent, first_seen_at, lead_tier')
            .eq('is_active', true).order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data.length) break;
        all = all.concat(data); from += PAGE;
        if (data.length < PAGE) break;
    }
    return all;
}

async function dedup() {
    console.log('=== CROSS-PORTAL DEDUP ===');
    const rows = await loadActive();

    const groups = {};
    for (const r of rows) {
        const phone = normPhone(r.contact_phone);
        if (phone.length !== 9 || !r.area_m2 || !r.price_numeric || !r.disposition) continue;
        const bucket = Math.round(r.price_numeric / 10000);   // ±~10k tolerance
        const key = `${phone}|${r.area_m2}|${r.disposition}|${bucket}`;
        (groups[key] ||= []).push(r);
    }

    const dupIds = [];
    for (const key in groups) {
        const g = groups[key];
        if (g.length < 2) continue;
        // best copy: owner first, then earliest seen, then cheapest
        g.sort((a, b) =>
            (a.is_agent - b.is_agent) ||
            (new Date(a.first_seen_at) - new Date(b.first_seen_at)) ||
            (a.price_numeric - b.price_numeric));
        for (const r of g.slice(1)) if (r.lead_tier !== null) dupIds.push(r.id);
    }

    console.log(`Groups: ${Object.keys(groups).length} | duplicate copies to hide: ${dupIds.length}`);
    let done = 0;
    for (let i = 0; i < dupIds.length; i += CHUNK) {
        const chunk = dupIds.slice(i, i + CHUNK);
        const { error } = await supabase.from('properties')
            .update({ lead_tier: null, eval_status: 'duplicate', reject_reason: 'Duplicita (stejná nemovitost na jiném portálu)' })
            .in('id', chunk);
        if (!error) done += chunk.length;
    }
    console.log(`Hidden ${done} duplicate listings.`);
}

if (require.main === module) {
    dedup().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { dedup };
