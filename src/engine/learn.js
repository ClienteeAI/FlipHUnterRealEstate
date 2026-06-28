// ============================================================================
// LEARNING — nudge lead_score toward what the investor actually likes.
// ----------------------------------------------------------------------------
// Positive examples = approved leads, negative = dismissed. We build a simple
// preference profile over features (district, disposition, seller, margin band)
// and add a small boost (±) to each active lead's score by similarity.
//
// Safe: does nothing until there are >= MIN_FEEDBACK of each. Runs AFTER evaluate
// (which resets lead_score), so boosts never compound across cycles.
//
//   node src/engine/learn.js
// ============================================================================

const supabase = require('./../db/client');

const MIN_FEEDBACK = 8;
const MAX_BOOST = 12;
const PAGE = 1000;

function marginBand(m) {
    if (m == null) return 'na';
    if (m < 10) return 'm<10'; if (m < 20) return 'm10-20'; if (m < 30) return 'm20-30'; return 'm30+';
}
function feats(r) {
    return [`d:${r.district}`, `disp:${r.disposition}`, `seller:${r.is_agent ? 'broker' : 'owner'}`,
        `cp:${r.city_part || '-'}`, marginBand(r.expected_margin_pct)];
}

async function loadAll(filter) {
    let all = [], from = 0;
    for (;;) {
        let q = supabase.from('properties')
            .select('id, portal, district, city_part, disposition, is_agent, expected_margin_pct, lead_score, lead_tier, approved, eval_status, is_active')
            .order('id').range(from, from + PAGE - 1);
        q = filter(q);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data.length) break;
        all = all.concat(data); from += PAGE;
        if (data.length < PAGE) break;
    }
    return all;
}

async function learn() {
    console.log('=== LEARNING (approved/dismissed → score nudge) ===');
    const pos = await loadAll(q => q.eq('approved', true));
    const neg = await loadAll(q => q.eq('eval_status', 'dismissed'));

    if (pos.length < MIN_FEEDBACK || neg.length < MIN_FEEDBACK) {
        console.log(`Zatím málo zpětné vazby (schváleno ${pos.length}, skryto ${neg.length}, potřeba >=${MIN_FEEDBACK} obojí). Neladím.`);
        return;
    }

    // preference weight per feature = P(feat|pos) - P(feat|neg)
    const tally = arr => { const t = {}; arr.forEach(r => feats(r).forEach(f => t[f] = (t[f] || 0) + 1)); return t; };
    const tp = tally(pos), tn = tally(neg);
    const weight = {};
    new Set([...Object.keys(tp), ...Object.keys(tn)]).forEach(f => {
        weight[f] = (tp[f] || 0) / pos.length - (tn[f] || 0) / neg.length;
    });

    // apply boost to active, un-actioned leads
    const leads = await loadAll(q => q.eq('is_active', true).not('lead_tier', 'is', null));
    const updates = [];
    for (const r of leads) {
        const raw = feats(r).reduce((s, f) => s + (weight[f] || 0), 0);
        const boost = Math.round(Math.max(-1, Math.min(1, raw)) * MAX_BOOST);
        if (boost !== 0 && r.lead_score != null) {
            updates.push({ id: r.id, portal: r.portal, lead_score: Math.max(0, Math.min(100, r.lead_score + boost)) });
        }
    }
    for (let i = 0; i < updates.length; i += 100) {
        const chunk = updates.slice(i, i + 100);
        await supabase.from('properties').upsert(chunk, { onConflict: 'id' }).catch(() => {});
    }
    console.log(`Naučeno z ${pos.length}+/${neg.length}-; upraveno skóre u ${updates.length} leadů.`);
}

if (require.main === module) {
    learn().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { learn };
