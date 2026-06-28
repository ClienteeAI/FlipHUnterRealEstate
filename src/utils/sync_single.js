const axios = require('axios');
require('dotenv').config();

const gem = {
    title: "Prodej bytu 3+kt 78 m² - Strašnice (TEST GEM)",
    price: 9500000,
    area_m2: 78,
    location: "Praha - Strašnice",
    contact_name: "David Černík",
    contact_phone: "+420721204221",
    contact_email: "info@example.cz",
    url: "https://www.sreality.cz/detail/prodej/byt/a/a/505430860",
    description: "Krásný byt v klidné lokalitě. Ideální pro rodinu.",
    ghl_tags: "RealEstate_Gem, OWNER_LIKELY, SREALITY, HIGH_PRIORITY",
    tags: "RealEstate_Gem, OWNER_LIKELY, SREALITY, HIGH_PRIORITY",
    current_score: 75,
    vision_notes: "High quality property with strong negotiation potential based on price history."
};

async function sync() {
    console.log('Pushing ONE test gem to CRM...');
    try {
        const response = await axios.post(process.env.N8N_WEBHOOK_URL, gem);
        console.log('Success!', response.status);
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

sync();
