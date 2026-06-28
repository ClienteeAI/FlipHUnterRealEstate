const axios = require('axios');
require('dotenv').config();

const URL = 'https://reality.bazos.cz/?hledat=&rubriky=reality&hlokalita=11000&humkreis=1035&cenaod=&cenado=&Submit=Hledat&order=&crp=&kitx=ano';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testAxios() {
    try {
        const response = await axios.get(URL, { headers: { 'User-Agent': USER_AGENT } });
        console.log('Status:', response.status);
        console.log('Content length:', response.data.length);
        console.log('Includes "inzerat":', response.data.includes('/inzerat/'));
        if (response.data.includes('/inzerat/')) {
            const matches = response.data.match(/\/inzerat\/\d+/g);
            console.log('Match count:', matches ? matches.length : 0);
        }
    } catch (error) {
        console.error('Axios Error:', error.message);
    }
}

testAxios();
