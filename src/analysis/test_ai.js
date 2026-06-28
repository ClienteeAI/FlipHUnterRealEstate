const { analyzeListingWithAI } = require('./ai_analyzer');
require('dotenv').config();

const mockListing = {
    title: "Prodej bytu 2+kk 55 m², Praha 4",
    description: "Spěchá! Z důvodu dědictví a stěhování do zahraničí nabízím k prodeji útulný byt v původním stavu. Přímý majitel, RK nevolat!",
    location: "Praha 4",
    price: 4900000,
    area_m2: 55,
    floor: "3",
    ownership: "Osobní",
    disposition: "2+kk"
};

console.log('Sending mock listing to OpenAI GPT-4o-mini...');
analyzeListingWithAI(mockListing)
    .then(result => {
        console.log('\n=== AI ANALYSIS RESULT ===');
        console.log(JSON.stringify(result, null, 2));
    })
    .catch(console.error);
