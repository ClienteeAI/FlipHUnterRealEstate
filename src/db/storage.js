const fs = require('fs');
const path = require('path');
const supabase = require('./client');
const { sendToWebhook } = require('../utils/webhook');

const DATA_DIR = path.join(__dirname, '../../data');
const LOCAL_STORAGE_FILE = path.join(DATA_DIR, 'listings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function saveListing(listing) {
    console.log(`[Storage] Saving: ${listing.external_id}`);
    
    let existingListing = null;
    let priceDropped = false;
    let priceDropAmount = 0;
    let priceDropPercent = 0;
    let previousPrice = null;

    // 1. Try to find existing listing in portal-specific table (Supabase first, then local)
    try {
        const tableName = `listings_${listing.portal}`;
        const { data } = await supabase
            .from(tableName)
            .select('*')
            .eq('external_id', listing.external_id)
            .maybeSingle();
        
        if (data) existingListing = data;
    } catch (e) {
        console.warn(`[Storage] DB query failed for portal ${listing.portal}: ${e.message}`);
    }

    if (!existingListing && fs.existsSync(LOCAL_STORAGE_FILE)) {
        try {
            const localData = JSON.parse(fs.readFileSync(LOCAL_STORAGE_FILE, 'utf8'));
            existingListing = localData.find(l => l.portal === listing.portal && l.external_id === listing.external_id);
        } catch (e) {}
    }

    // 2. Logic for Price Drops and Tracking
    const oldPrice = existingListing ? (existingListing.price_numeric || existingListing.price) : null;
    const newPrice = listing.price || listing.price_numeric;

    if (existingListing && oldPrice && newPrice && newPrice < oldPrice) {
        priceDropped = true;
        priceDropAmount = oldPrice - newPrice;
        priceDropPercent = parseFloat(((priceDropAmount / oldPrice) * 100).toFixed(1));
        previousPrice = oldPrice;
        console.log(`[ALERT] Price drop detected: -${priceDropAmount} CZK (-${priceDropPercent}%) for ${listing.external_id}`);
    } else if (existingListing) {
        previousPrice = existingListing.previous_price || (existingListing.metadata && existingListing.metadata.previous_price) || null;
        priceDropAmount = existingListing.price_drop_amount || (existingListing.metadata && existingListing.metadata.price_drop_amount) || 0;
        priceDropPercent = existingListing.price_drop_percent || (existingListing.metadata && existingListing.metadata.price_drop_percent) || 0;
    }

    const finalRecord = {
        ...listing,
        is_active: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // Check if phone or email is already a known broker in contacts table
    let isAgent = listing.is_broker || listing.is_agent || false;
    const phoneNum = listing.contact_phone || listing.phone || '';
    const emailAddr = listing.contact_email || '';
    if (phoneNum || emailAddr) {
        try {
            let orQuery = [];
            if (phoneNum) orQuery.push(`phone.eq.${phoneNum}`);
            if (emailAddr) orQuery.push(`email.eq.${emailAddr}`);
            
            const { data: contact } = await supabase
                .from('contacts')
                .select('is_broker')
                .or(orQuery.join(','))
                .maybeSingle();
                
            if (contact && contact.is_broker) {
                isAgent = true;
                console.log(`[Storage] Contact ${phoneNum || emailAddr} is already recognized as a broker. Auto-flagging listing.`);
            }
        } catch (e) {
            console.warn(`[Storage] Error checking contact broker status: ${e.message}`);
        }
    }

    // 3. Save to Supabase
    try {
        const tableName = `listings_${listing.portal}`;
        
        const titleText = (finalRecord.title || '').toLowerCase();
        const descText = (finalRecord.description || '').toLowerCase();
        const isNewBuild = titleText.includes('novostavb') || descText.includes('novostavb');

        // Map standard listing object to the specific schema of individual portal tables
        const mappedRecord = {
            external_id: finalRecord.external_id,
            title: finalRecord.title,
            description: finalRecord.description || '',
            price_raw: finalRecord.price ? `${finalRecord.price} Kč` : 'dohodou',
            price_numeric: parseInt(newPrice) || 0,
            location: finalRecord.location || '',
            location_zip: finalRecord.location_zip || '',
            url: finalRecord.url,
            phone: phoneNum,
            is_agent: isAgent,
            images: finalRecord.images || [],
            gem_score: isNewBuild ? -1.0 : 0,
            gem_notes: isNewBuild ? 'Vyřazeno: Novostavba' : null,
            metadata: {
                ...(finalRecord.raw_data || {}),
                floor: finalRecord.floor || null,
                ownership: finalRecord.ownership || null,
                disposition: finalRecord.disposition || null,
                area_m2: finalRecord.area_m2 || null,
                previous_price: previousPrice,
                price_drop_amount: priceDropAmount,
                price_drop_percent: priceDropPercent
            },
            is_active: finalRecord.is_active,
            scraped_at: finalRecord.created_at || new Date().toISOString(),
            last_checked_at: finalRecord.last_seen_at || new Date().toISOString()
        };

        const { error } = await supabase
            .from(tableName)
            .upsert(mappedRecord, { onConflict: 'url' });

        if (!error) {
            console.log(`[Supabase] Success (${tableName}): ${listing.external_id}`);
            
            // Broker Detection Logic
            if (phoneNum || emailAddr) {
                await updateContactStats(listing);
            }

            return { success: true, source: 'supabase' };
        }
        console.warn(`[Supabase] RLS/Error on ${tableName} (falling back to local): ${error.message}`);
    } catch (e) {
        console.warn(`[Supabase] Exception on DB save: ${e.message}`);
    }

    // 4. Local Fallback
    try {
        let localData = [];
        if (fs.existsSync(LOCAL_STORAGE_FILE)) {
            localData = JSON.parse(fs.readFileSync(LOCAL_STORAGE_FILE, 'utf8'));
        }

        const index = localData.findIndex(l => l.portal === listing.portal && l.external_id === listing.external_id);
        if (index !== -1) {
            localData[index] = { 
                ...localData[index], 
                ...finalRecord,
                is_broker: isAgent,
                previous_price: previousPrice,
                price_drop_amount: priceDropAmount,
                price_drop_percent: priceDropPercent
            };
        } else {
            localData.push({ 
                ...finalRecord, 
                created_at: new Date().toISOString(),
                is_broker: isAgent,
                previous_price: previousPrice,
                price_drop_amount: priceDropAmount,
                price_drop_percent: priceDropPercent
            });
        }

        fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(localData, null, 2));
        console.log(`[Local] Success: ${listing.external_id}`);
        
        return { success: true, source: 'local' };
    } catch (e) {
        console.error(`[Storage] Fatal Local Error: ${e.message}`);
        return { success: false, error: e.message };
    }
}

async function updateContactStats(listing) {
    const phone = listing.contact_phone || listing.phone || '';
    const email = listing.contact_email || '';
    if (!phone && !email) return;

    try {
        let orQuery = [];
        if (phone) orQuery.push(`phone.eq.${phone}`);
        if (email) orQuery.push(`email.eq.${email}`);
        
        const { data: existing } = await supabase
            .from('contacts')
            .select('*')
            .or(orQuery.join(','))
            .maybeSingle();

        if (existing) {
            const newCount = (existing.listing_count || 0) + 1;
            const isBroker = newCount >= 2; // Threshold is 2 or more!
            
            await supabase
                .from('contacts')
                .update({ 
                    listing_count: newCount, 
                    is_broker: isBroker,
                    last_seen: new Date().toISOString()
                })
                .eq('id', existing.id);
            
            // If broker, cascade is_agent = true to all matching listings in all portal tables
            if (isBroker) {
                console.log(`[Broker Cascade] Contact ${phone || email} flagged as broker (listings count = ${newCount}). Cascading to listings...`);
                const portals = ['annonce', 'avizo', 'hyperinzerce', 'bazos', 'bazar_cz', 'inzerce_cz', 'ceskainzerce_cz'];
                for (const p of portals) {
                    const tableName = `listings_${p}`;
                    try {
                        if (phone) {
                            const { error: updateErr } = await supabase
                                .from(tableName)
                                .update({ is_agent: true })
                                .eq('phone', phone);
                            if (updateErr) {
                                console.warn(`[Broker Cascade] Error updating ${tableName} for phone ${phone}: ${updateErr.message}`);
                            }
                        }
                    } catch (err) {
                        console.warn(`[Broker Cascade] Exception in ${tableName}: ${err.message}`);
                    }
                }
            }
        } else {
            // First time seeing this contact
            await supabase
                .from('contacts')
                .insert({
                    phone: phone || null,
                    email: email || null,
                    name: listing.contact_name || '',
                    listing_count: 1,
                    is_broker: false
                });
        }
    } catch (e) {
        console.error(`[Broker Detection] Error: ${e.message}`);
    }
}

module.exports = {
    saveListing,
    updateContactStats
};
