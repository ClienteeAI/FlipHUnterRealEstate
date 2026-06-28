const { chromium } = require('playwright');

async function test() {
    const b = await chromium.launch({ headless: true });
    const p = await b.newPage();
    await p.goto('https://www.annonce.cz/inzerat/ujezd-u-brna-ov-2-1-86189983-ws2shq.html');
    
    const data = await p.evaluate(() => {
        const result = {};
        
        // Table rows with th/td
        const rows = Array.from(document.querySelectorAll('table.attrs tr'));
        rows.forEach(r => {
            const th = r.querySelector('th');
            const td = r.querySelector('td');
            if (th && td) result[th.innerText.trim()] = td.innerText.trim();
        });
        
        // Price - first line of the .r div
        const priceEl = document.querySelector('.inzeratdetailad .r');
        result.price_raw = priceEl ? priceEl.innerText.trim().split('\n')[0] : '';
        
        // Phone - tel: link
        const telEl = document.querySelector('a[href^="tel:"]');
        result.phone = telEl ? telEl.getAttribute('href') : '';
        
        // Description
        const desc = document.querySelector('#popis');
        result.desc_preview = desc ? desc.innerText.trim().slice(0, 200) : '';
        
        // All links to see phone/email patterns
        const allLinks = Array.from(document.querySelectorAll('a')).filter(a => a.href.startsWith('tel:') || a.href.startsWith('mailto:')).map(a => a.href);
        result.contact_links = allLinks;
        
        return result;
    });
    
    console.log(JSON.stringify(data, null, 2));
    await b.close();
}

test().catch(e => console.error(e.message));
