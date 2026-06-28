const axios = require('axios');
require('dotenv').config();

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

async function sendToWebhook(data) {
    if (!WEBHOOK_URL) {
        console.warn('[Webhook] No URL configured, skipping send.');
        return;
    }
    console.log(`[Webhook] Using URL: ${WEBHOOK_URL.substring(0, 20)}...`);

    try {
        console.log(`[Webhook] Sending data for: ${data.title || data.external_id}`);
        const response = await axios.post(WEBHOOK_URL, data, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        
        if (response.status >= 200 && response.status < 300) {
            console.log('[Webhook] Successfully sent.');
        } else {
            console.warn(`[Webhook] Unexpected status: ${response.status}`);
        }
    } catch (error) {
        console.error(`[Webhook] Error sending data: ${error.message}`);
    }
}

module.exports = { sendToWebhook };
