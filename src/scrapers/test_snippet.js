const axios = require('axios');
const URL = 'https://reality.bazos.cz/?hledat=&rubriky=reality&hlokalita=11000&humkreis=1035&cenaod=&cenado=&Submit=Hledat&order=&crp=&kitx=ano';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testAxios() {
    const response = await axios.get(URL, { headers: { 'User-Agent': USER_AGENT } });
    const html = response.data;
    const start = html.indexOf('/inzerat/');
    if (start !== -1) {
        console.log('Snippet around first inzerat:', html.substring(start - 200, start + 200));
    }
}
testAxios();
