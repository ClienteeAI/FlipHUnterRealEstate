const supabase = require('../src/db/client');

async function reprocessBrokers() {
    console.log('================================================');
    console.log('   STARTING REPROCESSING OF REJECTED BROKERS');
    console.log('================================================');

    const activePortals = ['annonce', 'avizo', 'hyperinzerce', 'bazos'];
    let totalResetCount = 0;

    for (const portal of activePortals) {
        const tableName = `listings_${portal}`;
        console.log(`Checking previously rejected broker listings in ${tableName}...`);

        try {
            // Fetch the listings that match criteria
            const { data, error } = await supabase
                .from(tableName)
                .select('id, url, gem_notes')
                .eq('gem_score', -1.0)
                .or('is_agent.eq.true,gem_notes.ilike.%zprostředkovatel%,gem_notes.ilike.%makléř%');

            if (error) {
                console.error(`Error querying ${tableName}:`, error.message);
                continue;
            }

            if (!data || data.length === 0) {
                console.log(`No rejected broker listings found in ${tableName}.`);
                continue;
            }

            console.log(`Found ${data.length} rejected broker listings in ${tableName}. Resetting in batches...`);

            const idsToReset = data.map(item => item.id);
            const batchSize = 100;
            let successCount = 0;

            for (let i = 0; i < idsToReset.length; i += batchSize) {
                const batchIds = idsToReset.slice(i, i + batchSize);
                
                const { error: updateErr } = await supabase
                    .from(tableName)
                    .update({
                        gem_score: 0,
                        gem_notes: 'Reset pro opětovné vyhodnocení (povolení makléřů)'
                    })
                    .in('id', batchIds);

                if (updateErr) {
                    console.error(`Error resetting batch ${i / batchSize + 1} in ${tableName}:`, updateErr.message);
                } else {
                    successCount += batchIds.length;
                }
            }

            console.log(`Successfully reset ${successCount}/${data.length} listings in ${tableName}.`);
            totalResetCount += successCount;

        } catch (e) {
            console.error(`Exception reprocessing ${tableName}:`, e.message);
        }
    }

    console.log('================================================');
    console.log(`   REPROCESSING COMPLETE. Total reset: ${totalResetCount}`);
    console.log('================================================\n');
}

reprocessBrokers().catch(console.error);
