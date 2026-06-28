// ============================================================================
// RUN CYCLE — the full data refresh, one command. For cron on the VPS.
//   sync (landing → properties) → normalize → evaluate (AVM+flip) → liveness
//
//   node src/run_cycle.js
// ============================================================================

const { syncAll } = require('./db/sync_to_properties');
const { normalize } = require('./db/normalize_properties');
const { run: evaluateRun } = require('./engine/evaluate_run');
const { run: checkLiveness } = require('./db/check_liveness');

async function cycle() {
    const t0 = Date.now();
    console.log('================ RUN CYCLE START ', new Date().toISOString(), '================');

    const step = async (name, fn) => {
        const s = Date.now();
        console.log(`\n>>> ${name} ...`);
        try { await fn(); console.log(`<<< ${name} done (${((Date.now() - s) / 1000).toFixed(1)}s)`); }
        catch (e) { console.error(`!!! ${name} FAILED: ${e.message}`); }
    };

    await step('1/4 SYNC landing → properties', syncAll);
    await step('2/4 NORMALIZE (disposition/type/district/area/ownership)', normalize);
    await step('3/4 EVALUATE (AVM + flip scoring)', evaluateRun);
    await step('4/4 LIVENESS (prune dead leads)', checkLiveness);

    console.log(`\n================ RUN CYCLE DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s ================`);
}

if (require.main === module) {
    cycle().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = cycle;
