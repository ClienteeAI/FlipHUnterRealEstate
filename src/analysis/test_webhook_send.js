const { sendToWebhook } = require('../utils/webhook');
require('dotenv').config();

const mockLead = {
    id: "test-prague-apartment-gem-1",
    portal: "avizo",
    external_id: "prodej-bytu-3-kk-zizkov-test",
    title: "Prodej bytu 3+kk, 75 m², OV, Praha 3 - Žižkov (Přímo od majitele)",
    description: "Nabízím k prodeji kompletně zrekonstruovaný byt 3+kk o rozloze 75 m2 v osobním vlastnictví v srdci Žižkova. Byt se nachází ve 3. podlaží cihlového domu s výtahem. Spěchá z důvodu stěhování do zahraničí, cena je výrazně snížena pro rychlé jednání! Přímý majitel, RK nevolat!",
    url: "https://www.avizo.cz/reality/prodej-bytu-3-kk-test-zizkov.html",
    price: 8900000,
    price_numeric: 8900000,
    area_m2: 75,
    location: "Praha 3 - Žižkov",
    contact_phone: "727897153",
    contact_email: "majitel-zizkov@email.cz",
    is_broker: false,
    is_broker_final: false,
    current_score: 92,
    gem_score: 92,
    gem_notes: "Mimořádně výhodná nabídka zrekonstruovaného bytu 3+kk na Žižkově. Cena za m² je výrazně pod tržním průměrem této lokality. Rychlý prodej z důvodu stěhování poskytuje kupujícímu velkou slevu.",
    distress_factor: "Urgentní prodej",
    estimated_market_value: 11500000,
    ghl_tags: "RealEstate_Gem, OWNER, AVIZO, HIGH_PRIORITY",
    tags: "RealEstate_Gem, OWNER, AVIZO, HIGH_PRIORITY",
    sync_timestamp: new Date().toISOString()
};

console.log('Sending exactly one highly-detailed residential lead to GHL LeadConnector webhook...');
sendToWebhook(mockLead);
