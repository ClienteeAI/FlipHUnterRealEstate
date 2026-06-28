const scrapeAnnonce = require('../scrapers/annonce');
const scrapeAvizo = require('../scrapers/avizo');
const scrapeHyperinzerce = require('../scrapers/hyperinzerce');
const runEnrichment = require('../analysis/url_enricher');
const analyzeGems = require('../analysis/analyzer');

async function runPipeline() {
    console.log('================================================');
    console.log('   STARTING REAL ESTATE PIPELINE EXECUTION');
    console.log('================================================');
    
    // Step 1: Scrape new listings (excluding Bazos, Sreality, Bezrealitky!)
    try {
        console.log('\n--- STEP 1A: SCRAPING ANNONCE ---');
        await scrapeAnnonce();
    } catch (e) {
        console.error('Error scraping Annonce:', e.message);
    }

    try {
        console.log('\n--- STEP 1B: SCRAPING AVIZO ---');
        await scrapeAvizo();
    } catch (e) {
        console.error('Error scraping Avizo:', e.message);
    }

    try {
        console.log('\n--- STEP 1C: SCRAPING HYPERINZERCE ---');
        await scrapeHyperinzerce();
    } catch (e) {
        console.error('Error scraping Hyperinzerce:', e.message);
    }
    
    // Step 2: Enrich missing data
    try {
        console.log('\n--- STEP 2: ENRICHING URLS ACROSS ALL TABLES ---');
        await runEnrichment();
    } catch (e) {
        console.error('Error during URL enrichment:', e.message);
    }

    // Step 3: Analyze and Sync Gems
    try {
        console.log('\n--- STEP 3: ANALYZING GEMS & SYNCING TO CRM ---');
        await analyzeGems();
    } catch (e) {
        console.error('Error during gem analysis:', e.message);
    }

    console.log('\n================================================');
    console.log('   PIPELINE EXECUTION COMPLETE');
    console.log('================================================\n');
}

if (require.main === module) {
    runPipeline();
}

module.exports = runPipeline;
