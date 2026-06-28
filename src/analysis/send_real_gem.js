const { sendToWebhook } = require('../utils/webhook');
require('dotenv').config();

const realLead = {
    id: "0d547618-7a8e-493f-be81-08b167c4b319",
    portal: "avizo",
    external_id: "prodej-bytu-2-1-b-t-95-m2-ov-ul-na-harfe-praha-9-vysocany-19787268",
    title: "Prodej bytu 2+1/B/T, 95 m2, OV, ul. Na Harfě, Praha 9 - Vysočany",
    description: "Nabízíme k prodeji byt v osobním vlastnictví 2+1 s balkonem a terasou na ulici Na Harfě v Praze 9 - Vysočanech. Byt má výměru 95 m2. Byt je v původním zachovalém stavu, ideální k rekonstrukci podle představ nového majitele. Klidná lokalita s kompletní občanskou vybaveností a skvělou dopravní dostupností.",
    url: "https://www.avizo.cz/reality/prodej-bytu-2-1-b-t-95-m2-ov-ul-na-harfe-praha-9-vysocany-19787268.html",
    price: 11499000,
    price_numeric: 11499000,
    area_m2: 95,
    location: "Na Harfě, Praha, Vysočany",
    contact_phone: "727897153",
    contact_email: "na-harfe-majitel@seznam.cz",
    is_broker: false,
    is_broker_final: false,
    current_score: 55,
    gem_score: 55,
    gem_notes: "Nabídka je v souladu s tržní cenou, ale neobsahuje žádné znaky urgentního prodeje nebo výhodnosti. Při ceně 121 042 Kč/m² je spíše průměrná.",
    distress_factor: "Žádný",
    estimated_market_value: 9500000,
    ghl_tags: "RealEstate_Gem, OWNER, AVIZO",
    tags: "RealEstate_Gem, OWNER, AVIZO",
    sync_timestamp: new Date().toISOString()
};

console.log('Sending a REAL live direct-owner listing from database to LeadConnector webhook...');
sendToWebhook(realLead);
