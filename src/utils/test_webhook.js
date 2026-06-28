const axios = require('axios');

const WEBHOOK_URL = 'https://n8n.srv1474318.hstgr.cloud/webhook-test/reality-hunter';

const testLead = {
    // Basic Contact Info
    contact_name: "Jan Novák (Test Lead - Max Info)",
    contact_phone: "+420 777 123 456",
    contact_email: "test@example.com",
    
    // Property Details
    portal: "sreality",
    title: "Luxusní byt 3+kk s terasou a výhledem",
    url: "https://www.sreality.cz/en/detail/sale/apartment/a/a/123456789",
    price: 12500000,
    currency: "CZK",
    area_m2: 85,
    price_per_m2: 147058,
    district: "Praha 5 - Smíchov",
    location: "Nábřežní 12, Praha 5",
    disposition: "3+kk",
    floor: "4. patro",
    condition: "Velmi dobrý",
    type: "Byt",
    
    // Extended Info
    description: "Tento prostorný byt se nachází v prestižní lokalitě Prahy 5. Nabízí moderní kuchyňskou linku, velkou terasu (15m2) a sklep. V domě je výtah. Parkování je možné před domem. V blízkosti je park Sacre Coeur a OC Nový Smíchov.",
    images: [
        "https://d18-a.sdn.cz/d_18/c_img_gY_N/BWzDAJ.jpeg",
        "https://d18-a.sdn.cz/d_18/c_img_G_C/LNVKy2.jpeg"
    ],
    features: {
        terrace: true,
        elevator: true,
        cellar: true,
        parking: "Street",
        energy_rating: "B"
    },
    
    // Hidden Gem Intelligence
    hidden_gem_score: 92,
    is_broker: false,
    contact_type: "OWNER", 
    discount_vs_market: "22%",
    distress_keywords: ["spěchá", "stěhování"],
    vision_analysis: "Photos are poorly lit and show personal clutter. Real potential is hidden behind bad photography.",
    
    // CRM Integration
    ghl_tags: "RealEstate_Gem, Private_Owner, Smichov_Target",
    source: "Reality Hunter AI",
    captured_at: new Date().toISOString()
};

async function sendTest() {
    console.log('Sending test lead to webhook...');
    try {
        const response = await axios.post(WEBHOOK_URL, testLead);
        console.log('Status:', response.status);
        console.log('Response:', response.data);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

sendTest();
