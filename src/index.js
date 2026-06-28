const runPipeline = require('./pipeline/run_all');

async function main() {
    await runPipeline();
}

if (require.main === module) {
    main();
}

module.exports = main;
