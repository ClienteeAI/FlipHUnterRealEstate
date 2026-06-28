const axios = require('axios');
require('dotenv').config();

const gem = {
    title: "Prodej bytu 2+kk 57 m² Praha 9, Vysočany",
    price: 7000000,
    area_m2: 57,
    location: "Praha 9, Vysočany",
    contact_name: "Owner / Broker",
    contact_phone: "+420000000000", // Valid dummy phone if missing
    contact_email: "gem-218030232@reality-hunter.cz", // Valid dummy email
    url: "https://reality.bazos.cz/inzerat/218030232/prodej-bytu-2kk-57-m-praha-9-vysocany.php",
    description: "Prakticky řešený byt 2+kk o podlahové ploše 57 m² v ulici Špitálská, Praha 9, Vysočany. Velkým benefitem je prostorný zelený vnitroblok...",
    ghl_tags: "RealEstate_Gem, OWNER_LIKELY, BAZOS, TEST",
    tags: "RealEstate_Gem, OWNER_LIKELY, BAZOS, TEST",
    current_score: 80,
    vision_notes: "Bazos leads often belong to direct owners. Verified Prodej (Sale)."
};

async function sync() {
    console.log('Pushing safely formatted Bazos lead to CRM...');
    try {
        const url = process.env.N8N_WEBHOOK_URL || 'https://n8n.srv1474318.hstgr.cloud/webhook/reality-hunter';
        const response = await axios.post(url, gem);
        console.log('Success!', response.status);
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

sync();
