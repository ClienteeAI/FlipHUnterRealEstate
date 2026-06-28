// ============================================================================
// EVALUATION RUNNER — ties AVM + deal_evaluator over the properties table.
// ----------------------------------------------------------------------------
// For each in-scope listing (byt ≤90 m² or bytový dům, in Praha/Středočeský):
//   1. find its AVM cohort benchmark,
//   2. run the flipper deal evaluator,
//   3. write lead_score / lead_tier / flip economics back to `properties`.
// Replaces the old analyzer.js gem_score logic (no artificial floor).
//
// Run:  node src/engine/evaluate_run.js
// ============================================================================

const supabase = require('../db/client');
const { loadBenchmarks, getBenchmark } = require('./avm');
const { evaluateDeal } = require('./deal_evaluator');

const SCOPE_TYPES = ['byt', 'bytovy_dum'];
const BYT_MAX_AREA = 90;
const SALE_PRICE_FLOOR = 500000;   // below this a "byt" is almost certainly a rental/garage/data error
const WRITE_CHUNK = 300;

// Canonical Středočeský + Praha districts (dash/space tolerant).
const SCOPE_DISTRICTS = new Set([
    'praha', 'praha 1', 'praha 2', 'praha 3', 'praha 4', 'praha 5', 'praha 6',
    'praha 7', 'praha 8', 'praha 9', 'praha 10',
    'benesov', 'beroun', 'kladno', 'kolin', 'kutna hora', 'melnik',
    'mlada boleslav', 'nymburk', 'praha-vychod', 'praha-zapad', 'pribram', 'rakovnik'
]);

function normDistrict(d) {
    return (d || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
}
function isInScope(d) { return SCOPE_DISTRICTS.has(normDistrict(d)); }

async function run() {
    console.log('=== EVALUATION RUN (AVM + flip evaluator) ===');
    // Clear stale evaluations on rows that were reclassified OUT of scope
    // (e.g. a former "byt" now correctly tagged chata/pozemek/pronajem).
    const { error: resetErr } = await supabase
        .from('properties')
        .update({
            eval_status: 'rejected', lead_tier: null, lead_score: null, valuation_confidence: null,
            estimated_value: null, estimated_value_per_m2: null, discount_vs_estimate_pct: null,
            arv_estimate: null, renovation_estimate: null, expected_margin_pct: null,
            distress_factors: [], reject_reason: 'Není byt/bytový dům', notes: null,
            evaluated_at: new Date().toISOString()
        })
        .not('property_type', 'in', '("byt","bytovy_dum")')
        .not('lead_tier', 'is', null);
    if (resetErr) console.warn('Reset stale tiers error:', resetErr.message);

    console.log('Loading AVM benchmarks...');
    const benchmarks = await loadBenchmarks();

    // Fetch all active in-scope-type listings (district filtered in JS for
    // dash/space robustness).
    const PAGE = 1000;
    let from = 0;
    const updates = [];
    const tierCount = { A: 0, B: 0, C: 0, none: 0, rejected: 0 };

    for (;;) {
        const { data, error } = await supabase
            .from('properties')
            .select('id, portal, title, description, district, disposition, property_type, area_m2, price_numeric, price_per_m2, condition, is_agent, price_drop_count, first_seen_at')
            .in('property_type', SCOPE_TYPES)
            .eq('is_active', true)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);

        if (error) throw new Error(`Fetch: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const p of data) {
            const base = { id: p.id, portal: p.portal, evaluated_at: new Date().toISOString() };

            // --- scope gates ---
            if (!isInScope(p.district)) {
                updates.push({ ...base, ...emptyEval('rejected', 'Mimo region (Praha/Středočeský)') });
                tierCount.rejected++; continue;
            }
            if (p.property_type === 'byt' && p.area_m2 && p.area_m2 > BYT_MAX_AREA) {
                updates.push({ ...base, ...emptyEval('rejected', `Byt ${p.area_m2} m² nad limit ${BYT_MAX_AREA} m²`) });
                tierCount.rejected++; continue;
            }
            if (!p.price_numeric || !p.area_m2) {
                updates.push({ ...base, ...emptyEval('pending', 'Chybí cena nebo plocha') });
                continue;
            }
            if (p.property_type === 'byt' && p.price_numeric < SALE_PRICE_FLOOR) {
                updates.push({ ...base, ...emptyEval('rejected', `Cena ${p.price_numeric.toLocaleString('cs-CZ')} Kč příliš nízká (nájem/chyba)`) });
                tierCount.rejected++; continue;
            }

            // --- days on market from first_seen ---
            const daysOnMarket = p.first_seen_at
                ? Math.round((Date.now() - new Date(p.first_seen_at).getTime()) / 86400000) : 0;

            const benchmark = getBenchmark(benchmarks, p);
            const r = evaluateDeal({ ...p, days_on_market: daysOnMarket }, benchmark);

            tierCount[r.tier || 'none']++;

            updates.push({
                ...base,
                eval_status: 'evaluated',
                lead_score: r.score,
                lead_tier: r.tier,
                valuation_confidence: r.confidence,
                estimated_value: r.flip.fairValue,
                estimated_value_per_m2: benchmark ? benchmark.median_price_per_m2 : null,
                discount_vs_estimate_pct: r.flip.discountVsMarketPct,
                arv_estimate: r.flip.arv,
                renovation_estimate: r.flip.renovation,
                expected_margin_pct: r.flip.marginPct != null ? Math.round(r.flip.marginPct * 100) : null,
                distress_factors: r.distressFactors,
                reject_reason: null,
                notes: r.reasons.join(' ')
            });
        }

        from += PAGE;
        if (data.length < PAGE) break;
    }

    // Dedupe by id (pagination can overlap during concurrent writes) so an upsert
    // batch never hits the same row twice.
    const uniq = [...new Map(updates.map(u => [u.id, u])).values()];

    // Write back in chunks (homogeneous columns guaranteed by emptyEval/full obj).
    let written = 0;
    for (let i = 0; i < uniq.length; i += WRITE_CHUNK) {
        const chunk = uniq.slice(i, i + WRITE_CHUNK).map(fill);
        const { error } = await supabase.from('properties').upsert(chunk, { onConflict: 'id' });
        if (error) console.warn('Upsert error:', error.message);
        else written += chunk.length;
    }

    console.log(`\nEvaluated/updated ${written} rows.`);
    console.log('Tiers:', JSON.stringify(tierCount));
}

function emptyEval(status, reason) {
    return {
        eval_status: status, lead_score: null, lead_tier: null, valuation_confidence: null,
        estimated_value: null, estimated_value_per_m2: null, discount_vs_estimate_pct: null,
        arv_estimate: null, renovation_estimate: null, expected_margin_pct: null,
        distress_factors: [], reject_reason: reason || null, notes: null
    };
}

// Ensure every upsert row carries the exact same column set.
const COLS = ['id', 'portal', 'evaluated_at', 'eval_status', 'lead_score', 'lead_tier',
    'valuation_confidence', 'estimated_value', 'estimated_value_per_m2', 'discount_vs_estimate_pct',
    'arv_estimate', 'renovation_estimate', 'expected_margin_pct', 'distress_factors',
    'reject_reason', 'notes'];
function fill(o) {
    const out = {};
    for (const c of COLS) out[c] = o[c] !== undefined ? o[c] : null;
    return out;
}

if (require.main === module) {
    run().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { run, isInScope, normDistrict };
