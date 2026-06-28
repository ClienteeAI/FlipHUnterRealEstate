// ============================================================================
// SEND TEST LEAD — fire ONE lead to the CRM with YOUR phone, to test on yourself.
// ----------------------------------------------------------------------------
// Uses a real top deal's property data but overrides the contact with your phone
// (and name/email), so the GHL call/SMS workflow reaches YOU, not a real owner.
//
//   node src/engine/send_test_lead.js +420777123456 "Petr" petr@clientee.co
//
// Phone is REQUIRED. Nothing is sent without it.
// ============================================================================

const supabase = require('../db/client');
const { sendToWebhook } = require('../utils/webhook');
const { buildPayload } = require('./crm_push');

async function run() {
    const phone = process.argv[2];
    const name = process.argv[3] || 'TEST – zkušební lead';
    const email = process.argv[4] || '';

    if (!phone || phone.replace(/\D/g, '').length < 9) {
        console.error('Zadej platný telefon: node src/engine/send_test_lead.js +420777123456 "Jméno" [email]');
        process.exit(1);
    }

    // grab a realistic top A-tier deal for the property data
    const { data, error } = await supabase.from('properties')
        .select('id, portal, external_id, title, url, images, district, disposition, property_type, area_m2, ownership, price_numeric, price_per_m2, contact_phone, contact_email, estimated_value, discount_vs_estimate_pct, arv_estimate, renovation_estimate, expected_margin_pct, lead_tier, lead_score, distress_factors, is_agent')
        .eq('is_active', true).not('lead_tier', 'is', null)
        .order('lead_score', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    if (!data.length) throw new Error('Žádný lead k použití jako šablona.');

    const payload = buildPayload(data[0]);

    // normalize phone to +420 format for GHL
    let ph = String(phone).replace(/[^0-9+]/g, '');
    if (ph.length === 9 && /^[67]/.test(ph)) ph = '+420' + ph;
    else if (ph.startsWith('420') && ph.length === 12) ph = '+' + ph;

    // override contact → YOU, mark as test
    payload.phone = payload.contact_phone = ph;
    payload.email = payload.contact_email = email;
    payload.name = payload.first_name = payload.contact_name = name;
    payload.ghl_tags = payload.tags = 'FLIP_LEAD, TEST, ' + payload.tier + ', ' + (payload.broker === 'Ano' ? 'MAKLER' : 'MAJITEL');
    payload.is_test = true;

    // requested test overrides
    payload.hidden_gem_score = 78;
    payload.gem_score = payload.skore = payload.current_score = 78;
    payload.adresa = payload.address = payload.ulice = 'Hatě';

    console.log('Odesílám TESTOVACÍ lead na webhook:');
    console.log(`  telefon: ${phone} | jméno: ${name} | tier: ${payload.tier}`);
    console.log(`  nemovitost: ${payload.title} (${payload.okres}, ${payload.cena.toLocaleString('cs-CZ')} Kč)`);

    await sendToWebhook(payload);
    console.log('\nOdesláno. Zkontroluj CRM (a telefon – mělo by přijít volání/SMS dle tvého GHL workflow).');
}

if (require.main === module) {
    run().catch(e => { console.error(e.message); process.exit(1); });
}
