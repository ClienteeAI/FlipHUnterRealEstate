const fs = require('fs');
const path = require('path');
const runAll = require('./index');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startWorker() {
    console.log('=== REAL ESTATE WORKER STARTED (LOOP MODE) ===');
    const WAIT_TIME_MS = 15 * 60 * 1000; // 15 minutes
    
    while (true) {
        console.log(`\n--- Starting Cycle at ${new Date().toISOString()} ---`);
        try {
            // Set a unique storage directory for this run to ensure fresh state
            const timestamp = Date.now();
            process.env.CRAWLEE_STORAGE_DIR = path.join(__dirname, `../storage/run_${timestamp}`);
            console.log(`Using fresh storage: ${process.env.CRAWLEE_STORAGE_DIR}`);
            
            await runAll();
        } catch (e) {
            console.error('Master runner crashed during cycle:', e.message);
        }
        
        console.log(`\n--- Cycle Finished. Sleeping for 15 minutes... ---`);
        await sleep(WAIT_TIME_MS);
    }
}

startWorker();
