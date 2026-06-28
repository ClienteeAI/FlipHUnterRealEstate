const { PlaywrightCrawler } = require('crawlee');
const storage = require('../db/storage');
require('dotenv').config();

// ALLOWED REGIONS - only Praha and surroundings (35 km)
const ALLOWED_REGIONS = [
    'Praha', 'Středočeský', 'Stredocesky'
];

const ANNONCE_BYTY_URL = 'https://www.annonce.cz/byty-na-prodej.html';
const ANNONCE_DOMY_URL = 'https://www.annonce.cz/cinzovni-domy.html';

async function scrapeAnnonce() {
    console.log('Starting Annonce Scrape (Flats and Tenement Houses)...');

    const crawler = new PlaywrightCrawler({
        browserPoolOptions: { useFingerprints: true },
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 90,
        maxRequestsPerCrawl: 200,
        
        async requestHandler({ page, request, log, enqueueLinks }) {
            log.info(`Processing ${request.url}`);

            if (request.url === ANNONCE_BYTY_URL || request.url === ANNONCE_DOMY_URL) {
                await page.waitForTimeout(3000);
                
                // Deduplicate links before enqueuing
                const hrefs = await page.evaluate(() => {
                    return [...new Set(
                        Array.from(document.querySelectorAll('a[href*="/inzerat/"]'))
                            .map(a => a.href)
                    )];
                });

                log.info(`Found ${hrefs.length} unique listing links`);

                const label = request.url === ANNONCE_DOMY_URL ? 'DETAIL_DOMY' : 'DETAIL_BYTY';
                for (const href of hrefs) {
                    await crawler.addRequests([{ url: href, label }]).catch(() => {});
                }
                return;
            }

            if (request.label === 'DETAIL_BYTY' || request.label === 'DETAIL_DOMY') {
                await page.waitForTimeout(1000);
                const title = await page.title();
                const propertyType = request.label === 'DETAIL_DOMY' ? 'bytovy_dom' : 'byt';

                const data = await page.evaluate(() => {
                    const result = {
                        price: 0,
                        description: '',
                        location: '',
                        city: '',
                        region: '',
                        district: '',
                        contact_phone: '',
                        contact_email: '',
                        area_m2: 0,
                        floor: '',
                        ownership: '',
                        disposition: ''
                    };

                    // === TABLE ATTRIBUTES (most reliable) ===
                    const rows = Array.from(document.querySelectorAll('table.attrs tr'));
                    rows.forEach(r => {
                        const th = r.querySelector('th');
                        const td = r.querySelector('td');
                        if (!th || !td) return;

                        const labelText = th.innerText.trim().toLowerCase().replace(':', '');
                        const value = td.innerText.trim();

                        if (labelText === 'cena') {
                            result.price = parseInt(value.replace(/\D/g, '')) || 0;
                        } else if (labelText === 'město') {
                            result.city = value;
                            result.location = value;
                        } else if (labelText === 'kraj') {
                            result.region = value;
                        } else if (labelText === 'okres') {
                            result.district = value;
                        } else if (labelText === 'plocha') {
                            result.area_m2 = parseInt(value.replace(/m2/i, '').replace(/\D/g, '')) || 0;
                        } else if (labelText === 'podlaží') {
                            result.floor = value;
                        } else if (labelText === 'vlastnictví') {
                            result.ownership = value;
                        } else if (labelText === 'dispozice') {
                            result.disposition = value;
                        }
                    });

                    // === DESCRIPTION ===
                    const descEl = document.querySelector('#popis, .popis, .advert-description, .detail-description');
                    result.description = descEl ? descEl.innerText.trim() : '';

                    // === CONTACTS ===
                    // Phone - prefer tel: links, fallback to text regex
                    const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                    if (telLinks.length > 0) {
                        result.contact_phone = telLinks[0].getAttribute('href').replace('tel:', '').replace(/\s/g, '');
                    }

                    // Email - block site's own email address
                    const mailEl = document.querySelector('a[href^="mailto:"]');
                    const rawEmail = mailEl ? mailEl.getAttribute('href').replace('mailto:', '').trim() : '';
                    // Exclude the site's own redaction email
                    result.contact_email = (rawEmail && !rawEmail.includes('annonce.cz')) ? rawEmail : '';

                    // If no phone from link, try text regex
                    if (!result.contact_phone) {
                        const text = document.body.innerText;
                        const phoneMatch = text.match(/(?:\+420\s*)?[1-9][0-9]{2}\s*[0-9]{3}\s*[0-9]{3}/);
                        if (phoneMatch) {
                            result.contact_phone = phoneMatch[0].replace(/\s/g, '');
                        }
                    }

                    return result;
                });

                // === SKIP 'Hledám/Koupím' listings (wanted ads, not selling) ===
                const titleLower = title.toLowerCase();
                if (titleLower.includes('hled') || titleLower.includes('koup') || titleLower.includes('popt')) {
                    log.info(`[SKIP] Wanted ad (not a sale listing): ${title}`);
                    return;
                }

                // === REGION FILTER: only Praha or Středočeský ===
                const region = data.region.trim();
                const regionLower = region.toLowerCase();
                const isAllowed = ALLOWED_REGIONS.some(r => regionLower.includes(r.toLowerCase()));

                if (region && !isAllowed) {
                    log.info(`[SKIP] ${data.city || 'Unknown'} - Kraj: ${region} is outside 35km Prague area`);
                    return;
                }

                // === CONTACT FILTER: must have phone or email ===
                if (!data.contact_phone && !data.contact_email) {
                    log.info(`[SKIP] ${title} - No contact info found`);
                    return;
                }

                const externalId = request.url.match(/-([0-9]+)\.html/)?.[1] || Math.random().toString();

                const record = {
                    portal: 'annonce',
                    external_id: externalId,
                    url: request.url,
                    title: title.replace(' - inzerát | inzerce na Annonce.cz', '').replace(' | ANNONCE', '').trim(),
                    description: data.description,
                    price: data.price,
                    location: `${data.city}${data.district ? ', ' + data.district : ''}`,
                    contact_name: '',
                    contact_phone: data.contact_phone,
                    contact_email: data.contact_email,
                    area_m2: data.area_m2,
                    images: [],
                    raw_data: {
                        region: data.region,
                        district: data.district,
                        floor: data.floor,
                        ownership: data.ownership,
                        disposition: data.disposition,
                        price: data.price,
                        property_type: propertyType
                    }
                };

                log.info(`[SAVING] ${record.title} | ${data.city} | ${data.price > 0 ? data.price + ' Kč' : 'Price N/A'} | Phone: ${data.contact_phone || 'none'} | Type: ${propertyType}`);

                const { success, source } = await storage.saveListing(record);
                if (success) {
                    log.info(`Saved (${source}): ${record.title}`);
                } else {
                    log.warning(`Failed to save: ${record.title}`);
                }
            }
        },

        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run([ANNONCE_BYTY_URL, ANNONCE_DOMY_URL]);
    console.log('Annonce Scrape finished.');
}

if (require.main === module) {
    scrapeAnnonce();
}

module.exports = scrapeAnnonce;
