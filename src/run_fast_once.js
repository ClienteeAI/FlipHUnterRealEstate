const runEnrichment = require('./analysis/url_enricher');
const analyzeGems = require('./analysis/analyzer');

async function main() {
    console.log(`=== RUNNING FAST ENRICHMENT & GEM ANALYSIS (ONE-SHOT) at ${new Date().toISOString()} ===`);
    try {
        console.log('Step 1: Running location geocoding & enrichment...');
        await runEnrichment();
        
        console.log('Step 2: Analyzing new gems and syncing to GoHighLevel CRM...');
        await analyzeGems();
        
        console.log('=== FAST ONE-SHOT RUN COMPLETE ===');
        process.exit(0);
    } catch (e) {
        console.error('Error during fast run:', e.message);
        process.exit(1);
    }
}

main();
