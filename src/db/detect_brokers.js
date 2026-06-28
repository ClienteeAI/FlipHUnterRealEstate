// ============================================================================
// BROKER DETECTION — flag is_agent=true for phones used on multiple listings.
// ----------------------------------------------------------------------------
// A phone number that appears on >= THRESHOLD listings is a broker/agency, not a
// private owner. Only upgrades owner→broker (never the reverse), so it can't
// wrongly demote a real broker that the old logic already caught.
//
// Run:  node src/db/detect_brokers.js
// ============================================================================

const supabase = require('./client');

const THRESHOLD = 2;          // phone on >= this many listings = broker
const PAGE = 1000;
const UPDATE_CHUNK = 100;

function normPhone(p) {
    let s = String(p || '').replace(/\D/g, '');
    if (s.length > 9) s = s.slice(-9);
    return s;
}

async function loadAll() {
    let all = [], from = 0;
    for (;;) {
        const { data, error } = await supabase.from('properties')
            .select('id, contact_phone, is_agent').order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data.length) break;
        all = all.concat(data);
        from += PAGE;
        if (data.length < PAGE) break;
    }
    return all;
}

async function detectBrokers() {
    console.log('=== BROKER DETECTION (phone frequency) ===');
    const rows = await loadAll();

    const counts = {};
    for (const r of rows) {
        const n = normPhone(r.contact_phone);
        if (n.length === 9) counts[n] = (counts[n] || 0) + 1;
    }
    const brokerPhones = new Set(Object.keys(counts).filter(p => counts[p] >= THRESHOLD));

    // listings currently "owner" but on a broker phone → flip to broker
    const toFlag = rows
        .filter(r => !r.is_agent && brokerPhones.has(normPhone(r.contact_phone)))
        .map(r => r.id);

    console.log(`Broker phones: ${brokerPhones.size} | listings to fix (owner→broker): ${toFlag.length}`);

    let updated = 0;
    for (let i = 0; i < toFlag.length; i += UPDATE_CHUNK) {
        const chunk = toFlag.slice(i, i + UPDATE_CHUNK);
        const { error } = await supabase.from('properties').update({ is_agent: true }).in('id', chunk);
        if (error) console.warn('Update error:', error.message);
        else updated += chunk.length;
    }
    console.log(`Done. Flagged ${updated} listings as broker.`);
}

if (require.main === module) {
    detectBrokers().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { detectBrokers };
