// ============================================================================
// AVM — Automated Valuation Model (cohort benchmarks).
// ----------------------------------------------------------------------------
// Computes median / p25 / p75 Kč/m² per cohort directly from `properties`,
// in-memory, so the pipeline needs no materialized-view REFRESH or extra DDL.
//
// Cohorts have 3 granularity levels with fallback, so even thin local markets
// still get a usable (if less confident) benchmark:
//   1. district × disposition × property_type   (most specific)
//   2. district × property_type
//   3. district
// getBenchmark() returns the most specific level that meets MIN_SAMPLE.
// ============================================================================

const supabase = require('./../db/client');

const MIN_SAMPLE = 5;               // need >= this many comps to trust a cohort
const PPM2_MIN = 10000;             // guard against garbage price_per_m2
const PPM2_MAX = 400000;
const SCOPE_TYPES = ['byt', 'bytovy_dum'];

function percentile(sortedArr, p) {
    if (!sortedArr.length) return null;
    const idx = (sortedArr.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return Math.round(sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo));
}

function statsFromArray(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return {
        sample_size: s.length,
        median_price_per_m2: percentile(s, 0.5),
        p25_price_per_m2: percentile(s, 0.25),
        p75_price_per_m2: percentile(s, 0.75)
    };
}

// Load all in-scope comps and build the three cohort levels.
async function loadBenchmarks() {
    const l3 = {}, l2 = {}, l1 = {};   // arrays of ppm2 per key
    const PAGE = 1000;
    let from = 0;

    for (;;) {
        const { data, error } = await supabase
            .from('properties')
            .select('district, disposition, property_type, price_per_m2')
            .in('property_type', SCOPE_TYPES)
            .not('district', 'is', null)
            .not('price_per_m2', 'is', null)
            .eq('is_active', true)
            .range(from, from + PAGE - 1);

        if (error) throw new Error(`AVM load: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const r of data) {
            const ppm2 = Number(r.price_per_m2);
            if (!(ppm2 >= PPM2_MIN && ppm2 <= PPM2_MAX)) continue;
            const d = r.district, ty = r.property_type, di = r.disposition;
            (l1[`${d}`] ||= []).push(ppm2);
            (l2[`${d}|${ty}`] ||= []).push(ppm2);
            if (di) (l3[`${d}|${di}|${ty}`] ||= []).push(ppm2);
        }

        from += PAGE;
        if (data.length < PAGE) break;
    }

    const build = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, statsFromArray(v)]));
    return { l3: build(l3), l2: build(l2), l1: build(l1) };
}

// Pick the most specific cohort meeting MIN_SAMPLE for a given property.
function getBenchmark(benchmarks, property) {
    const d = property.district, ty = property.property_type, di = property.disposition;
    if (!d || !ty) return null;

    const candidates = [
        { key: `${d}|${di}|${ty}`, map: benchmarks.l3, level: 'district+disp+type' },
        { key: `${d}|${ty}`,       map: benchmarks.l2, level: 'district+type' },
        { key: `${d}`,             map: benchmarks.l1, level: 'district' }
    ];
    for (const c of candidates) {
        const b = c.map[c.key];
        if (b && b.sample_size >= MIN_SAMPLE) return { ...b, level: c.level };
    }
    // fall back to the most specific available even if under MIN_SAMPLE (low confidence)
    for (const c of candidates) {
        const b = c.map[c.key];
        if (b) return { ...b, level: c.level + ' (low sample)' };
    }
    return null;
}

module.exports = { loadBenchmarks, getBenchmark, MIN_SAMPLE };
