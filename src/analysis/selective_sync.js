const client = require('../db/client');
const { analyzeListingWithAI } = require('./ai_analyzer');
const { sendToWebhook } = require('../utils/webhook');
const { checkDistance } = require('../utils/distance_helper');
require('dotenv').config();

// Parse command-line arguments
const args = {};
process.argv.forEach((val, index) => {
    if (val.startsWith('--')) {
        const key = val.substring(2);
        const nextVal = process.argv[index + 1];
        if (nextVal && !nextVal.startsWith('--')) {
            args[key] = nextVal;
        } else {
            args[key] = true;
        }
    }
});

async function run() {
    const portal = args.portal || 'bazos'; // 'bazos', 'avizo', 'annonce'
    const listingId = args.id;
    
    if (!listingId) {
        console.error("Error: Please provide --id <listing_uuid>");
        process.exit(1);
    }
    
    const tableName = `listings_${portal}`;
    console.log(`[Sync] Fetching candidate listing ${listingId} from ${tableName}...`);
    
    const { data: listing, error: fetchError } = await client
        .from(tableName)
        .select('*')
        .eq('id', listingId)
        .single();
        
    if (fetchError || !listing) {
        console.error(`[Sync] Error fetching listing from ${tableName}:`, fetchError || 'Listing not found.');
        process.exit(1);
    }
    
    console.log(`[Sync] Found listing: "${listing.title}"`);
    console.log(`[Sync] Raw Price: "${listing.price_raw}" | Phone: "${listing.phone}" | URL: "${listing.url}"`);
    
    // Parse specs from args or fallback to listing title/metadata
    const priceNumeric = parseInt(args.price) || parseInt(listing.price_numeric) || 0;
    const areaM2 = parseInt(args.area) || parseInt(listing.metadata?.area_m2) || 0;
    const disposition = args.disposition || listing.metadata?.disposition || 'unknown';
    const propertyType = args.property_type || listing.metadata?.property_type || 'flat';
    const ownership = args.ownership || listing.metadata?.ownership || 'Osobní';
    const floor = args.floor || listing.metadata?.floor || 'unknown';
    
    let isAgent = args.is_agent === 'true' || args.is_agent === true || listing.is_agent || false;

    // 🚨 DATABASE BROKER DUPLICATE PHONE CHECK 🚨
    const rawPhoneNum = (listing.phone || '').replace(/[^0-9]/g, '');
    console.log(`[Sync] Verifying phone number occurrences in DB for: ${rawPhoneNum}...`);
    const isPhoneRegisteredToOtherListings = await checkPhoneBrokerDB(rawPhoneNum, listing.id);
    if (isPhoneRegisteredToOtherListings) {
        console.warn(`[Sync] WARNING: Phone number ${rawPhoneNum} is registered to multiple active listings in the DB. Flagging as broker!`);
        isAgent = true;
    }

    console.log(`[Sync] Specifications:`);
    console.log(`  Price: ${priceNumeric} Kč`);
    console.log(`  Area: ${areaM2} m²`);
    console.log(`  Disposition: ${disposition}`);
    console.log(`  Property Type: ${propertyType}`);
    console.log(`  Ownership: ${ownership}`);
    console.log(`  Floor: ${floor}`);
    console.log(`  Is Agent/Broker: ${isAgent}`);

    // If it exceeds 80m2, we stop CRM syncing as per user requirement, but we still update the DB
    if (areaM2 > 80) {
        console.warn(`[Sync] WARNING: Area ${areaM2} m² exceeds the maximum limit of 80 m².`);
    }
    
    if (isAgent) {
        console.warn(`[Sync] WARNING: This is flagged as an agency/broker listing.`);
    }

    // Distance check for Prague + 35km
    console.log(`[Sync] Performing distance check for: "${listing.location}" (${listing.location_zip || 'no zip'})`);
    const distanceCheck = await checkDistance(listing.location, listing.location_zip);
    
    if (!distanceCheck.isWithinRange) {
        console.warn(`[Sync] SKIPPING CRM Lead: Location is outside Prague + 35km limit! Distance: ${distanceCheck.distanceKm ? distanceCheck.distanceKm.toFixed(1) + ' km' : 'unknown'}`);
    }

    let aiResult = {
        gem_score: 50,
        gem_notes: "Předběžné posouzení",
        distress_factor: "Žádný",
        estimated_market_value: priceNumeric
    };

    // Only run AI Analyzer and trigger CRM if it fits the user criteria:
    // Flat, <= 80 m2, NOT an agency, and within Prague + 35km radius
    const matchesFilters = (propertyType === 'flat' && areaM2 <= 80 && !isAgent && distanceCheck.isWithinRange);

    if (matchesFilters) {
        console.log('[Sync] Listing matches all filters. Running GPT-4o-mini Deal Analyzer...');
        
        const enrichedListingForAI = {
            title: listing.title,
            description: listing.description,
            location: listing.location,
            location_zip: listing.location_zip,
            price: priceNumeric,
            area_m2: areaM2,
            floor: floor,
            ownership: ownership,
            disposition: disposition
        };
        
        try {
            aiResult = await analyzeListingWithAI(enrichedListingForAI);
            console.log('[Sync] AI Analysis Success:', JSON.stringify(aiResult, null, 2));
        } catch (err) {
            console.error('[Sync] AI Analyzer failed, using defaults:', err.message);
        }
    } else {
        console.log('[Sync] Listing does NOT match the direct-owner flat <= 80 m² within 35km criteria. Skipping AI Analyzer and CRM webhook.');
    }

    console.log('[Sync] Updating Supabase record...');
    const { error: updateError } = await client
        .from(tableName)
        .update({
            price_numeric: priceNumeric,
            is_agent: isAgent,
            gem_score: matchesFilters ? aiResult.gem_score : 0,
            gem_notes: matchesFilters ? aiResult.gem_notes : (!distanceCheck.isWithinRange ? 'Tato nemovitost je mimo požadovaný rádius 35 km od Prahy.' : 'Tato nemovitost nesplňuje kritéria pro byt do 80 m² od přímého majitele.'),
            last_checked_at: new Date().toISOString(),
            metadata: {
                ...listing.metadata,
                area_m2: areaM2,
                disposition: disposition,
                property_type: propertyType,
                ownership: ownership,
                floor: floor,
                distance_km: distanceCheck.distanceKm,
                distress_factor: matchesFilters ? aiResult.distress_factor : 'Žádný',
                estimated_market_value: matchesFilters ? aiResult.estimated_market_value : priceNumeric
            }
        })
        .eq('id', listingId);

    if (updateError) {
        console.error('[Sync] Supabase Update Error:', updateError.message);
        process.exit(1);
    }
    
    console.log('[Sync] Supabase successfully updated.');

    if (matchesFilters) {
        // Enforce valid phone number format with +420
        let realPhone = (listing.phone || '').replace(/[^0-9+]/g, '');
        if (realPhone.startsWith('420') && realPhone.length === 12) {
            realPhone = `+${realPhone}`;
        } else if (realPhone.length === 9 && (realPhone.startsWith('6') || realPhone.startsWith('7'))) {
            realPhone = `+420${realPhone}`;
        }

        let safeEmail = (listing.contact_email || '').toLowerCase();
        if (!safeEmail.includes('@')) {
            safeEmail = `no-email-provided-${listing.external_id || listing.id}@reality-hunter.cz`;
        }

        // Construct LeadConnector CRM Payload
        const leadPayload = {
            id: listing.id,
            portal: portal,
            external_id: listing.external_id || `${portal}-${listingId.substring(0,8)}`,
            title: listing.title,
            name: listing.title,
            first_name: listing.title,
            firstName: listing.title,
            phone: realPhone,
            email: safeEmail,
            contact_name: listing.title,
            description: listing.description,
            url: listing.url,
            price: priceNumeric,
            price_numeric: priceNumeric,
            area_m2: areaM2,
            location: `${listing.location}, ${listing.location_zip || ''}`,
            contact_phone: realPhone,
            contact_email: safeEmail,
            is_broker: false,
            is_broker_final: false,
            current_score: aiResult.gem_score,
            gem_score: aiResult.gem_score,
            gem_notes: aiResult.gem_notes,
            distress_factor: aiResult.distress_factor,
            estimated_market_value: aiResult.estimated_market_value,
            distance_km: distanceCheck.distanceKm,
            ghl_tags: `RealEstate_Gem, OWNER, ${portal.toUpperCase()}, FLAT, HIGH_PRIORITY`,
            tags: `RealEstate_Gem, OWNER, ${portal.toUpperCase()}, FLAT, HIGH_PRIORITY`,
            sync_timestamp: new Date().toISOString()
        };
        
        console.log('[Sync] Sending verified direct-owner flat lead to LeadConnector CRM Webhook...');
        await sendToWebhook(leadPayload);
        console.log('[Sync] Lead successfully delivered to CRM.');
    }

    console.log('[Sync] Run complete.');
}

async function checkPhoneBrokerDB(phone, currentListingId) {
    if (!phone) return false;
    
    // Extract last 9 digits to get standardized number
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
            const { data, error } = await client
                .from(tableName)
                .select('id, phone')
                .eq('is_active', true)
                .or(`phone.ilike.%${cleanPhone}%`);
                
            if (error) {
                continue;
            }
            
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

run().catch(console.error);
