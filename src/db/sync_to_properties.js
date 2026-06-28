// ============================================================================
// SYNC: per-portal landing tables  ->  canonical `properties` table.
// ----------------------------------------------------------------------------
// The per-portal tables (listings_bazos, listings_annonce, ...) stay as the
// RAW LANDING ZONE. Bazoš arrives there from an EXTERNAL feed we don't control;
// our own scrapers write there too. This job reads them and upserts a normalized
// row into `properties` (the single source of truth for AVM + evaluator + UI).
//
// Idempotent: re-running updates existing rows (and the price_history trigger on
// `properties` captures any price changes automatically). first_seen_at is left
// to the table DEFAULT so re-syncs never push it forward.
//
// Run:  node src/db/sync_to_properties.js
// Requires: schema_canonical.sql already applied in Supabase.
// ============================================================================

const supabase = require('./client');

// Landing tables to consolidate. Bazoš = external feed, rest = our scrapers.
const PORTALS = ['bazos', 'annonce', 'avizo', 'hyperinzerce'];
const PAGE_SIZE = 1000;

// --- Středočeský okresy + Praha, for light district normalization. ----------
const STREDOCESKY_OKRESY = [
    'Benešov', 'Beroun', 'Kladno', 'Kolín', 'Kutná Hora', 'Mělník',
    'Mladá Boleslav', 'Nymburk', 'Praha-východ', 'Praha-západ',
    'Příbram', 'Rakovník'
];

function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Best-effort district (okres) extraction from free-text location.
// Proper geocoding is a later enrichment step; this is enough to seed AVM cohorts.
function extractDistrict(location, metadata) {
    if (metadata && metadata.district) return metadata.district;
    const loc = stripDiacritics(location || '').toLowerCase();
    if (!loc) return null;

    // Praha 1..10
    const praha = loc.match(/praha\s*-?\s*(\d{1,2})/);
    if (praha) return `Praha ${praha[1]}`;
    if (loc.includes('praha')) return 'Praha';

    for (const okres of STREDOCESKY_OKRESY) {
        if (loc.includes(stripDiacritics(okres).toLowerCase())) return okres;
    }
    return null;
}

function mapPropertyType(metadata) {
    const t = metadata && metadata.property_type;
    if (t === 'bytovy_dom' || t === 'bytovy_dum') return 'bytovy_dum';
    if (t === 'byt') return 'byt';
    return null; // resolved later by the evaluator/enrichment from title/desc
}

function computePricePerM2(price, area) {
    if (price && area && area > 0) return Math.round(Number(price) / Number(area));
    return null;
}

// Map a raw landing row -> canonical properties row.
function mapRow(portal, row) {
    const md = row.metadata || {};
    const area = md.area_m2 ?? null;
    return {
        portal,
        external_id: row.external_id || null,
        url: row.url,
        source_type: portal === 'bazos' ? 'feed' : 'scraped',

        title: row.title || null,
        description: row.description || null,
        price_raw: row.price_raw || null,
        price_numeric: row.price_numeric || null,
        currency: 'CZK',

        location_raw: row.location || null,
        region: md.region || null,
        district: extractDistrict(row.location, md),
        municipality: row.location || null,
        location_zip: row.location_zip || null,

        property_type: mapPropertyType(md),
        disposition: md.disposition || null,
        area_m2: area,
        floor: md.floor || null,
        ownership: md.ownership || null,
        price_per_m2: computePricePerM2(row.price_numeric, area),

        images: row.images || [],
        contact_phone: row.phone || null,
        is_agent: row.is_agent || false,

        is_active: row.is_active !== false,
        last_seen_at: new Date().toISOString(),
        raw_data: md
        // NOTE: first_seen_at intentionally omitted -> DB DEFAULT now() on insert,
        //       untouched on update.
    };
}

async function syncPortal(portal) {
    const table = `listings_${portal}`;
    let from = 0;
    let total = 0;

    for (;;) {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .order('last_checked_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.warn(`[Sync] ${table}: read error: ${error.message}`);
            break;
        }
        if (!data || data.length === 0) break;

        const mapped = data
            .filter(r => r.url)             // url is the dedupe key
            .map(r => mapRow(portal, r));

        const { error: upErr } = await supabase
            .from('properties')
            .upsert(mapped, { onConflict: 'url' });

        if (upErr) {
            console.warn(`[Sync] ${table}: upsert error: ${upErr.message}`);
        } else {
            total += mapped.length;
        }

        from += PAGE_SIZE;
        if (data.length < PAGE_SIZE) break;
    }

    console.log(`[Sync] ${table}: consolidated ${total} rows into properties.`);
    return total;
}

async function syncAll() {
    console.log('=== SYNC landing tables -> properties ===');
    let grand = 0;
    for (const portal of PORTALS) {
        try {
            grand += await syncPortal(portal);
        } catch (e) {
            console.error(`[Sync] ${portal}: ${e.message}`);
        }
    }
    console.log(`=== DONE. ${grand} rows upserted into properties. ===`);
    return grand;
}

if (require.main === module) {
    syncAll().catch(console.error);
}

module.exports = { syncAll, syncPortal, mapRow, extractDistrict };
