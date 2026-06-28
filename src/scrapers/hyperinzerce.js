const { PlaywrightCrawler, ProxyConfiguration } = require('crawlee');
const storage = require('../db/storage');
require('dotenv').config();

const HYPERINZERCE_BYTY_URL = 'https://byty.hyperinzerce.cz/byty-prodej';
const HYPERINZERCE_DOMY_URL = 'https://nemovitosti-reality.hyperinzerce.cz/inzerce-domy-vily';

async function scrapeHyperinzerce() {
    console.log('Starting Hyperinzerce Scrape with Apify Crawlee...');
    
    const proxyPassword = process.env.APIFY_PROXY_PASSWORD;
    
    let proxyConfiguration;
    if (proxyPassword) {
        proxyConfiguration = new ProxyConfiguration({
            proxyUrls: [`http://groups-RESIDENTIAL,country-CZ:${proxyPassword}@proxy.apify.com:8000`]
        });
    } else {
        console.log("No proxy configured, running directly for Hyperinzerce.");
    }

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        browserPoolOptions: { useFingerprints: true },
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60,
        maxRequestsPerCrawl: 50, // Limit for safety
        
        async requestHandler({ page, request, log, enqueueLinks }) {
            log.info(`Processing ${request.url}`);

            if (request.url === HYPERINZERCE_BYTY_URL || request.url === HYPERINZERCE_DOMY_URL) {
                await page.waitForSelector('a[href*="/inzerat/"]').catch(() => log.warning("Listings not found"));
                
                const label = request.url === HYPERINZERCE_DOMY_URL ? 'DETAIL_DOMY' : 'DETAIL_BYTY';
                await enqueueLinks({
                    selector: 'a[href*="/inzerat/"]',
                    label: label
                });
                return;
            }

            if (request.label === 'DETAIL_BYTY' || request.label === 'DETAIL_DOMY') {
                const title = await page.title();
                const externalId = request.url.split('/').pop().split('.')[0] || Math.random().toString();
                const propertyType = request.label === 'DETAIL_DOMY' ? 'bytovy_dom' : 'byt';
                
                let price = 0;
                let description = '';
                let contactName = '';
                let contactPhone = '';
                let location = '';

                description = await page.evaluate(() => {
                    const descEl = document.querySelector('.description, .detail-text');
                    return descEl ? descEl.innerText.trim() : '';
                });

                price = await page.evaluate(() => {
                    const priceEl = document.querySelector('.price, [class*="price"], .cena');
                    if (priceEl) {
                        return parseInt(priceEl.innerText.replace(/\D/g, '')) || 0;
                    }
                    return 0;
                });

                location = await page.evaluate(() => {
                    const locEl = document.querySelector('.location, .locality, [class*="location"], [class*="lokalita"]');
                    return locEl ? locEl.innerText.trim() : '';
                });

                // Prague / surroundings filter
                const locationLower = location.toLowerCase();
                const isPragueArea = locationLower.includes('praha') || 
                                     locationLower.includes('středočeský') || 
                                     locationLower.includes('stredocesky') ||
                                     locationLower.includes('kladno') ||
                                     locationLower.includes('melnik') ||
                                     locationLower.includes('mělník') ||
                                     locationLower.includes('benesov') ||
                                     locationLower.includes('benešov') ||
                                     locationLower.includes('nymburk') ||
                                     locationLower.includes('beroun') ||
                                     locationLower.includes('příbram') ||
                                     locationLower.includes('pribram') ||
                                     locationLower.includes('kutná hora') ||
                                     locationLower.includes('kutna hora') ||
                                     locationLower.includes('kolín') ||
                                     locationLower.includes('kolin') ||
                                     locationLower.includes('mladá boleslav') ||
                                     locationLower.includes('mlada boleslav') ||
                                     locationLower.includes('rakovník') ||
                                     locationLower.includes('rakovnik') ||
                                     locationLower.includes('středočes') ||
                                     locationLower.includes('praha-východ') ||
                                     locationLower.includes('praha-západ');
                                     
                if (location && !isPragueArea) {
                    log.info(`[SKIP] Hyperinzerce listing is outside Prague/Central Bohemia (Lokalita: ${location})`);
                    return;
                }

                // Extract phone using regex from the whole page text
                const pageText = await page.evaluate(() => document.body.innerText);
                const phoneMatch = pageText.match(/(?:\+420)?\s*[1-9][0-9]{2}\s*[0-9]{3}\s*[0-9]{3}/);
                if (phoneMatch) {
                    contactPhone = phoneMatch[0].replace(/\s/g, '');
                    log.info(`Extracted phone: ${contactPhone}`);
                }

                const record = {
                    portal: 'hyperinzerce',
                    external_id: externalId,
                    url: request.url,
                    title: title.replace(' - Hyperinzerce.cz', '').trim(),
                    description: description,
                    price: price,
                    location: location,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    images: [],
                    raw_data: { 
                        title, 
                        price, 
                        location,
                        property_type: propertyType
                    }
                };

                const { success, source } = await storage.saveListing(record);
                if (success) {
                    log.info(`Saved (${source}): ${record.title} | Price: ${record.price} Kč | Phone: ${record.contact_phone || 'none'} | Type: ${propertyType}`);
                } else {
                    log.warning(`Failed to save: ${record.title}`);
                }
            }
        },
        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run([HYPERINZERCE_BYTY_URL, HYPERINZERCE_DOMY_URL]);
}

if (require.main === module) {
    scrapeHyperinzerce();
}

module.exports = scrapeHyperinzerce;
