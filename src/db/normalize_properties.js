// ============================================================================
// NORMALIZE properties: backfill disposition, property_type and district by
// parsing title + description. Bazoš (the bulk of our data) keeps these in free
// text, not structured fields — recovering them roughly doubles the rows usable
// for AVM cohorts. Deterministic, cheap, idempotent.
//
// Run:  node src/db/normalize_properties.js
// ============================================================================

const supabase = require('./client');

const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;

function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// --- AREA: decimal-aware, fixes the "28,83 m²" -> 83 source-parsing bug -------
function parseAreaFromTitle(title) {
    const m = (title || '').match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*(?:2|²)/i);
    if (!m) return null;
    const val = parseFloat(m[1].replace(',', '.'));
    if (!(val > 5 && val < 10000)) return null;
    return { value: Math.round(val), hadDecimal: /[.,]/.test(m[1]) };
}

// --- OWNERSHIP: družstevní (cheaper) vs osobní -------------------------------
function parseOwnership(text, current) {
    if (current) return current;
    const t = stripDiacritics((text || '').toLowerCase());
    if (/druzstevn|druzstvo/.test(t)) return 'družstevní';
    if (/osobni vlastnictv|v osobnim vlastnictv/.test(t)) return 'osobní';
    return null;
}

// --- DISPOSITION: "3+kk", "2+1", garsonka -> "1+kk" ---------------------------
function parseDisposition(text) {
    const t = (text || '').toLowerCase();
    const m = t.match(/\b([1-7])\s*\+\s*(kk|1)\b/);
    if (m) return `${m[1]}+${m[2]}`;
    if (/garson|garsoni[eé]r|gars\b/.test(t)) return '1+kk';
    if (/ateli[eé]r/.test(t)) return 'atelier';
    return null;
}

// --- PROPERTY TYPE classification --------------------------------------------
// TITLE-driven with hard exclusions. The title is the authoritative listing type;
// the description is only a tie-breaker for ambiguous titles. This prevents a
// chata/pozemek/garáž that merely mentions "3+kk" or "byt" from being mislabeled
// as a flat (which produced fake huge discounts vs the apartment benchmark).
function classifyType(title, description) {
    const tt = stripDiacritics((title || '').toLowerCase());          // authoritative
    const td = stripDiacritics(`${title || ''} ${description || ''}`.toLowerCase());

    // 0) Rentals are not for us (we buy to flip) — exclude by TITLE.
    if (/pronajem|pronajmu|k pronajmu|do najmu|\bnajem bytu/.test(tt)) return 'pronajem';

    // 1) Hard non-flat categories by TITLE (checked first)
    if (/\bchat[aky]|\bsrub|chalup|rekreacni objekt|rekreacni chat/.test(tt)) return 'chata';
    if (/pozemek|parcel|\bpole\b|\blouk|\bles\b|orna puda|zahrad(?!ni )/.test(tt)) return 'pozemek';
    if (/garaz|garazov[ae] stani|parkovaci stani|\bstani\b/.test(tt)) return 'garaz';
    if (/modulov|mobilheim|mobilni dum|unimobun|maringotk|buňk|bunk/.test(tt)) return 'other';

    // 2) Multi-unit residential building (scope target #2) — before generic "objekt"
    if (/cinzovni dum|cinzak|bytovy dum|bytove domy|bytovy objekt|najemni dum|penzion\b|cinzovniho domu|bytoveho domu/.test(tt)) {
        return 'bytovy_dum';
    }

    // 3) Commercial / non-residential by TITLE
    if (/kancelar|obchodni|komercni|\bsklad|vyrobni|nebytov|restaurac|provozovn|hotel\b|\bobjekt\b/.test(tt)) return 'komercni';

    // 4) Family house by TITLE
    if (/rodinny dum|\brd\b|\bvila\b|\bvily\b|usedlost|dvojdom|radovy dum|\bdomek\b|prodej domu|prodej.*\bdomu\b/.test(tt)) return 'dum';

    // 5) Flat — needs a flat signal in the TITLE and no house/land signal there
    if (/\bbyt[uy]?\b|\d\s*\+\s*(kk|1)\b|garson|mezonet|atelier|podkrovni byt|loft\b/.test(tt)) return 'byt';

    // 6) Ambiguous title -> allow description, but only if it has no disqualifier
    if (/\bbyt[uy]?\b|\d\s*\+\s*(kk|1)\b|garson/.test(td) &&
        !/rodinny dum|\bchata|\bsrub|pozemek|garaz|chalup|komercni|kancelar/.test(td)) {
        return 'byt';
    }

    return 'other';
}

// --- DISTRICT: obec -> okres for the most common Středočeský towns -----------
// Partial but population-weighted: covers the majority of real listings.
const OBEC_TO_OKRES = {
    'kladno': 'Kladno', 'kročehlavy': 'Kladno', 'slany': 'Kladno', 'stochov': 'Kladno', 'unhost': 'Kladno', 'buštěhrad': 'Kladno', 'velvary': 'Kladno',
    'mlada boleslav': 'Mladá Boleslav', 'benatky nad jizerou': 'Mladá Boleslav', 'bakov nad jizerou': 'Mladá Boleslav',
    'pribram': 'Příbram', 'dobris': 'Příbram', 'sedlcany': 'Příbram', 'rozmital': 'Příbram',
    'kolin': 'Kolín', 'cesky brod': 'Kolín', 'kourim': 'Kolín', 'pecky': 'Kolín', 'zasmuky': 'Kolín',
    'kutna hora': 'Kutná Hora', 'caslav': 'Kutná Hora', 'uhlirske janovice': 'Kutná Hora',
    'nymburk': 'Nymburk', 'podebrady': 'Nymburk', 'lysa nad labem': 'Nymburk', 'milovice': 'Nymburk', 'sadska': 'Nymburk',
    'melnik': 'Mělník', 'kralupy nad vltavou': 'Mělník', 'neratovice': 'Mělník', 'mseno': 'Mělník',
    'beroun': 'Beroun', 'kraluv dvur': 'Beroun', 'horovice': 'Beroun', 'zdice': 'Beroun',
    'rakovnik': 'Rakovník', 'nove straseci': 'Rakovník',
    'benesov': 'Benešov', 'vlasim': 'Benešov', 'votice': 'Benešov', 'tynec nad sazavou': 'Benešov', 'bystrice': 'Benešov',
    // Praha-východ
    'brandys nad labem': 'Praha-východ', 'stara boleslav': 'Praha-východ', 'celakovice': 'Praha-východ', 'ricany': 'Praha-východ', 'odolena voda': 'Praha-východ', 'klecany': 'Praha-východ', 'usti nad labem-?': 'Praha-východ', 'sestajovice': 'Praha-východ', 'cercany': 'Praha-východ', 'mnichovice': 'Praha-východ', 'kostelec nad cernymi lesy': 'Praha-východ',
    // Praha-západ
    'cernosice': 'Praha-západ', 'jilove u prahy': 'Praha-západ', 'roztoky': 'Praha-západ', 'dobrichovice': 'Praha-západ', 'rudna': 'Praha-západ', 'jesenice': 'Praha-západ', 'hostivice': 'Praha-západ', 'mnisek pod brdy': 'Praha-západ', 'libcice nad vltavou': 'Praha-západ', 'davle': 'Praha-západ'
};

function parseDistrict(location, currentDistrict) {
    if (currentDistrict) return currentDistrict;
    const loc = stripDiacritics(location || '').toLowerCase();
    if (!loc) return null;

    const praha = loc.match(/praha\s*-?\s*(\d{1,2})/);
    if (praha) return `Praha ${praha[1]}`;
    if (/\bpraha\b/.test(loc)) return 'Praha';

    for (const [obec, okres] of Object.entries(OBEC_TO_OKRES)) {
        if (loc.includes(obec)) return okres;
    }
    return null;
}

async function normalize() {
    console.log('=== NORMALIZE properties (disposition / type / district) ===');
    let from = 0;
    let scanned = 0;
    let updatedTotal = 0;

    for (;;) {
        const { data, error } = await supabase
            .from('properties')
            .select('id, portal, title, description, location_raw, disposition, property_type, district, area_m2, ownership')
            .order('id', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) { console.error('Read error:', error.message); break; }
        if (!data || data.length === 0) break;

        const updates = [];
        for (const r of data) {
            const text = `${r.title || ''} ${r.description || ''}`;

            // Always carry the same column set (existing value when unchanged) so
            // a heterogeneous batch can't NULL-out columns it doesn't mention.
            const disposition   = r.disposition   || parseDisposition(text)            || null;
            // property_type is ALWAYS recomputed (authoritative classifier), so a
            // previously mis-tagged row gets corrected on each run.
            const property_type = classifyType(r.title, r.description);
            // Bazoš location_raw is already the okres (the feed is nationwide), so
            // trust it directly; other portals get text/obec parsing.
            const district = r.district
                || (r.portal === 'bazos' && r.location_raw ? r.location_raw.trim() : null)
                || parseDistrict(r.location_raw)
                || null;

            const ownership = parseOwnership(text, r.ownership);

            // Fix area: re-parse from title; overwrite when stored is null or the
            // title carries a decimal area (the buggy inflated case).
            let area_m2 = r.area_m2;
            const pa = parseAreaFromTitle(r.title);
            if (pa && (r.area_m2 == null || pa.hadDecimal)) area_m2 = pa.value;

            if (disposition !== r.disposition ||
                property_type !== r.property_type ||
                district !== r.district ||
                ownership !== r.ownership ||
                area_m2 !== r.area_m2) {
                // portal included so the upsert's underlying INSERT satisfies NOT NULL.
                updates.push({ id: r.id, portal: r.portal, disposition, property_type, district, ownership, area_m2 });
            }
        }

        // write in chunks (dedupe by id so a batch never hits a row twice)
        const uniq = [...new Map(updates.map(u => [u.id, u])).values()];
        for (let i = 0; i < uniq.length; i += WRITE_CHUNK) {
            const chunk = uniq.slice(i, i + WRITE_CHUNK);
            const { error: upErr } = await supabase
                .from('properties')
                .upsert(chunk, { onConflict: 'id' });
            if (upErr) console.warn('Upsert error:', upErr.message);
            else updatedTotal += chunk.length;
        }

        scanned += data.length;
        from += PAGE_SIZE;
        if (data.length < PAGE_SIZE) break;
    }

    console.log(`Scanned ${scanned} rows, updated ${updatedTotal}.`);
}

if (require.main === module) {
    normalize().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { parseDisposition, classifyType, parseDistrict, normalize };
