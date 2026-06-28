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

// Load all in-scope comps and build cohort levels (incl. micro-location city_part).
async function loadBenchmarks() {
    const c3 = {}, c2 = {};            // city_part × disp × type, city_part × type
    const l3 = {}, l2 = {}, l1 = {};   // district × disp × type, district × type, district
    const PAGE = 1000;
    let from = 0;

    for (;;) {
        const { data, error } = await supabase
            .from('properties')
            .select('district, city_part, disposition, property_type, price_per_m2')
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
            const d = r.district, ty = r.property_type, di = r.disposition, cp = r.city_part;
            (l1[`${d}`] ||= []).push(ppm2);
            (l2[`${d}|${ty}`] ||= []).push(ppm2);
            if (di) (l3[`${d}|${di}|${ty}`] ||= []).push(ppm2);
            if (cp) {
                (c2[`${cp}|${ty}`] ||= []).push(ppm2);
                if (di) (c3[`${cp}|${di}|${ty}`] ||= []).push(ppm2);
            }
        }

        from += PAGE;
        if (data.length < PAGE) break;
    }

    const build = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, statsFromArray(v)]));
    return { c3: build(c3), c2: build(c2), l3: build(l3), l2: build(l2), l1: build(l1) };
}

// Pick the most specific cohort meeting MIN_SAMPLE for a given property.
// Micro-location (city_part) is tried first, then falls back to district.
function getBenchmark(benchmarks, property) {
    const d = property.district, ty = property.property_type, di = property.disposition, cp = property.city_part;
    if (!d || !ty) return null;

    const candidates = [
        { key: `${cp}|${di}|${ty}`, map: benchmarks.c3, level: 'micro+disp+type', ok: !!cp },
        { key: `${cp}|${ty}`,       map: benchmarks.c2, level: 'micro+type',      ok: !!cp },
        { key: `${d}|${di}|${ty}`,  map: benchmarks.l3, level: 'district+disp+type', ok: true },
        { key: `${d}|${ty}`,        map: benchmarks.l2, level: 'district+type',   ok: true },
        { key: `${d}`,              map: benchmarks.l1, level: 'district',        ok: true }
    ].filter(c => c.ok);

    for (const c of candidates) {
        const b = c.map[c.key];
        if (b && b.sample_size >= MIN_SAMPLE) return { ...b, level: c.level };
    }
    for (const c of candidates) {
        const b = c.map[c.key];
        if (b) return { ...b, level: c.level + ' (low sample)' };
    }
    return null;
}

module.exports = { loadBenchmarks, getBenchmark, MIN_SAMPLE };
