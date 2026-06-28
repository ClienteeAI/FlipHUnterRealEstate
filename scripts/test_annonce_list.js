const { chromium } = require('playwright');

async function test() {
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    
    const url = 'https://www.annonce.cz/byty-na-prodej.html?location=Praha';
    console.log('Testing:', url);
    await p.goto(url);
    await p.waitForTimeout(5000); // Wait for JS to load
    
    // Try to wait for listings
    await p.waitForSelector('a[href*="/inzerat/"]', { timeout: 10000 }).catch(() => console.log('Timeout waiting for listings'));
    
    const links = await p.evaluate(() => Array.from(document.querySelectorAll('a[href*="/inzerat/"]')).map(a => a.href));
    console.log(`Found ${links.length} links`);
    console.log('First 5:', links.slice(0, 5));
    
    // Count all unique links
    const uniqueLinks = [...new Set(links)];
    console.log(`Unique: ${uniqueLinks.length}`);
    
    // Check pagination
    const pager = await p.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a')).filter(a => a.innerText.includes('Další') || a.innerText.includes('dalsi') || a.rel === 'next');
        return els.map(e => ({ text: e.innerText, href: e.href }));
    });
    console.log('Pagination:', pager);
    
    // Check nearby areas - Středočeský kraj?
    console.log('\n--- Testing Středočeský kraj ---');
    await p.goto('https://www.annonce.cz/byty-na-prodej.html?location=Stredocesky');
    await p.waitForTimeout(3000);
    const links2 = await p.evaluate(() => Array.from(document.querySelectorAll('a[href*="/inzerat/"]')).map(a => a.href));
    console.log(`Středočeský links: ${links2.length}`);
    
    await b.close();
}

test().catch(e => console.error(e.message));
