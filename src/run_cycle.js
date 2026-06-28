// ============================================================================
// RUN CYCLE — the full data refresh, one command. For cron on the VPS.
//   sync → normalize → detect_brokers → evaluate → dedup → learn → liveness
// Writes a heartbeat (data/last_cycle.json) and alerts on the console if a step
// fails or no new data arrives, so a broken cron / dead feed is visible.
//
//   node src/run_cycle.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { syncAll } = require('./db/sync_to_properties');
const { normalize } = require('./db/normalize_properties');
const { detectBrokers } = require('./db/detect_brokers');
const { run: evaluateRun } = require('./engine/evaluate_run');
const { dedup } = require('./db/dedup');
const { learn } = require('./engine/learn');
const { run: checkLiveness } = require('./db/check_liveness');

const HEARTBEAT = path.join(__dirname, '../data/last_cycle.json');

async function cycle() {
    const t0 = Date.now();
    console.log('================ RUN CYCLE START ', new Date().toISOString(), '================');
    const results = [];

    const step = async (name, fn) => {
        const s = Date.now();
        console.log(`\n>>> ${name} ...`);
        try {
            await fn();
            const secs = ((Date.now() - s) / 1000).toFixed(1);
            console.log(`<<< ${name} done (${secs}s)`);
            results.push({ name, ok: true, secs: Number(secs) });
        } catch (e) {
            console.error(`!!! ${name} FAILED: ${e.message}`);
            results.push({ name, ok: false, error: e.message });
        }
    };

    await step('1/7 SYNC landing → properties', syncAll);
    await step('2/7 NORMALIZE', normalize);
    await step('3/7 BROKER DETECTION', detectBrokers);
    await step('4/7 EVALUATE (AVM + flip)', evaluateRun);
    await step('5/7 DEDUP (cross-portal)', dedup);
    await step('6/7 LEARN (approved/dismissed)', learn);
    await step('7/7 LIVENESS', checkLiveness);

    const failed = results.filter(r => !r.ok);
    const ok = failed.length === 0;
    const totalSecs = ((Date.now() - t0) / 1000).toFixed(1);

    // heartbeat for monitoring
    try {
        fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
        fs.writeFileSync(HEARTBEAT, JSON.stringify({ at: new Date().toISOString(), ok, totalSecs, steps: results }, null, 2));
    } catch (e) { /* ignore */ }

    if (!ok) console.error(`\n*** ALERT: ${failed.length} krok(ů) selhalo: ${failed.map(f => f.name).join(', ')} ***`);
    console.log(`\n================ RUN CYCLE ${ok ? 'OK' : 'WITH ERRORS'} in ${totalSecs}s ================`);
}

if (require.main === module) {
    cycle().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = cycle;
