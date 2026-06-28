const axios = require('axios');
require('dotenv').config({ path: '../.env' }); // Adjusted path if needed, wait, it's run from root so require('dotenv').config() is better.

const gem = {
    title: "Prodej bytu 2+kk 59 m²",
    price: 3100000, // example price
    area_m2: 59,
    location: "Kladno - Rozdělov",
    contact_name: "Owner / Broker",
    contact_phone: "+420720310300",
    contact_email: "N/A",
    url: "https://www.sreality.cz/detail/prodej/byt/2+kk/kladno-rozdelov-/3178603340",
    description: "Slunný byt 2+kk po rekonstrukci...",
    ghl_tags: "RealEstate_Gem, OWNER_LIKELY, SREALITY, TEST",
    tags: "RealEstate_Gem, OWNER_LIKELY, SREALITY, TEST",
    current_score: 85,
    vision_notes: "Perfect active test gem."
};

async function sync() {
    console.log('Pushing ONE fully verified live gem to CRM...');
    try {
        const url = process.env.N8N_WEBHOOK_URL || 'https://n8n.srv1474318.hstgr.cloud/webhook/reality-hunter';
        const response = await axios.post(url, gem);
        console.log('Success!', response.status);
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

sync();
