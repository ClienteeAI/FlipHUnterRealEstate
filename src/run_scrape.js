// ============================================================================
// RUN SCRAPE — our own portals (annonce / avizo / hyperinzerce) into the landing
// tables. Bazoš is an external feed, so it's NOT scraped here. Needs Playwright
// + Chromium (so it runs where browsers are installed, e.g. a daily VPS cron),
// separate from run_cycle (which is browser-free).
//
//   node src/run_scrape.js
// ============================================================================

const scrapeAnnonce = require('./scrapers/annonce');
const scrapeAvizo = require('./scrapers/avizo');
const scrapeHyperinzerce = require('./scrapers/hyperinzerce');

async function runScrape() {
    console.log('================ RUN SCRAPE ', new Date().toISOString(), '================');
    const step = async (name, fn) => {
        const s = Date.now();
        console.log(`\n>>> ${name} ...`);
        try { await fn(); console.log(`<<< ${name} done (${((Date.now() - s) / 1000).toFixed(1)}s)`); }
        catch (e) { console.error(`!!! ${name} FAILED: ${e.message}`); }
    };
    await step('SCRAPE annonce', scrapeAnnonce);
    await step('SCRAPE avizo', scrapeAvizo);
    await step('SCRAPE hyperinzerce', scrapeHyperinzerce);
    console.log('\n================ RUN SCRAPE DONE ================');
}

if (require.main === module) {
    runScrape().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = runScrape;
