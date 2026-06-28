const runEnrichment = require('./analysis/url_enricher');
const analyzeGems = require('./analysis/analyzer');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startFastWorker() {
    console.log('====================================================');
    console.log('=== REAL ESTATE FAST WORKER STARTED (DAEMON MODE) ===');
    console.log('=== Checks and syncs new gems every 2 minutes    ===');
    console.log('====================================================');
    
    const WAIT_TIME_MS = 2 * 60 * 1000; // 2 minutes
    
    while (true) {
        console.log(`\n--- Starting Fast Cycle at ${new Date().toISOString()} ---`);
        try {
            // 1. Enrich missing URLs (geocoding, etc.)
            console.log('Step 1: Running location geocoding & enrichment...');
            await runEnrichment();
            
            // 2. Analyze new gems and sync to GHL CRM
            console.log('Step 2: Analyzing new gems and syncing to GoHighLevel CRM...');
            await analyzeGems();
            
        } catch (e) {
            console.error('Fast worker encountered an error:', e.message);
        }
        
        console.log(`--- Fast Cycle Finished. Sleeping for 2 minutes... ---`);
        await sleep(WAIT_TIME_MS);
    }
}

if (require.main === module) {
    startFastWorker().catch(console.error);
}

module.exports = startFastWorker;
