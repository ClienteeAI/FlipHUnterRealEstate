const client = require('../db/client');
const { analyzeListingWithAI } = require('./ai_analyzer');
const { sendToWebhook } = require('../utils/webhook');
require('dotenv').config();

async function run() {
    // We selected the 100% genuine Hradištko Direct-Owner RD 4+1 listing from listings_bazos
    const listingId = 'f9e990b4-7de3-4909-b6d8-9ecaa385a47e';
    console.log(`[Processor] Fetching listing ${listingId} from listings_bazos...`);
    
    const { data: listing, error: fetchError } = await client
        .from('listings_bazos')
        .select('*')
        .eq('id', listingId)
        .single();
        
    if (fetchError || !listing) {
        console.error('[Processor] Error fetching listing:', fetchError || 'Listing not found.');
        return;
    }
    
    console.log(`[Processor] Found listing: "${listing.title}"`);
    console.log(`[Processor] Raw Price: "${listing.price_raw}" | Phone: "${listing.phone}" | URL: "${listing.url}"`);
    
    // Parse attributes for AI
    const numericPrice = 8495000; // 8.495.000 Kč from raw price
    const areaM2 = 110; // 110 m2 from description
    
    const enrichedListingForAI = {
        title: listing.title,
        description: listing.description,
        location: listing.location,
        location_zip: listing.location_zip,
        price: numericPrice,
        area_m2: areaM2,
        floor: 'rodinný dům',
        ownership: 'Osobní',
        disposition: '4+1'
    };
    
    console.log('[Processor] Evaluating listing with GPT-4o-mini...');
    const aiResult = await analyzeListingWithAI(enrichedListingForAI);
    console.log('[Processor] AI Evaluation Results:', JSON.stringify(aiResult, null, 2));
    
    console.log('[Processor] Updating database record with AI score and notes...');
    const { error: updateError } = await client
        .from('listings_bazos')
        .update({
            gem_score: aiResult.gem_score,
            gem_notes: aiResult.gem_notes,
            price_numeric: numericPrice,
            is_agent: false,
            metadata: {
                ...listing.metadata,
                distress_factor: aiResult.distress_factor,
                estimated_market_value: aiResult.estimated_market_value,
                area_m2: areaM2,
                disposition: '4+1',
                property_type: 'house'
            }
        })
        .eq('id', listingId);
        
    if (updateError) {
        console.error('[Processor] Error updating database:', updateError.message);
    } else {
        console.log('[Processor] Database successfully updated.');
    }
    
    // Construct LeadConnector CRM Payload
    const leadPayload = {
        id: listing.id,
        portal: "bazos",
        external_id: "praha-zapad-prodej-rd-41",
        title: listing.title,
        description: listing.description,
        url: listing.url,
        price: numericPrice,
        price_numeric: numericPrice,
        area_m2: areaM2,
        location: `${listing.location}, ${listing.location_zip}`,
        contact_phone: listing.phone,
        contact_email: "",
        is_broker: false,
        is_broker_final: false,
        current_score: aiResult.gem_score,
        gem_score: aiResult.gem_score,
        gem_notes: aiResult.gem_notes,
        distress_factor: aiResult.distress_factor,
        estimated_market_value: aiResult.estimated_market_value,
        ghl_tags: "RealEstate_Gem, OWNER, BAZOS, HOUSE, HIGH_PRIORITY",
        tags: "RealEstate_Gem, OWNER, BAZOS, HOUSE, HIGH_PRIORITY",
        sync_timestamp: new Date().toISOString()
    };
    
    console.log('[Processor] Sending 100% genuine Direct-Owner lead to LeadConnector webhook...');
    await sendToWebhook(leadPayload);
    console.log('[Processor] Process complete.');
}

run().catch(console.error);
