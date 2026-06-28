const geolib = require('geolib');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const PRAGUE_CENTER = { latitude: 50.0755, longitude: 14.4378 };
const MAX_DISTANCE_KM = 35;

/**
 * Checks if a given Czech location/ZIP is within 35 km of Prague center.
 * Uses a heuristic check on ZIP code prefixes first, then OpenAI geocoding + geolib distance calculation.
 * 
 * @param {string} location - Name of the city/town/district.
 * @param {string} zip - Optional ZIP code.
 * @returns {Promise<Object>} - { isWithinRange: boolean, distanceKm: number }
 */
async function checkDistance(location, zip) {
    // 1. Initial heuristic check by ZIP code prefix
    if (zip) {
        const cleanZip = zip.replace(/\s/g, '');
        if (cleanZip.length >= 3) {
            const firstChar = cleanZip.charAt(0);
            // ZIP codes starting with 1 are Prague, 2 are Central Bohemia.
            // All other prefixes (3, 4, 5, 6, 7) are absolutely > 35 km away from Prague.
            if (firstChar !== '1' && firstChar !== '2') {
                console.log(`[Distance] Location automatically rejected by ZIP prefix: ${zip} (starts with ${firstChar})`);
                return { isWithinRange: false, distanceKm: null };
            }
        }
    }

    // Heuristic: If location mentions obvious distant cities, auto-reject
    const distantCities = ['most', 'nový bor', 'plzeň', 'brno', 'ostrava', 'liberec', 'ústí nad labem', 'hradec králové', 'pardubice', 'olomouc', 'české budějovice'];
    const lowerLocation = location.toLowerCase();
    for (const city of distantCities) {
        if (lowerLocation.includes(city)) {
            console.log(`[Distance] Location automatically rejected by name heuristic: ${location}`);
            return { isWithinRange: false, distanceKm: null };
        }
    }

    const query = `${location} ${zip || ''}`.trim();
    console.log(`[Distance] Querying coordinates for "${query}"...`);
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a geocoding system. Given a Czech location name and optional ZIP code, return its GPS coordinates. Respond ONLY with a JSON object like {"latitude": 50.123, "longitude": 14.456}. Do not include any markdown or other text.'
                },
                {
                    role: 'user',
                    content: `Location: ${query}, Czech Republic`
                }
            ],
            response_format: { type: "json_object" }
        });
        
        const coords = JSON.parse(response.choices[0].message.content);
        if (coords.latitude && coords.longitude) {
            const distance = geolib.getDistance(PRAGUE_CENTER, {
                latitude: coords.latitude,
                longitude: coords.longitude
            });
            const distanceKm = distance / 1000;
            const isWithinRange = distanceKm <= MAX_DISTANCE_KM;
            console.log(`[Distance] GPS Coords for "${query}": (${coords.latitude}, ${coords.longitude}). Distance to Prague: ${distanceKm.toFixed(1)} km. Within 35km range: ${isWithinRange}`);
            return { isWithinRange, distanceKm, latitude: coords.latitude, longitude: coords.longitude };
        }
    } catch (err) {
        console.error('[Distance] Geocoding API failed, falling back:', err.message);
    }
    
    // Fallback if geocoding fails, assume true to not skip valid candidates
    return { isWithinRange: true, distanceKm: 0 };
}

module.exports = { checkDistance };
