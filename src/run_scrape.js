// ============================================================================
// RUN SCRAPE — our own portals (annonce / avizo / hyperinzerce) into the landing
// tables. Bazoš is an external feed, so it's NOT scraped here. Needs Playwright
// + Chromium (so it runs where browsers are installed, e.g. a daily VPS cron).
//
// Each scraper runs in its OWN child process — Crawlee keeps a per-process global
// request queue/state, so running them in one process makes the 2nd/3rd think
// they're already done. Separate processes = clean isolated state.
//
//   node src/run_scrape.js
// ============================================================================

const { spawnSync } = require('child_process');
const path = require('path');

const SCRAPERS = ['annonce', 'avizo', 'hyperinzerce'];

function runScrape() {
    console.log('================ RUN SCRAPE ', new Date().toISOString(), '================');
    for (const s of SCRAPERS) {
        const t0 = Date.now();
        console.log(`\n>>> SCRAPE ${s} ...`);
        const r = spawnSync('node', [path.join(__dirname, 'scrapers', `${s}.js`)], { stdio: 'inherit' });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (r.status === 0) console.log(`<<< SCRAPE ${s} done (${secs}s)`);
        else console.error(`!!! SCRAPE ${s} exited with ${r.status ?? r.signal} (${secs}s)`);
    }
    console.log('\n================ RUN SCRAPE DONE ================');
}

if (require.main === module) {
    runScrape();
}

module.exports = runScrape;
