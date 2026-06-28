const supabase = require('../db/client');
const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ENRICHMENT_CACHE_FILE = path.join(__dirname, '../../data/enrichment_cache.json');

// Helper to get cache
function getCache() {
    try {
        if (fs.existsSync(ENRICHMENT_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(ENRICHMENT_CACHE_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Helper to save cache
function saveCache(cache) {
    try {
        const dir = path.dirname(ENRICHMENT_CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(ENRICHMENT_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {}
}

/**
 * Checks if a listing needs enrichment.
 * @param {Object} listing
 */
function needsEnrichment(listing) {
    const md = listing.metadata || {};
    return (
        !listing.price_numeric || 
        !md.area_m2 || 
        !listing.description || 
        listing.description.trim().length < 20 ||
        !listing.images || listing.images.length === 0
    );
}

/**
 * Enriches a Bazoš listing using Axios and Cheerio.
 * Very fast, no headless browser needed for Bazos.
 */
async function enrichBazos(url) {
    const result = {};
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000
        });
        const $ = cheerio.load(data);
        
        // Description
        const desc = $('.popisdetail').text();
        if (desc) result.description = desc.trim();

        // Price
        const priceText = $('.listadvlevo tr').filter((i, el) => $(el).text().includes('Cena:')).text();
        if (priceText) {
            const priceVal = parseInt(priceText.replace(/\D/g, ''));
            if (!isNaN(priceVal)) result.price_numeric = priceVal;
        }

        // Images
        const imgs = [];
        $('.flinok').each((i, el) => {
            const imgUrl = $(el).attr('src');
            if (imgUrl) imgs.push(imgUrl);
        });
        if (imgs.length > 0) result.images = imgs;

        // Area mapping (often in title or description)
        const text = ($('title').text() + ' ' + (desc || '')).toLowerCase();
        const areaMatch = text.match(/(\d+)\s*(?:m2|m²|metrů|metru)/);
        if (areaMatch) {
            result.metadata = { area_m2: parseInt(areaMatch[1], 10) };
        }

    } catch (e) {
        console.warn(`[Enricher] Bazos fetch failed for ${url}: ${e.message}`);
    }
    return result;
}

/**
 * Enriches dynamic portals using Playwright.
 */
async function enrichDynamic(url, portal) {
    const result = {};
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Extract basic data
        const desc = await page.evaluate(() => {
            const el = document.querySelector('.description, .detail-text, [itemprop="description"], .popis');
            return el ? el.innerText.trim() : '';
        }).catch(() => '');
        if (desc) result.description = desc;

        const price = await page.evaluate(() => {
            const el = document.querySelector('.price, [class*="price"], .cena');
            return el ? parseInt(el.innerText.replace(/\D/g, '')) : null;
        }).catch(() => null);
        if (price && !isNaN(price)) result.price_numeric = price;

        const areaMatch = desc.toLowerCase().match(/(\d+)\s*(?:m2|m²|metrů|metru)/);
        if (areaMatch) {
            result.metadata = { area_m2: parseInt(areaMatch[1], 10) };
        }

    } catch (e) {
        console.warn(`[Enricher] Dynamic fetch failed for ${url} (${portal}): ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
    return result;
}

/**
 * Main Enrichement Orchestrator
 */
async function runEnrichment() {
    console.log('=== RUNNING URL ENRICHMENT ===');
    const cache = getCache();
    const portals = ['bazos', 'avizo', 'hyperinzerce'];
    let enrichedCount = 0;

    for (const portal of portals) {
        const tableName = `listings_${portal}`;
        
        console.log(`Checking ${tableName} for missing data...`);
        try {
            // Fetch active listings
            const { data: listings, error } = await supabase
                .from(tableName)
                .select('*')
                .eq('is_active', true)
                .order('scraped_at', { ascending: false })
                .limit(100);

            if (error) {
                console.warn(`[Enricher] Could not fetch ${tableName}: ${error.message}`);
                continue;
            }

            for (const listing of listings) {
                if (!needsEnrichment(listing)) continue;
                if (cache[listing.url] && (Date.now() - cache[listing.url] < 24 * 60 * 60 * 1000)) {
                    // Skip if enriched in last 24h
                    continue;
                }

                console.log(`[Enricher] Enriching: ${listing.url}`);
                
                let enrichedData = {};
                if (portal === 'bazos') {
                    enrichedData = await enrichBazos(listing.url);
                } else {
                    enrichedData = await enrichDynamic(listing.url, portal);
                }

                // If we got new data, update Supabase
                if (Object.keys(enrichedData).length > 0) {
                    const updatePayload = {};
                    
                    if (enrichedData.description && !listing.description) {
                        updatePayload.description = enrichedData.description;
                    }
                    if (enrichedData.price_numeric && !listing.price_numeric) {
                        updatePayload.price_numeric = enrichedData.price_numeric;
                        updatePayload.price_raw = `${enrichedData.price_numeric} Kč`;
                    }
                    if (enrichedData.images && (!listing.images || listing.images.length === 0)) {
                        updatePayload.images = enrichedData.images;
                    }
                    if (enrichedData.metadata) {
                        const currentMd = listing.metadata || {};
                        if (!currentMd.area_m2 && enrichedData.metadata.area_m2) {
                            updatePayload.metadata = { ...currentMd, area_m2: enrichedData.metadata.area_m2 };
                        }
                    }

                    if (Object.keys(updatePayload).length > 0) {
                        const { error: updateErr } = await supabase
                            .from(tableName)
                            .update(updatePayload)
                            .eq('id', listing.id);

                        if (updateErr) {
                            console.warn(`[Enricher] Update failed for ${listing.url}: ${updateErr.message}`);
                        } else {
                            console.log(`[Enricher] Updated ${listing.url} successfully!`);
                            enrichedCount++;
                        }
                    }
                }

                // Cache to prevent immediate retry even if failed
                cache[listing.url] = Date.now();
                saveCache(cache);
                
                // Be gentle
                await new Promise(r => setTimeout(r, 1000));
            }

        } catch (e) {
            console.warn(`[Enricher] Exception on ${tableName}: ${e.message}`);
        }
    }
    
    console.log(`=== ENRICHMENT COMPLETE. Enriched ${enrichedCount} listings. ===`);
}

if (require.main === module) {
    runEnrichment();
}

module.exports = runEnrichment;
