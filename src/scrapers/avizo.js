const { PlaywrightCrawler, ProxyConfiguration } = require('crawlee');
const storage = require('../db/storage');
require('dotenv').config();

const AVIZO_BYTY_URL = 'https://www.avizo.cz/reality/byty/prodej/praha/';
const AVIZO_DOMY_URL = 'https://www.avizo.cz/reality/rodinne-domy/prodej/stredocesky-kraj/';

async function scrapeAvizo() {
    console.log('Starting Avizo Scrape with Apify Crawlee (Flats & Houses)...');
    
    const proxyPassword = process.env.APIFY_PROXY_PASSWORD;
    
    let proxyConfiguration;
    if (proxyPassword) {
        proxyConfiguration = new ProxyConfiguration({
            proxyUrls: [`http://groups-RESIDENTIAL,country-CZ:${proxyPassword}@proxy.apify.com:8000`]
        });
    } else {
        console.log("No proxy configured, running directly for Avizo.");
    }

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        browserPoolOptions: { useFingerprints: true },
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 60,
        maxRequestsPerCrawl: 50, // Limit for safety
        
        async requestHandler({ page, request, log, enqueueLinks }) {
            log.info(`Processing ${request.url}`);

            if (request.url === AVIZO_BYTY_URL || request.url === AVIZO_DOMY_URL) {
                await page.waitForSelector('a[href*="/reality/"]').catch(() => log.warning("Listings not found"));
                
                const label = request.url === AVIZO_DOMY_URL ? 'DETAIL_DOMY' : 'DETAIL_BYTY';
                await enqueueLinks({
                    selector: 'a[href*="/reality/"]',
                    label: label,
                    transformRequestFunction(req) {
                        const isListing = /-[0-9]+\.html$/.test(req.url);
                        if (!isListing) return false;
                        return req;
                    }
                });
                return;
            }

            if (request.label === 'DETAIL_BYTY' || request.label === 'DETAIL_DOMY') {
                const title = await page.title();
                const externalId = request.url.split('/').pop().split('.')[0] || Math.random().toString();
                const propertyType = request.label === 'DETAIL_DOMY' ? 'bytovy_dom' : 'byt';
                
                // Click "zobrazit telefon" if present to reveal the contact phone number
                const showPhoneButton = page.locator('a:has-text("zobrazit telefon"), button:has-text("zobrazit telefon")').first();
                if (await showPhoneButton.count() > 0) {
                    await showPhoneButton.click().catch(() => {});
                    await page.waitForTimeout(1000);
                }

                const details = await page.evaluate(() => {
                    const result = {
                        price: 0,
                        location: '',
                        area_m2: null,
                        disposition: null,
                        ownership: null,
                        floor: null,
                        description: '',
                        contactPhone: '',
                        isBroker: false,
                        brokerName: ''
                    };

                    // Price
                    const priceEl = document.querySelector('strong.fs-2, .fs-2');
                    if (priceEl) {
                        result.price = parseInt(priceEl.innerText.replace(/\D/g, '')) || 0;
                    }

                    // Description (Resilient Selector Chain)
                    let descEl = document.querySelector('.description, .detail-text, .inzerat-detail, .detail-desc, [itemprop="description"]');
                    if (!descEl) {
                        const paragraphs = Array.from(document.querySelectorAll('p, div'));
                        const goodPara = paragraphs.find(p => p.innerText.includes('Kód zakázky') || p.innerText.includes('Nabízíme') || (p.innerText.length > 200 && p.innerText.includes('byt')));
                        if (goodPara) descEl = goodPara;
                    }
                    result.description = descEl ? descEl.innerText.trim() : '';

                    // Parameters List
                    const listItems = Array.from(document.querySelectorAll('li.col-sm-6'));
                    listItems.forEach(li => {
                        const labelEl = li.querySelector('small');
                        const valEl = li.querySelector('span, a');
                        if (!labelEl || !valEl) return;

                        const label = labelEl.innerText.trim().toLowerCase().replace(':', '');
                        const val = valEl.innerText.trim();

                        if (label === 'lokalita') {
                            result.location = val;
                        } else if (label === 'plocha') {
                            result.area_m2 = parseInt(val) || null;
                        } else if (label === 'velikost bytu' || label === 'dispozice') {
                            result.disposition = val;
                        } else if (label === 'vlastnictví') {
                            result.ownership = val;
                        } else if (label === 'podlaží') {
                            result.floor = val;
                        }
                    });

                    // Phone Extraction from page body
                    const bodyText = document.body.innerText;
                    const phoneMatch = bodyText.match(/(?:\+420)?\s*[1-9][0-9]{2}\s*[0-9]{3}\s*[0-9]{3}/);
                    if (phoneMatch) {
                        result.contactPhone = phoneMatch[0].replace(/\s/g, '');
                    }

                    // Agency/Broker detection inside contact block
                    const links = Array.from(document.querySelectorAll('a[href*="www."], a[href*="http"]'));
                    const brokerLink = links.find(a => {
                        const href = a.href.toLowerCase();
                        return (href.includes('real') || href.includes('remax') || href.includes('makler') || href.includes('rk') || href.includes('bidli') || href.includes('hvb')) &&
                               !href.includes('avizo.cz') && !href.includes('google.com') && !href.includes('facebook.com');
                    });

                    if (brokerLink) {
                        result.isBroker = true;
                        result.brokerName = brokerLink.innerText.trim();
                    }

                    const contactHeaders = Array.from(document.querySelectorAll('strong, h3, h4'));
                    const contactHeader = contactHeaders.find(el => {
                        const text = el.innerText.toLowerCase();
                        return text.includes('real estate') || text.includes('reality') || text.includes('re/max') || text.includes('hvb') || text.includes('makléř') || text.includes('makler');
                    });
                    if (contactHeader) {
                        result.isBroker = true;
                        result.brokerName = contactHeader.innerText.trim();
                    }

                    return result;
                });

                const record = {
                    portal: 'avizo',
                    external_id: externalId,
                    url: request.url,
                    title: title.replace(' | avizo.cz', '').trim(),
                    description: details.description,
                    price: details.price,
                    location: details.location,
                    contact_name: details.brokerName || '',
                    contact_phone: details.contactPhone,
                    area_m2: details.area_m2,
                    is_broker: details.isBroker,
                    images: [],
                    raw_data: {
                        title,
                        floor: details.floor,
                        ownership: details.ownership,
                        disposition: details.disposition,
                        price: details.price,
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

    await crawler.run([AVIZO_BYTY_URL, AVIZO_DOMY_URL]);
}

if (require.main === module) {
    scrapeAvizo();
}

module.exports = scrapeAvizo;
