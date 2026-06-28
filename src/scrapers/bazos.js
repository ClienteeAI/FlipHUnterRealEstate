const { PlaywrightCrawler, ProxyConfiguration } = require('crawlee');
const storage = require('../db/storage');
require('dotenv').config();

const BAZOS_SEARCH_URL = 'https://reality.bazos.cz/prodam/10/?hledat=&hlokalita=11000&humkreis=35';

async function scrapeBazos() {
    console.log('Starting Bazoš Scrape (SAFE MODE - TEXT ONLY)...');
    
    const proxyPassword = process.env.APIFY_PROXY_PASSWORD;
    const proxyConfiguration = undefined; // Disabled proxy for local testing

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        browserPoolOptions: { useFingerprints: true },
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 60,
        async requestHandler({ page, request, enqueueLinks }) {
            
            if (request.url === BAZOS_SEARCH_URL) {
                console.log('Načítám seznam inzerátů na Bazoši...');
                await enqueueLinks({
                    selector: '.inzeratynadpis a',
                    label: 'DETAIL'
                });
                return;
            }

            if (request.label === 'DETAIL') {
                const title = await page.title();
                const externalId = request.url.split('/').slice(-2)[0] || Math.random().toString();
                
                const pageData = await page.evaluate(() => {
                    // Phone: prefer tel: link, fallback to text
                    const telEl = document.querySelector('a[href^="tel:"]');
                    let phone = telEl ? telEl.getAttribute('href').replace('tel:', '').replace(/\s/g, '') : '';
                    
                    if (!phone) {
                        const text = document.body.innerText;
                        const m = text.match(/(?:\+420\s*)?[1-9][0-9]{2}\s*[0-9]{3}\s*[0-9]{3}/);
                        phone = m ? m[0].replace(/\s/g, '') : '';
                    }
                    
                    // Email
                    const mailEl = document.querySelector('a[href^="mailto:"]');
                    const email = mailEl ? mailEl.getAttribute('href').replace('mailto:', '').trim() : '';
                    
                    return { phone, email };
                });
                let contactPhone = pageData.phone;
                let contactEmail = pageData.email;

                if (contactPhone || contactEmail) {
                    console.log(`[BAZOŠ SUCCESS] Nalezen telefon v textu: ${contactPhone}`);
                    
                    const description = await page.evaluate(() => {
                        const el = document.querySelector('.popisdetail');
                        return el ? el.innerText.trim() : '';
                    });

                    const price = await page.evaluate(() => {
                        const el = document.querySelector('.cenadetail b, .price b, b.cena');
                        return el ? parseInt(el.innerText.replace(/\D/g, '')) || 0 : 0;
                    });

                    const location = await page.evaluate(() => {
                        let loc = '';
                        document.querySelectorAll('tr').forEach(tr => {
                            if (tr.innerText.includes('Lokalita:')) {
                                loc = tr.querySelector('td:last-child')?.innerText.trim() || '';
                            }
                        });
                        return loc;
                    });

                    const record = {
                        portal: 'bazos',
                        external_id: externalId,
                        url: request.url,
                        title: title.replace(' - Bazoš.cz', '').trim(),
                        description: description,
                        price: price,
                        location: location,
                        contact_name: '',
                        contact_phone: contactPhone,
                        contact_email: contactEmail,
                        images: [],
                        raw_data: { title, price }
                    };

                    const { success, source } = await storage.saveListing(record);
                    if (success) console.log(`Saved (${source}): ${record.title}`);
                }
            }
        },
    });

    await crawler.run([BAZOS_SEARCH_URL]);
    console.log("Bazos SAFE MODE Scrape Finished.");
}

if (require.main === module) {
    scrapeBazos();
}

module.exports = scrapeBazos;
