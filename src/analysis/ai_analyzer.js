const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * Analyzes a Prague real estate listing using GPT-4o-mini to calculate
 * a precise gem score, distress factor, estimated market value, and Czech summary notes.
 * 
 * @param {Object} listing - The listing object containing title, description, price, area_m2, location, etc.
 * @returns {Promise<Object>} - Object containing gem_score, gem_notes, distress_factor, estimated_market_value
 */
async function analyzeListingWithAI(listing) {
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[AI Analyzer] Missing OpenAI API Key. Skipping AI evaluation.');
        return {
            gem_score: 50,
            gem_notes: 'Chybí OpenAI API klíč pro podrobnou analýzu.',
            distress_factor: 'Unknown',
            estimated_market_value: 0
        };
    }

    const priceFormatted = listing.price ? `${Number(listing.price).toLocaleString()} Kč` : 'dohodou';
    const areaFormatted = listing.area_m2 ? `${listing.area_m2} m²` : 'neuvedena';
    const pricePerM2 = (listing.price && listing.area_m2) ? Math.round(listing.price / listing.area_m2) : 0;

    // Check if listing has price drop details in metadata
    const prevPrice = listing.previous_price || listing.metadata?.previous_price || null;
    const dropAmt = listing.price_drop_amount || listing.metadata?.price_drop_amount || 0;
    const dropPct = listing.price_drop_percent || listing.metadata?.price_drop_percent || 0;
    const priceDropDetails = prevPrice ? `Předchozí cena: ${prevPrice.toLocaleString()} Kč, Snížení o: ${dropAmt.toLocaleString()} Kč (-${dropPct}%)` : 'Žádné snížení ceny nedetekováno';

    // Check if vision analysis was performed
    const visionScore = listing.metadata?.vision_score || 0;
    const visionNotes = listing.metadata?.vision_notes || 'Nebylo provedeno';

    const userPrompt = `
Udělej podrobnou analýzu této nemovitosti v Praze nebo jejím blízkém okolí:
- Název: ${listing.title}
- Popis: ${listing.description}
- Lokalita: ${listing.location} (Zip: ${listing.location_zip || 'neuveden'})
- Cena: ${priceFormatted} (${pricePerM2 > 0 ? `${pricePerM2.toLocaleString()} Kč/m²` : 'nelze spočítat'})
- Vývoj ceny (Sleva): ${priceDropDetails}
- Plocha: ${areaFormatted}
- Podlaží: ${listing.floor || 'neuvedeno'}
- Vlastnictví: ${listing.ownership || 'neuvedeno'}
- Dispozice: ${listing.disposition || 'neuvedena'}
- Hodnocení kvality fotek (Vision): ${visionScore > 0 ? `${visionScore}/30 (Poznámka: ${visionNotes})` : 'Nebylo provedeno'}

Úkoly pro AI:
1. Odhadni férovou průměrnou tržní hodnotu nemovitosti (v Kč) pro tuto konkrétní pražskou lokalitu a dispozici/velikost.
2. Vypočítej "Gem Score" (0 až 100), kde:
   - 90-100: Mimořádně výhodná nabídka, obrovská sleva nebo urgentní prodej (exekuce, dědictví, spěchá).
   - 70-89: Výrazně pod tržní cenou, solidní investiční příležitost.
   - 50-69: Běžná tržní cena, lehce podprůměrná cena.
   - Pod 50: Předražená nebo neatraktivní nabídka.
   * Zohledni také hodnocení kvality fotografií. Pokud mají fotografie vysoké hodnocení (např. 15-30/30), znamená to špatnou prezentaci inzerátu (hidden gem), což výrazně zvyšuje Negotiation Potential a mělo by zvýšit výsledné Gem Score!
   * Zohledni také vývoj ceny (slevu). Pokud majitel zlevnil, je to skvělá příležitost pro vyjednávání a mělo by to zvýšit výsledné Gem Score!
3. Detekuj faktor finanční tísně nebo spěchu majitele (Dědictví, Exekuce/Dluhy, Urgentní prodej, Žádný).
4. Napiš 1 až 2 stručné a výstižné věty v češtině jako shrnutí (gem_notes), proč je/není tato nabídka výhodná. Pokud došlo ke slevě, explicitně to uveď v poznámce a popiš výhodu pro vyjednávání.
`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Jsi špičkový expert na český realitní trh a investice do nemovitostí v Praze. Tvým úkolem je analyzovat inzeráty přímých majitelů a odhalit skryté investiční příležitosti (hidden gems).
Vždy odpovídej výhradně ve formátu JSON s následující strukturou:
{
  "gem_score": number, (0-100)
  "gem_notes": string, (1-2 české věty shrnutí)
  "distress_factor": string, ("Dědictví" | "Exekuce" | "Urgentní prodej" | "Žádný")
  "estimated_market_value": number (celé číslo v Kč)
}`
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            response_format: { type: 'json_object' }
        });

        const resultText = response.choices[0].message.content;
        const resultJson = JSON.parse(resultText);

        return {
            gem_score: Number(resultJson.gem_score) || 50,
            gem_notes: resultJson.gem_notes || 'Analýza dokončena.',
            distress_factor: resultJson.distress_factor || 'Žádný',
            estimated_market_value: Number(resultJson.estimated_market_value) || 0
        };
    } catch (error) {
        console.error('[AI Analyzer] Error evaluating listing with OpenAI:', error.message);
        return {
            gem_score: 50,
            gem_notes: `Chyba při hodnocení: ${error.message}`,
            distress_factor: 'Unknown',
            estimated_market_value: 0
        };
    }
}

module.exports = {
    analyzeListingWithAI
};
