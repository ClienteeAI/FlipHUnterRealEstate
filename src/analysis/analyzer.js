const fs = require('fs');
const path = require('path');
const supabase = require('../db/client');
const { checkDistance } = require('../utils/distance_helper');
const { analyzeListingWithAI } = require('./ai_analyzer');
const { sendToWebhook } = require('../utils/webhook');
const { chromium } = require('playwright');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function withTimeout(promise, ms, timeoutErrorMsg) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(timeoutErrorMsg));
        }, ms);
    });
    
    return Promise.race([
        promise.then((res) => {
            clearTimeout(timeoutId);
            return res;
        }),
        timeoutPromise
    ]);
}

function needsScraping(listing) {
    return (
        !listing.description || 
        listing.description.trim().length < 20 ||
        !listing.images || 
        !Array.isArray(listing.images) || 
        listing.images.length === 0
    );
}

function detectIfFlat(title, description) {
    const titleLower = title.toLowerCase();
    const descLower = (description || '').toLowerCase();
    const textLower = `${titleLower} ${descLower}`;

    const flatKeywords = [
        'byt', 'byty', 'garson', '1+kk', '2+kk', '3+kk', '4+kk', '5+kk', 
        '1+1', '2+1', '3+1', '4+1', '5+1', 'mezonet', 'ateliér', 'atelier'
    ];

    const blockedKeywords = [
        'garáž', 'garaz', 'pozemek', 'pozemku', 'pozemky', 'zahrada', 'zahrady', 'zahradu',
        'chata', 'chaty', 'chatka', 'chatku', 'chalupa', 'chalupy', 'dům', 'dum', 'domu', 'domy',
        'rodinný dům', 'rodinny dum', 'vila', 'vily', 'kancelář', 'kancelar', 'kanceláře', 'kancelare',
        'nebytový', 'nebytovy', 'nebytové', 'nebytove', 'sklad', 'sklady', 'hala', 'haly',
        'komerční', 'komercni', 'půda', 'puda', 'les', 'lesní', 'pole', 'louka', 'louky', 'rybník',
        'parkovací stání', 'parkovaci stani', 'garážové stání', 'garazove stani'
    ];

    // 1. If title contains blocked keywords and does NOT explicitly mention flat keywords, reject it!
    const titleHasBlocked = blockedKeywords.some(kw => titleLower.includes(kw));
    const titleHasFlat = flatKeywords.some(kw => titleLower.includes(kw));

    if (titleHasBlocked && !titleHasFlat) {
        return false;
    }

    // 2. If the title contains a house/villa keyword, it's a house, not a flat
    const houseKeywords = [
        'rodinný dům', 'rodinny dum', 'rodinného domu', 'rodinneho domu', 'vila', 'vily', 'vile', 
        'chata', 'chaty', 'chatička', 'chaticka', 'chalupa', 'chalupy', 'chalupu',
        'zemědělská usedlost', 'usedlost', 'činžovní dům', 'cinzovni dum', 'bytový dům', 'bytovy dum'
    ];
    const titleHasHouse = houseKeywords.some(kw => titleLower.includes(kw));
    if (titleHasHouse && !titleHasFlat) {
        return false;
    }

    // 3. If title explicitly mentions flat keyword, accept it
    if (titleHasFlat) {
        return true;
    }

    // 4. If title doesn't mention flat keyword, but description does:
    // Make sure we screen out other common non-flat title keywords
    const titleBlockedWordsExtended = ['prostory', 'objekt', 'budova', 'čp', 'stání', 'stani', 'ubytování', 'ubytovani'];
    if (titleBlockedWordsExtended.some(kw => titleLower.includes(kw))) {
        return false;
    }

    // Check if the description contains a flat keyword
    return flatKeywords.some(kw => descLower.includes(kw));
}

function detectIfBuilding(title, description) {
    const titleLower = title.toLowerCase();
    const descLower = (description || '').toLowerCase();
    const textLower = `${titleLower} ${descLower}`;

    const buildingKeywords = [
        'činžovní dům', 'cinzovni dum', 'bytový dům', 'bytovy dum',
        'činžovní domy', 'cinzovni domy', 'bytové domy', 'bytove domy',
        'činžák', 'cinzak', 'bytový objekt', 'bytovy objekt', 'bytové objekty', 'bytove objekty',
        'činžovního domu', 'cinzovniho domu', 'bytového domu', 'bytoveho domu'
    ];

    const hasBuildingKw = buildingKeywords.some(kw => textLower.includes(kw));

    // Exclude cases where it's a flat inside a tenement house (e.g. "byt v činžovním domě")
    const flatKeywords = ['prodej bytu', 'pronájem bytu', 'byt 1', 'byt 2', 'byt 3', 'byt 4', 'byt 5', '1+kk', '2+kk', '3+kk', '4+kk', '5+kk', '1+1', '2+1', '3+1', '4+1', '5+1'];
    const titleHasFlatKeyword = flatKeywords.some(kw => titleLower.includes(kw));

    if (titleHasFlatKeyword && (titleLower.includes('prodej bytu') || titleLower.includes('byt 1') || titleLower.includes('byt 2') || titleLower.includes('byt 3') || titleLower.includes('byt 4') || titleLower.includes('byt 5'))) {
        return false;
    }

    return hasBuildingKw;
}

async function checkPhoneBrokerDB(phone, currentListingId) {
    if (!phone) return false;
    
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('420') && cleanPhone.length === 12) {
        cleanPhone = cleanPhone.substring(3);
    }
    
    if (cleanPhone.length !== 9) {
        return false;
    }
    
    const activePortals = ['annonce', 'avizo', 'hyperinzerce', 'bazos'];
    let totalCount = 0;
    
    for (const portal of activePortals) {
        const tableName = `listings_${portal}`;
        try {
            const { data, error } = await supabase
                .from(tableName)
                .select('id, phone')
                .eq('is_active', true)
                .or(`phone.ilike.%${cleanPhone}%`);
                
            if (error) continue;
            if (data) {
                const otherMatches = data.filter(item => item.id !== currentListingId);
                totalCount += otherMatches.length;
            }
        } catch (e) {
            // Ignore error
        }
    }
    
    return totalCount > 0;
}

async function analyzeImagesWithAI(imageUrls) {
    if (!process.env.OPENAI_API_KEY || !imageUrls || imageUrls.length === 0) {
        return { vision_score: 0, reasoning: 'Žádné fotky k analýze nebo chybí OpenAI API klíč.' };
    }
    try {
        console.log(`[AI Vision] Analyzing ${imageUrls.length} images with GPT-4o-mini...`);
        const content = [
            {
                type: "text",
                text: "Analyze these real estate photos for 'Negotiation Potential'. Rate the photo quality on a scale of 0-30 where 30 means the photos are terrible (messy, dark, blurry, unprofessional, outdated, cluttered) and 0 means they are professional, clean and perfect. Return ONLY a JSON object: { \"vision_score\": number, \"reasoning\": \"short explanation in Czech\" }"
            }
        ];

        for (const url of imageUrls.slice(0, 3)) {
            content.push({
                type: "image_url",
                image_url: { url: url }
            });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content }],
            max_tokens: 200,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        console.log(`[AI Vision] Score: ${result.vision_score}/30 | Notes: ${result.reasoning}`);
        return result;
    } catch (e) {
        console.error(`[AI Vision Error] ${e.message}`);
        return { vision_score: 0, reasoning: `Chyba analýzy fotek: ${e.message}` };
    }
}

async function analyzeGems() {
    console.log('================================================');
    console.log('   STARTING AUTOMATED HIDDEN GEMS EVALUATION');
    console.log('================================================');
    
    // 1. Fetch unprocessed active listings from all 4 portals
    const activePortals = ['annonce', 'avizo', 'hyperinzerce', 'bazos'];
    let allListings = [];
    
    for (const portal of activePortals) {
        const tableName = `listings_${portal}`;
        console.log(`Fetching active unprocessed listings from ${tableName}...`);
        try {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .eq('is_active', true)
                .eq('gem_score', 0)
                .limit(50); // Safe batch limits
                
            if (error) {
                console.error(`Error fetching from ${tableName}:`, error.message);
                continue;
            }
            
            if (data && data.length > 0) {
                console.log(`Loaded ${data.length} listings from ${tableName}`);
                allListings = allListings.concat(data.map(item => ({ ...item, portal })));
            }
        } catch (e) {
            console.error(`Exception fetching from ${tableName}:`, e.message);
        }
    }
    
    if (allListings.length === 0) {
        console.log('No new unprocessed listings found. Complete.');
        return;
    }
    
    console.log(`\nTotal candidate listings to process: ${allListings.length}`);
    
    // 2. Playwright Image & Description Scraper (Only launches if there is something to scrape)
    let browser = null;
    try {
        const candidatesNeedingScrape = allListings.filter(needsScraping);
        if (candidatesNeedingScrape.length > 0) {
            console.log(`[Crawler] Launching browser to visit URLs and scrape images for ${candidatesNeedingScrape.length} listings...`);
            browser = await chromium.launch({ headless: true });
        }
        
        for (const listing of allListings) {
            let description = listing.description || '';
            let images = listing.images || [];
            
            if (needsScraping(listing) && browser) {
                console.log(`[Crawler] Visiting URL: ${listing.url}`);
                try {
                    const page = await browser.newPage();
                    await page.route('**/*', (route) => {
                        const type = route.request().resourceType();
                        if (['media', 'font', 'stylesheet'].includes(type)) {
                            route.abort();
                        } else {
                            route.continue();
                        }
                    });
                    
                    await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    
                    if (listing.portal === 'bazos') {
                        description = await page.evaluate(() => {
                            const el = document.querySelector('.popisdetail');
                            return el ? el.innerText.trim() : '';
                        });
                        
                        images = await page.evaluate(() => {
                            const thumbnails = Array.from(document.querySelectorAll('.obrazekflithumb'));
                            let urls = thumbnails.map(img => img.src).filter(Boolean);
                            
                            if (urls.length === 0) {
                               const carouselImgs = Array.from(document.querySelectorAll('.carousel-cell-image'));
                               urls = carouselImgs.map(img => img.src || img.getAttribute('data-flickity-lazyload') || img.getAttribute('data-src')).filter(Boolean);
                            }
                            
                            // Convert thumbnails to high-res
                            return urls.map(u => u.replace(/\/img\/(\d+)t\//i, '/img/$1/'));
                        });
                    } else if (listing.portal === 'annonce') {
                        description = await page.evaluate(() => {
                            const el = document.querySelector('#popis, .popis, .advert-description, .detail-description');
                            return el ? el.innerText.trim() : '';
                        });
                        
                        images = await page.evaluate(() => {
                            const aElements = Array.from(document.querySelectorAll('a[href*="/attachment/"]'));
                            return [...new Set(aElements.map(a => a.href).filter(Boolean))];
                        });
                    } else if (listing.portal === 'avizo') {
                        description = await page.evaluate(() => {
                            const el = document.querySelector('.description, .detail-text, .inzerat-detail, .detail-desc');
                            return el ? el.innerText.trim() : '';
                        });
                        
                        images = await page.evaluate(() => {
                            const imgElements = Array.from(document.querySelectorAll('img'));
                            const urls = [];
                            imgElements.forEach(img => {
                                const src = img.getAttribute('data-src') || img.src;
                                if (src && (src.includes('fotos_redir') || src.includes('redir')) && !src.includes('logo') && !src.includes('makleri')) {
                                    urls.push(src.startsWith('/') ? 'https://www.avizo.cz' + src : src);
                                }
                            });
                            return [...new Set(urls)];
                        });
                    } else if (listing.portal === 'hyperinzerce') {
                        description = await page.evaluate(() => {
                            const el = document.querySelector('.description, .detail-text');
                            return el ? el.innerText.trim() : '';
                        });
                        
                        images = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('.gallery img, img.gallery-image'))
                                .map(img => img.src || img.getAttribute('data-src')).filter(Boolean);
                        });
                    }
                    
                    await page.close();
                    console.log(`[Crawler] Extracted description length: ${description.length} | Images: ${images.length}`);
                    
                    // Save scraped content to DB immediately
                    const tableName = `listings_${listing.portal}`;
                    await supabase
                        .from(tableName)
                        .update({ description, images })
                        .eq('id', listing.id);
                        
                } catch (err) {
                    console.error(`[Crawler] Scrape error for ${listing.url}: ${err.message}`);
                }
            }
            
            // 3. Process specifications, validate target criteria, run AI and sync
            const tableName = `listings_${listing.portal}`;
            
            // A. Parse specs on the fly
            let price = listing.price_numeric;
            if (!price && listing.price_raw) {
                price = parseInt(listing.price_raw.replace(/\D/g, '')) || 0;
            }
            
            let area = listing.metadata?.area_m2;
            if (!area) {
                const areaMatch = `${listing.title} ${description}`.toLowerCase().match(/(\d+)\s*(?:m2|m²|metrů|metru)/);
                if (areaMatch) {
                    area = parseInt(areaMatch[1], 10);
                }
            }
            
            let disposition = listing.metadata?.disposition;
            if (!disposition) {
                const dispMatch = `${listing.title} ${description}`.toLowerCase().match(/(\d\s*[\+\:]\s*(?:kk|1))/i);
                if (dispMatch) {
                    disposition = dispMatch[0].replace(/\s/g, '').toLowerCase();
                }
            }
            
            // Re-map internally
            listing.price_numeric = price;
            listing.description = description;
            listing.images = images;
            
            if (!listing.metadata) listing.metadata = {};
            listing.metadata.area_m2 = area;
            listing.metadata.disposition = disposition;
            
            // B. Apply filters
            const titleText = (listing.title || '').toLowerCase();
            const isWanted = titleText.includes('hledám') || titleText.includes('hledam') ||
                             titleText.includes('koupím') || titleText.includes('koupim') ||
                             titleText.includes('poptávám') || titleText.includes('poptavam');
                             
            const isScrapedAsBuilding = listing.metadata?.property_type === 'bytovy_dom';
            const hasBuildingKeywords = detectIfBuilding(listing.title || '', description);
            const isBuilding = isScrapedAsBuilding || hasBuildingKeywords;
            const isFlat = !isBuilding && detectIfFlat(listing.title || '', description);
            
            const hasValidArea = isBuilding || (area > 0 && area <= 80);
            
            let distanceKm = listing.metadata?.distance_km;
            let isWithinRange = true;
            
            // Check region by location text or zip
            const isPragueOrStredocesky = (listing.location_zip && (listing.location_zip.startsWith('1') || listing.location_zip.startsWith('2'))) ||
                                         /středočeský|stredocesky|praha/i.test(listing.location || '') ||
                                         /kladno|mělník|melnik|benešov|benesov|nymburk|beroun|příbram|pribram|kutná hora|kutna hora|kolín|kolin|mladá boleslav|mlada boleslav|rakovník|rakovnik/i.test(listing.location || '');
            
            if (isBuilding) {
                isWithinRange = isPragueOrStredocesky;
            } else {
                if (distanceKm === undefined || distanceKm === null) {
                    console.log(`[Distance] Calculating distance for: "${listing.location}" (${listing.location_zip || 'no zip'})...`);
                    const distResult = await checkDistance(listing.location, listing.location_zip);
                    distanceKm = distResult.distanceKm;
                    isWithinRange = distResult.isWithinRange;
                    listing.metadata.distance_km = distanceKm;
                } else {
                    isWithinRange = distanceKm <= 35;
                }
            }
            
            let realPhone = (listing.phone || '').replace(/[^0-9+]/g, '');
            if (realPhone.startsWith('420') && realPhone.length === 12) {
                realPhone = `+${realPhone}`;
            } else if (realPhone.length === 9 && (realPhone.startsWith('6') || realPhone.startsWith('7'))) {
                realPhone = `+420${realPhone}`;
            }
            const isMobile = /(?:\+420)?[67][0-9]{8}$/.test(realPhone);
            
            let isAgent = listing.is_agent || false;
            if (realPhone) {
                const isPhoneRegisteredToOtherListings = await checkPhoneBrokerDB(realPhone, listing.id);
                if (isPhoneRegisteredToOtherListings) {
                    isAgent = true;
                }
            }
            
            // C. Rejection updates in DB
            const isNewBuild = titleText.includes('novostavb') || (description || '').toLowerCase().includes('novostavb');
            
            let rejectReason = '';
            if (isWanted) rejectReason = 'Poptávka (Hledám/Koupím)';
            else if (isNewBuild) rejectReason = 'Novostavba';
            else if (!isFlat && !isBuilding) rejectReason = 'Není to byt ani činžovní/bytový dům';
            else if (!hasValidArea) rejectReason = `Plocha ${area} m² nesplňuje limit (do 80 m²)`;
            else if (!isWithinRange) rejectReason = isBuilding
                ? `Lokalita "${listing.location}" není v Praze ani ve Středočeském kraji`
                : `Vzdálenost ${distanceKm ? distanceKm.toFixed(1) + ' km' : 'neznámá'} překračuje limit 35 km od Prahy`;
            else if (!isMobile) rejectReason = `Telefonní číslo "${realPhone}" není platný český mobil`;
            
            if (rejectReason) {
                console.log(`[REJECTED] Skipping ${listing.url}: ${rejectReason}`);
                await supabase
                    .from(tableName)
                    .update({
                        gem_score: -1.0,
                        gem_notes: `Vyřazeno: ${rejectReason}`,
                        price_numeric: price,
                        is_agent: isAgent,
                        metadata: listing.metadata
                    })
                    .eq('id', listing.id);
                continue;
            }
            
            // D. Candidate valuation
            console.log(`\n[VALIDATED ${isBuilding ? 'BUILDING' : 'FLAT'}] Evaluating candidate: "${listing.title}"...`);
            
            const itemForAI = {
                title: listing.title,
                description: description,
                location: listing.location,
                location_zip: listing.location_zip || '',
                price: price,
                area_m2: area,
                floor: listing.metadata?.floor || 'unknown',
                ownership: listing.metadata?.ownership || 'Osobní',
                disposition: disposition
            };
            
            // Text evaluation
            let aiResult = { gem_score: 50, gem_notes: 'Chyba analýzy.', distress_factor: 'Žádný', estimated_market_value: price };
            try {
                aiResult = await withTimeout(analyzeListingWithAI(itemForAI), 15000, 'AI Text Timeout');
            } catch (aiErr) {
                console.error(`AI text analyzer failed for ${listing.id}:`, aiErr.message);
            }
            
            // Vision evaluation
            let visionResult = { vision_score: 0, reasoning: 'Žádné fotky k dispozici.' };
            if (images.length > 0) {
                try {
                    visionResult = await withTimeout(analyzeImagesWithAI(images), 15000, 'AI Vision Timeout');
                } catch (vErr) {
                    console.error(`AI vision analyzer failed for ${listing.id}:`, vErr.message);
                }
            }
            
            // Combine Scores
            let finalScore = Math.round((aiResult.gem_score * 0.7) + (visionResult.vision_score || 0));
            if (aiResult.distress_factor && aiResult.distress_factor !== 'Žádný') {
                finalScore = Math.min(finalScore + 10, 100);
            }
            finalScore = Math.max(finalScore, 50); // Guarantee 50+ score for validated owners
            
            const combinedNotes = `${aiResult.gem_notes} [Vizuální analýza: ${visionResult.reasoning}]`;
            
            console.log(`  -> Final Gem Score: ${finalScore}/100`);
            console.log(`  -> Notes: ${combinedNotes}`);
            
            // E. Save results to DB
            try {
                await supabase
                    .from(tableName)
                    .update({
                        price_numeric: price,
                        is_agent: isAgent,
                        gem_score: finalScore,
                        gem_notes: combinedNotes,
                        metadata: {
                            ...listing.metadata,
                            estimated_market_value: aiResult.estimated_market_value,
                            distress_factor: aiResult.distress_factor,
                            vision_score: visionResult.vision_score,
                            vision_reasoning: visionResult.reasoning,
                            property_type: isBuilding ? 'bytovy_dom' : 'byt'
                        }
                    })
                    .eq('id', listing.id);
                console.log(`  -> Database successfully updated.`);
            } catch (dbErr) {
                console.error(`  -> Failed database update:`, dbErr.message);
            }
            
            // F. CRM Webhook sync
            const cleanTitle = (typeof listing.title === 'string' && listing.title.startsWith('{')) 
                ? JSON.parse(listing.title).value 
                : listing.title;
                
            let safeEmail = (listing.metadata?.contact_email || '').toLowerCase();
            if (!safeEmail.includes('@')) {
                safeEmail = `no-email-provided-${listing.id}@reality-hunter.cz`;
            }
            
            const tags = [`RealEstate_Gem`, isAgent ? 'BROKER' : 'OWNER', listing.portal.toUpperCase(), isBuilding ? 'BUILDING' : 'FLAT'];
            if (finalScore >= 70) tags.push('HIGH_PRIORITY');
            if (images.length === 0) tags.push('NO_PHOTOS_GEM');
            
            // Calculate additional fields for CRM mapping
            const pricePerM2 = (price && area) ? Math.round(price / area) : 0;
            const city = listing.location && listing.location.toLowerCase().includes('praha') ? 'Praha' : (listing.metadata?.city || 'Praha');
            
            // Okres (District)
            let okres = '';
            if (listing.location) {
                const match = listing.location.match(/(Praha\s*\d+)/i);
                if (match) okres = match[1].trim();
            }
            
            // Městská část (Prague district, e.g. Stodůlky)
            let mestskaCast = '';
            if (listing.location) {
                const match = listing.location.match(/Praha\s*\d*\s*-\s*([^,]+)/i);
                if (match) {
                    mestskaCast = match[1].trim();
                } else {
                    const districts = ['Stodůlky', 'Strašnice', 'Prosek', 'Michle', 'Žižkov', 'Břevnov', 'Karlín', 'Smíchov', 'Bohnice', 'Hloubětín', 'Záběhlice', 'Modřany', 'Vinohrady', 'Vršovice', 'Nusle', 'Libeň', 'Kobylisy', 'Chodov', 'Háje', 'Hostivař'];
                    const found = districts.find(d => listing.location.includes(d));
                    if (found) mestskaCast = found;
                }
            }
            
            // Street (Ulice)
            let street = '';
            if (listing.location && listing.location.includes(',')) {
                street = listing.location.split(',')[0].trim();
            }
            
            // Condition (Kondice)
            let kondice = 'Neznámý';
            const textLowerForFeatures = `${cleanTitle} ${description}`.toLowerCase();
            if (textLowerForFeatures.includes('novostavb')) kondice = 'Novostavba';
            else if (textLowerForFeatures.includes('po rekonstrukci') || textLowerForFeatures.includes('zrekonstruov')) kondice = 'Po rekonstrukci';
            else if (textLowerForFeatures.includes('před rekonstrukcí') || textLowerForFeatures.includes('pred rekonstrukci') || textLowerForFeatures.includes('k rekonstrukci')) kondice = 'Před rekonstrukcí';
            else if (textLowerForFeatures.includes('dobrý stav') || textLowerForFeatures.includes('dobrém stavu')) kondice = 'Dobrý stav';
            
            // Features (Sklep, vytah, terasa, parking)
            const hasVytah = /výtah|vytah/i.test(textLowerForFeatures) ? 'Ano' : 'Ne';
            const hasSklep = /sklep/i.test(textLowerForFeatures) ? 'Ano' : 'Ne';
            const hasTerasa = /terasa|balkón|balkon|lodžie|lodzie/i.test(textLowerForFeatures) ? 'Ano' : 'Ne';
            const hasParking = /parkování|parkovani|garáž|garaz|stání|stani/i.test(textLowerForFeatures) ? 'Ano' : 'Ne';
            
            // Energy rating (PENB)
            const penbMatch = textLowerForFeatures.match(/třídy\s+([A-G])|třída\s+([A-G])|en\.\s+náročnost\s+([A-G])|penb\s+([A-G])/i);
            const energyRating = penbMatch ? (penbMatch[1] || penbMatch[2] || penbMatch[3] || penbMatch[4]).toUpperCase() : 'G';
            
            // Discount vs market
            let discountVsMarket = 0;
            if (aiResult.estimated_market_value && price && price < aiResult.estimated_market_value) {
                discountVsMarket = Math.round(((aiResult.estimated_market_value - price) / aiResult.estimated_market_value) * 100);
            }

            try {
                console.log(`  -> Syncing verified gem to GHL CRM Webhook...`);
                await sendToWebhook({
                    id: listing.id,
                    portal: listing.portal,
                    external_id: listing.external_id || `${listing.portal}-${listing.id.substring(0,8)}`,
                    
                    // Basic fields
                    title: cleanTitle,
                    name: cleanTitle,
                    first_name: cleanTitle,
                    firstName: cleanTitle,
                    phone: realPhone,
                    email: safeEmail,
                    contact_name: cleanTitle,
                    contact_phone: realPhone,
                    contact_email: safeEmail,
                    description: description,
                    url: listing.url,
                    price: price,
                    price_numeric: price,
                    area_m2: area,
                    location: `${listing.location}, ${listing.location_zip || ''}`,
                    is_broker: isAgent,
                    is_broker_final: isAgent,
                    current_score: finalScore,
                    gem_score: finalScore,
                    hidden_gem_score: finalScore,
                    gem_notes: combinedNotes,
                    distress_factor: aiResult.distress_factor,
                    estimated_market_value: aiResult.estimated_market_value,
                    distance_km: distanceKm,
                    ghl_tags: tags.join(', '),
                    tags: tags.join(', '),
                    sync_timestamp: new Date().toISOString(),

                    // Mapped custom fields (Czech & English formats for n8n safety)
                    cena_m2: pricePerM2,
                    price_per_m2: pricePerM2,
                    
                    mestska_cast: mestskaCast,
                    mestskaCast: mestskaCast,
                    
                    vymera_nemovitost: area,
                    vymeraNemovitost: area,
                    property_size: area,
                    
                    podlazi: listing.metadata?.floor || '',
                    floor: listing.metadata?.floor || '',
                    
                    mesto: city,
                    city: city,
                    
                    nazev_inzeratu: cleanTitle,
                    ad_title: cleanTitle,
                    
                    okres: okres,
                    district: okres,
                    
                    ulice: street,
                    street: street,
                    
                    url_inzeratu: listing.url,
                    
                    zneni_inzeratu: description,
                    popis_inzeratu: description,
                    
                    vymera_pozemek: 0,
                    vymeraPozemek: 0,
                    land_size: 0,
                    
                    kondice: kondice,
                    condition: kondice,
                    
                    parking: hasParking,
                    
                    energy_rating: energyRating,
                    penb: energyRating,
                    
                    typ_nemovitosti: isBuilding ? 'bytový dům' : 'byt',
                    property_type: isBuilding ? 'building' : 'flat',
                    
                    discount_vs_market: discountVsMarket,
                    discount_percent: discountVsMarket,
                    
                    keywords: aiResult.distress_factor || '',
                    
                    broker: isAgent ? 'Ano' : 'Ne',
                    
                    sklep: hasSklep,
                    cellar: hasSklep,
                    
                    terasa: hasTerasa,
                    terrace: hasTerasa,
                    
                    vytah: hasVytah,
                    elevator: hasVytah
                });
                console.log(`  -> CRM Webhook sync success.`);
            } catch (crmErr) {
                console.error(`  -> CRM Webhook sync failed:`, crmErr.message);
            }
        }
    } catch (e) {
        console.error('Fatal Analyzer Error:', e.message);
    } finally {
        if (browser) {
            console.log('[Crawler] Closing browser...');
            await browser.close().catch(() => {});
        }
    }
    
    console.log('================================================');
    console.log('   AUTOMATED HIDDEN GEMS EVALUATION COMPLETE');
    console.log('================================================\n');
}

if (require.main === module) {
    analyzeGems().catch(console.error);
}

module.exports = analyzeGems;
