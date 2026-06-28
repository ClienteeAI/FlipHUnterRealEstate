// ============================================================================
// DEAL EVALUATOR — the "best Czech flipper" brain.
// ----------------------------------------------------------------------------
// Pure, deterministic functions. No DB, no network, no side effects → testable.
// Given a property + an AVM benchmark (median Kč/m² for its cohort), it returns
// the flip economics (ARV, renovation, costs, margin), seller-motivation signals,
// a deal score and an A/B/C tier.
//
// Methodology encoded here is researched from the Czech flip market (2025/26).
// All tunable numbers live in CONFIG so the investor can calibrate later.
// See memory: flip-methodology.
// ============================================================================

const CONFIG = {
    // --- Renovation cost per m² (CZK), by required work level. Prague/Středočeský.
    //     Sources: ~9.6–16.8k/m² complete; Prague higher standard 16–27k/m².
    renoCostPerM2: {
        none:     0,        // already renovated / new — no flip-by-reno upside
        cosmetic: 4000,     // vymalovat, drobné opravy, úklid, home staging
        standard: 11000,    // dated but functional refresh (kuchyně/koupelna)
        full:     18000,    // "před rekonstrukcí" / "k rekonstrukci"
        gut:      25000     // špatný stav, původní z 70./80. let, kompletní
    },
    renoReservePct: 0.15,        // 10–20% reserve for surprises → use 15%

    // --- Transaction / holding / selling costs
    sellingCostPctOfArv: 0.05,   // RK provize + marketing + home staging at exit
    holdingCostPctOfPrice: 0.015,// financing + utilities + fond oprav while held

    // --- Deal thresholds (net flip margin as % of total invested capital)
    marginTierA: 0.20,           // hot
    marginTierB: 0.12,           // solid
    marginTierC: 0.05,           // watch (below this = no deal)

    // --- 70% rule screen
    maoRuleFactor: 0.70,

    // --- Družstevní (co-op) flats sell ~15% below osobní → discount the
    //     (ownership-mixed) benchmark so co-op pricing isn't read as a "deal".
    druzstevniFactor: 0.85,

    // --- Our benchmarks are ASKING prices; real SOLD prices run ~7% lower.
    //     Discount the benchmark so discounts/margins aren't systematically
    //     optimistic (anchored to inflated asking medians).
    askingToSoldFactor: 0.93,

    // --- AVM confidence: need this many comparable listings in the cohort to trust it
    minCohortSample: 5,

    // --- Distress patterns. HIGH PRECISION: each requires genuine context, not a
    //     loose substring. Text is diacritics-stripped + lowercased before match.
    //     We dropped weak/common signals ("cena dohodou", "k jednání", "přímý
    //     majitel") and bare "rychl"/"nutn"/"rozvod" which fired on boilerplate
    //     ("rychlé spojení", "bez nutnosti investic", "rozvody elektřiny").
    distressPatterns: [
        { re: /\bdedictv|zdeden|po zemrel(?:em|e)?|z pozustalost/, factor: 'Dědictví', weight: 12, negatable: false },
        { re: /\bexekuc/, factor: 'Exekuce', weight: 14, negatable: true },
        { re: /\bdrazb/, factor: 'Dražba', weight: 10, negatable: true },
        { re: /\binsolvenc|konkurz/, factor: 'Insolvence', weight: 14, negatable: true },
        // divorce only with explicit context — never "rozvody elektřiny/tepla"
        { re: /(?:z duvodu|kvuli|po|pri)\s+rozvod|rozvod(?:em|u)\s+manzel|rozvodov[ea]\s+rizen|rozvod manzelstv/, factor: 'Rozvod', weight: 12, negatable: false },
        // urgency — explicit phrases only
        { re: /\bspech|nutny\s+rychly\s+prodej|rychly\s+prodej|rychle\s+jednani|nutno\s+prodat|musime\s+prodat|urgentn|akutn[ie]|co\s+nejrychleji\s+prodat|nutny\s+odprodej|spedchno|chvatny/, factor: 'Spěch', weight: 10, negatable: false },
        { re: /stehujeme\s+se|kvuli\s+stehovan|stehuji\s+se|odstehovani\s+do|stehovani\s+do\s+zahranic/, factor: 'Stěhování', weight: 8, negatable: false },
        { re: /zlevneno|nova\s+nizsi\s+cena|cena\s+snizena|puvodni\s+cena\b/, factor: 'Sleva', weight: 8, negatable: false }
    ],
    negationTokens: ['bez ', 'neni ', 'nezatiz', 'zadn', ' ani ', 'mimo ', 'neexistuj', 'prosta ', 'prosty ', 'cista ', 'cisty ']
};

// ----------------------------------------------------------------------------
// Condition → required renovation level. Falls back to 'standard' when unknown,
// because most owner listings need at least a refresh to hit ARV.
// ----------------------------------------------------------------------------
function renoLevelFromCondition(condition, text) {
    const t = (text || '').toLowerCase();
    const c = (condition || '').toLowerCase();

    if (c.includes('novostavb') || t.includes('novostavb')) return 'none';
    if (c.includes('po rekonstrukci') || t.includes('po rekonstrukci') ||
        t.includes('zrekonstruov') || t.includes('kompletně zrekonstr')) return 'cosmetic';
    if (c.includes('před rekonstrukcí') || t.includes('před rekonstrukcí') ||
        t.includes('pred rekonstrukci') || t.includes('k rekonstrukci') ||
        t.includes('nutná rekonstrukce') || t.includes('vyžaduje rekonstrukci')) return 'full';
    if (t.includes('špatný stav') || t.includes('havarijní') || t.includes('dezolátní') ||
        t.includes('původní stav') || t.includes('puvodni stav')) return 'gut';
    if (c.includes('dobrý') || t.includes('dobrý stav') || t.includes('udržovan')) return 'standard';

    return 'standard';
}

// ----------------------------------------------------------------------------
// Estimate renovation cost incl. reserve.
// ----------------------------------------------------------------------------
function estimateRenovation(areaM2, renoLevel) {
    const perM2 = CONFIG.renoCostPerM2[renoLevel] ?? CONFIG.renoCostPerM2.standard;
    const base = perM2 * (areaM2 || 0);
    return Math.round(base * (1 + CONFIG.renoReservePct));
}

// ----------------------------------------------------------------------------
// Detect seller-motivation / distress signals from free text. Deterministic,
// reliable layer (AI adds nuance on top later). Returns factors + a 0..~40 boost.
// ----------------------------------------------------------------------------
function detectDistress(text) {
    const t = (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const factors = new Set();
    let boost = 0;
    for (const { re, factor, weight, negatable } of CONFIG.distressPatterns) {
        const m = re.exec(t);
        if (!m) continue;
        // negation guard: skip "bez exekuce", "není v dražbě", etc.
        if (negatable) {
            const ctx = t.slice(Math.max(0, m.index - 18), m.index);
            if (CONFIG.negationTokens.some(n => ctx.includes(n))) continue;
        }
        if (!factors.has(factor)) { boost += weight; factors.add(factor); }
    }
    return { factors: [...factors], boost: Math.min(boost, 40) };
}

// ----------------------------------------------------------------------------
// Core flip economics. `benchmark` = { median_price_per_m2, p75_price_per_m2,
// sample_size } for the property's cohort (district × disposition × type).
//   - ARV is based on the renovated/upper price level of the cohort (p75),
//     because a well-renovated flip sells at the top of its local range.
// ----------------------------------------------------------------------------
function computeFlipMath(property, benchmark) {
    const area = Number(property.area_m2) || 0;
    const asking = Number(property.price_numeric) || 0;

    const renoLevel = renoLevelFromCondition(property.condition,
        `${property.title || ''} ${property.description || ''}`);
    const renovation = estimateRenovation(area, renoLevel);

    // Co-op (družstevní) sells below the ownership-mixed benchmark, and all
    // benchmarks are asking-price based → calibrate down to approx sold prices.
    const coopAdjusted = /druzstevn/i.test((property.ownership || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const f = (coopAdjusted ? CONFIG.druzstevniFactor : 1) * CONFIG.askingToSoldFactor;

    // ARV: renovated sale price = upper-market Kč/m² × area. Fall back to median.
    let arvPerM2 = benchmark?.p75_price_per_m2 || benchmark?.median_price_per_m2 || null;
    if (arvPerM2) arvPerM2 = Math.round(arvPerM2 * f);
    const arv = (arvPerM2 && area) ? Math.round(arvPerM2 * area) : null;

    // "Fair as-is" market value at median Kč/m² (for discount vs market).
    let fairPerM2 = benchmark?.median_price_per_m2 || null;
    if (fairPerM2) fairPerM2 = Math.round(fairPerM2 * f);
    const fairValue = (fairPerM2 && area) ? Math.round(fairPerM2 * area) : null;

    const sellingCost = arv ? Math.round(arv * CONFIG.sellingCostPctOfArv) : 0;
    const holdingCost = asking ? Math.round(asking * CONFIG.holdingCostPctOfPrice) : 0;

    const totalInvested = asking + renovation + sellingCost + holdingCost;
    const profit = (arv != null) ? (arv - totalInvested) : null;
    const marginPct = (profit != null && totalInvested > 0)
        ? profit / totalInvested : null;

    // 70% rule: Max Allowable Offer
    const mao = (arv != null) ? Math.round(arv * CONFIG.maoRuleFactor - renovation) : null;
    const passesMaoRule = (mao != null) ? asking <= mao : null;

    // Discount of asking vs fair as-is value (can be negative = overpriced)
    const discountVsMarketPct = (fairValue && asking)
        ? Math.round(((fairValue - asking) / fairValue) * 100) : null;

    return {
        renoLevel,
        renovation,
        arv,
        arvPerM2,
        fairValue,
        sellingCost,
        holdingCost,
        totalInvested,
        profit,
        marginPct,
        mao,
        passesMaoRule,
        discountVsMarketPct,
        coopAdjusted
    };
}

// ----------------------------------------------------------------------------
// Top-level: evaluate a property into a score + tier + human-readable reasons.
//   property: { price_numeric, area_m2, condition, title, description,
//               is_agent, price_drop_count, days_on_market, ... }
//   benchmark: AVM cohort row (may be null/low-sample → low confidence)
// ----------------------------------------------------------------------------
function evaluateDeal(property, benchmark) {
    const reasons = [];
    const text = `${property.title || ''} ${property.description || ''}`;

    const flip = computeFlipMath(property, benchmark);
    const distress = detectDistress(text);

    const cohortTrusted = benchmark && benchmark.sample_size >= CONFIG.minCohortSample;
    const confidence = !benchmark ? 0
        : Math.min(1, (benchmark.sample_size || 0) / 20); // ~20 comps → full trust

    // --- Build score (0..100). Margin is the spine; signals add on top.
    let score = 0;

    if (flip.marginPct != null) {
        // Map margin to 0..70 (0% → 0, 30%+ → 70)
        score += Math.max(0, Math.min(70, Math.round((flip.marginPct / 0.30) * 70)));
        reasons.push(`Flip marže ~${Math.round(flip.marginPct * 100)} % (ARV ${fmt(flip.arv)}, reko ${fmt(flip.renovation)})`);
    } else {
        reasons.push('Bez dostatečných dat na výpočet ARV (chybí benchmark nebo plocha).');
    }

    if (flip.passesMaoRule === true) {
        score += 8;
        reasons.push(`Splňuje pravidlo 70 % (MAO ${fmt(flip.mao)} ≥ nabídka ${fmt(property.price_numeric)}).`);
    }

    if (distress.factors.length) {
        score += distress.boost;
        reasons.push(`Signály motivace: ${distress.factors.join(', ')}.`);
    }

    if (property.price_drop_count > 0) {
        score += Math.min(10, property.price_drop_count * 5);
        reasons.push(`Cena už ${property.price_drop_count}× snížena → ochota jednat.`);
    }

    if (property.days_on_market > 60) {
        score += 6;
        reasons.push(`Na trhu ${property.days_on_market} dní → motivovaný prodejce.`);
    }

    // Seller type is an INDEPENDENT axis (owner vs broker), not a tier penalty —
    // the dashboard filters tier × seller separately. Just annotate, don't score.
    reasons.push(property.is_agent
        ? 'Makléřský inzerát (přímé jednání s majitelem není možné).'
        : 'Přímý majitel (lepší vyjednávací pozice).');
    if (flip.coopAdjusted) {
        reasons.push('Družstevní vlastnictví → cena upravena dolů (levnější než osobní).');
    }

    // Scale by confidence so low-data deals don't shoot to the top blindly.
    score = Math.round(score * (0.5 + 0.5 * confidence));
    score = Math.max(0, Math.min(100, score));

    // --- Tier from net margin (primary) gated by confidence.
    let tier = 'C';
    const m = flip.marginPct;
    if (m == null) tier = null;
    else if (m >= CONFIG.marginTierA && (distress.factors.length || flip.passesMaoRule)) tier = 'A';
    else if (m >= CONFIG.marginTierB) tier = 'B';
    else if (m >= CONFIG.marginTierC) tier = 'C';
    else tier = null; // no deal

    if (!cohortTrusted && tier) {
        reasons.push(`Pozn.: nízký vzorek dat v lokalitě (${benchmark?.sample_size || 0}), odhad méně jistý.`);
    }

    return {
        score,
        tier,
        confidence: Number(confidence.toFixed(2)),
        distressFactors: distress.factors,
        flip,
        reasons
    };
}

function fmt(n) {
    if (n == null) return 'N/A';
    return Number(n).toLocaleString('cs-CZ') + ' Kč';
}

module.exports = {
    CONFIG,
    renoLevelFromCondition,
    estimateRenovation,
    detectDistress,
    computeFlipMath,
    evaluateDeal
};
