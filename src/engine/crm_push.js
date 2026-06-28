// ============================================================================
// CRM PUSH — send APPROVED leads to GoHighLevel via the existing n8n webhook.
// ----------------------------------------------------------------------------
// Builds a lead payload from a `properties` row and posts it to N8N_WEBHOOK_URL.
// Field names mirror the previous pipeline's payload so the existing n8n→GHL
// mapping keeps working, plus new flip fields (margin, ARV, tier, ...).
//
// SAFETY: default is DRY-RUN (prints payload, sends nothing). Sending for real
// can trigger calls/SMS to real owners — only do it with --send.
//
//   node src/engine/crm_push.js            # dry-run all approved (not yet sent)
//   node src/engine/crm_push.js --sample   # dry-run the top deal (preview shape)
//   node src/engine/crm_push.js --send     # ACTUALLY send approved leads
// ============================================================================

const supabase = require('../db/client');
const { sendToWebhook } = require('../utils/webhook');

function firstImage(images) {
    return Array.isArray(images) && images.length ? images[0] : '';
}

function normPhone(p) {
    let s = String(p || '').replace(/[^0-9+]/g, '');
    if (s.startsWith('420') && s.length === 12) s = '+' + s;
    else if (s.length === 9 && /^[67]/.test(s)) s = '+420' + s;
    return s;
}

// Map a properties row -> CRM lead payload (old field names + new flip fields).
function buildPayload(r) {
    const tags = ['FLIP_LEAD', r.lead_tier, r.is_agent ? 'MAKLER' : 'MAJITEL', r.district]
        .filter(Boolean);

    return {
        // identity
        id: r.id,
        portal: r.portal,
        external_id: r.external_id || `${r.portal}-${String(r.id).slice(0, 8)}`,

        // contact (classifieds rarely have a name → use the listing title)
        phone: normPhone(r.contact_phone),
        contact_phone: normPhone(r.contact_phone),
        email: r.contact_email || '',
        contact_email: r.contact_email || '',
        name: r.title || '',
        first_name: r.title || '',
        contact_name: r.title || '',

        // property
        title: r.title || '',
        nazev_inzeratu: r.title || '',
        url: r.url,
        url_inzeratu: r.url,
        foto: firstImage(r.images),
        okres: r.district || '',
        location: r.district || '',
        mesto: r.district || '',
        dispozice: r.disposition || '',
        typ_nemovitosti: r.property_type || '',
        vymera_nemovitost: r.area_m2 || 0,
        area_m2: r.area_m2 || 0,
        vlastnictvi: r.ownership || '',
        cena: r.price_numeric || 0,
        price: r.price_numeric || 0,
        price_numeric: r.price_numeric || 0,
        cena_m2: r.price_per_m2 || 0,
        price_per_m2: r.price_per_m2 || 0,

        // deal economics (the flip case)
        estimated_market_value: r.estimated_value || 0,
        odhad_ceny: r.estimated_value || 0,
        discount_vs_market: r.discount_vs_estimate_pct ?? 0,
        sleva_procent: r.discount_vs_estimate_pct ?? 0,
        arv_estimate: r.arv_estimate || 0,
        renovation_estimate: r.renovation_estimate || 0,
        marze_procent: r.expected_margin_pct ?? 0,
        expected_margin_pct: r.expected_margin_pct ?? 0,
        tier: r.lead_tier,
        lead_tier: r.lead_tier,
        gem_score: r.lead_score ?? 0,
        current_score: r.lead_score ?? 0,
        skore: r.lead_score ?? 0,
        distress_factory: (r.distress_factors || []).join(', '),
        distress_factors: r.distress_factors || [],

        // seller type
        broker: r.is_agent ? 'Ano' : 'Ne',
        is_broker: !!r.is_agent,
        typ_prodejce: r.is_agent ? 'Makléř' : 'Majitel',

        // tags + meta
        ghl_tags: tags.join(', '),
        tags: tags.join(', '),
        sync_timestamp: new Date().toISOString()
    };
}

const SELECT = 'id, portal, external_id, title, url, images, district, disposition, ' +
    'property_type, area_m2, ownership, price_numeric, price_per_m2, contact_phone, ' +
    'contact_email, estimated_value, discount_vs_estimate_pct, arv_estimate, ' +
    'renovation_estimate, expected_margin_pct, lead_tier, lead_score, distress_factors, is_agent';

async function run() {
    const send = process.argv.includes('--send');
    const sample = process.argv.includes('--sample');

    let query = supabase.from('properties').select(SELECT).eq('is_active', true);
    if (sample) {
        query = query.not('lead_tier', 'is', null).order('lead_score', { ascending: false }).limit(1);
    } else {
        query = query.eq('approved', true).eq('sent_to_crm', false);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    if (!data.length) {
        console.log(sample ? 'Žádný lead k náhledu.' : 'Žádné schválené leady k odeslání (approved=true, sent_to_crm=false).');
        return;
    }

    console.log(`${send ? 'ODESÍLÁM' : 'DRY-RUN (neodesílám)'}: ${data.length} lead(ů)\n`);

    for (const r of data) {
        const payload = buildPayload(r);
        if (!send) {
            console.log('--- LEAD PAYLOAD ---');
            console.log(JSON.stringify(payload, null, 2));
            continue;
        }
        await sendToWebhook(payload);
        await supabase.from('properties')
            .update({ sent_to_crm: true, sent_to_crm_at: new Date().toISOString() })
            .eq('id', r.id);
        console.log(`Odesláno do CRM: ${r.title}`);
    }

    if (!send) console.log('\n(Toto byl DRY-RUN. Pro reálné odeslání spusť s --send.)');
}

if (require.main === module) {
    run().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { buildPayload, run };
