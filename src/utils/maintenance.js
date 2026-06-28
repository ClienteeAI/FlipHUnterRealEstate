const supabase = require('../db/client');
const { updateContactStats } = require('../db/storage');
const analyzer = require('../analysis/analyzer');

async function maintenance() {
    console.log('=== STARTING MAINTENANCE: BACKFILL & ANALYSIS ===');
    
    // 1. Backfill Broker Detection
    console.log('Fetching all listings for broker detection...');
    let allListings = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: listings, error } = await supabase
            .from('listings')
            .select('*')
            .range(from, from + step - 1);
        
        if (error) {
            console.error('Error fetching listings:', error.message);
            break;
        }

        allListings = allListings.concat(listings);
        console.log(`Fetched ${allListings.length} listings...`);
        
        if (listings.length < step) hasMore = false;
        else from += step;
    }

    console.log(`Processing ${allListings.length} listings for broker detection...`);
    for (const listing of allListings) {
        if (listing.contact_phone || listing.contact_email) {
            await updateContactStats(listing);
        }
    }
    console.log('Broker detection backfill complete.');

    // 2. Run Global Analysis
    console.log('Running global gem analysis...');
    // We already have the analyzer.js, but let's make it smarter or just run it.
    // I'll call the analyzeGems function directly.
    const analyzeGems = require('../analysis/analyzer');
    await analyzeGems();
    
    console.log('=== MAINTENANCE COMPLETE ===');
}

if (require.main === module) {
    maintenance();
}
