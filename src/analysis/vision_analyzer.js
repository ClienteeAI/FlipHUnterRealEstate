const fs = require('fs');
const path = require('path');
const supabase = require('../db/client');
require('dotenv').config();

const API_KEY = process.env.OPENAI_API_KEY;

async function runVisionAnalysis() {
    if (!API_KEY) {
        console.error('ERROR: OPENAI_API_KEY not found in .env');
        console.log('Please add your OpenAI API key to continue.');
        return;
    }

    console.log('=== STARTING AI VISION ANALYSIS ===');
    const portals = ['bazos', 'annonce', 'avizo', 'hyperinzerce'];

    for (const portal of portals) {
        const tableName = `listings_${portal}`;
        console.log(`[Vision] Checking ${tableName} for new image candidates...`);

        // Fetch active listings
        const { data: candidates, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('is_active', true);

        if (error) {
            console.error(`[Vision] Error fetching from ${tableName}:`, error.message);
            continue;
        }

        // Filter: has images, and not vision analyzed yet
        const unanalyzed = candidates.filter(l => {
            const hasImages = Array.isArray(l.images) && l.images.length > 0;
            const alreadyAnalyzed = l.metadata?.vision_analyzed === true;
            return hasImages && !alreadyAnalyzed;
        }).slice(0, 10); // Analyze up to 10 per cycle per portal

        if (unanalyzed.length === 0) {
            console.log(`[Vision] No new candidates in ${tableName}.`);
            continue;
        }

        console.log(`[Vision] Found ${unanalyzed.length} candidates in ${tableName}.`);

        for (const listing of unanalyzed) {
            try {
                console.log(`[Vision] Analyzing listing: "${listing.title}" | URL: ${listing.url}`);
                const imageUrls = listing.images;
                
                // Select up to 2 images to process
                const imagesToProcess = imageUrls.slice(0, 2);
                const result = await analyzeImagesWithAI(imagesToProcess);

                if (result) {
                    const updatedMetadata = {
                        ...(listing.metadata || {}),
                        vision_score: result.vision_score,
                        vision_notes: result.reasoning,
                        vision_analyzed: true,
                        vision_analyzed_at: new Date().toISOString()
                    };

                    const { error: updateErr } = await supabase
                        .from(tableName)
                        .update({
                            metadata: updatedMetadata
                        })
                        .eq('id', listing.id);

                    if (updateErr) {
                        console.error(`[Vision] Error updating DB for ${listing.id}:`, updateErr.message);
                    } else {
                        console.log(`[Vision] [OK] "${listing.title}" | Score: ${result.vision_score}/30 | Reason: ${result.reasoning}`);
                    }
                } else {
                    console.log(`[Vision] [Fail] Could not analyze images for ${listing.title}`);
                }
            } catch (e) {
                console.error(`[Vision] Error analyzing listing ${listing.id}:`, e.message);
            }
        }
    }
    console.log('=== AI VISION ANALYSIS COMPLETED ===');
}

const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function analyzeImagesWithAI(imageUrls) {
    try {
        console.log(`[AI] Analyzing ${imageUrls.length} images with GPT-4o-mini...`);
        
        const content = [
            {
                type: "text",
                text: "Analyze these real estate photos for 'Negotiation Potential'. Rate the photo quality on a scale of 0-30 where 30 means the photos are terrible (messy, dark, blurry, unprofessional) and 0 means they are professional and perfect. We want to find 'Hidden Gems' that look bad online but are actually good flats. Return ONLY a JSON object: { \"vision_score\": number, \"reasoning\": \"short explanation\" }"
            }
        ];

        for (const url of imageUrls) {
            content.push({
                type: "image_url",
                image_url: { url: url }
            });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content }],
            max_tokens: 150,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content);
        console.log(`[AI] Result: Score ${result.vision_score}/30 - ${result.reasoning}`);
        return result;

    } catch (e) {
        console.error(`[AI Error] ${e.message}`);
        return null;
    }
}

if (require.main === module) {
    runVisionAnalysis();
}

module.exports = runVisionAnalysis;
