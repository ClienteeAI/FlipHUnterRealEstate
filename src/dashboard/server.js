// ============================================================================
// LOCAL DASHBOARD — Sreality-style card grid over `properties`.
// ----------------------------------------------------------------------------
// Pure Node http (no deps). Photo gallery per card (scroll photos without
// opening the listing). "Schválit → CRM" = positive learning signal (approved),
// "Skrýt" = negative signal (eval_status='dismissed'). Every shown row is
// liveness-verified at request time so a dead listing can never appear.
//
// Run:  node src/dashboard/server.js   then open http://localhost:3000
// ============================================================================

const http = require('http');
const crypto = require('crypto');
const supabase = require('../db/client');
const { checkOne } = require('../db/check_liveness');
const { buildPayload } = require('../engine/crm_push');
const { sendToWebhook } = require('../utils/webhook');

const PORT = process.env.DASHBOARD_PORT || 3000;
const FRESH_MS = 10 * 60 * 1000;
const DISPLAY_LIMIT = 60;
const VERIFY_CAP = 80;

// Stay alive through transient errors (e.g. a flaky Supabase/HTTP call) — never
// let one bad request kill the dashboard.
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e && e.message || e));
process.on('uncaughtException', e => console.error('[uncaughtException]', e && e.message || e));

// --- AUTH (Supabase Auth, backend-mediated) ---------------------------------
// Enabled when AUTH_ENABLED=1 (set it in production). Off by default so local
// dev stays open. Credentials are verified server-side via Supabase Auth; the
// browser only ever gets a signed httpOnly session cookie — never the DB key.
const AUTH_ENABLED = process.env.AUTH_ENABLED === '1';
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SUPABASE_KEY || 'dev-secret';
const SESSION_TTL = 12 * 3600 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const INVITE_CODE = process.env.INVITE_CODE || '';   // clients self-register with this code

function sessionCookie(user) {
    return `sess=${signSession({ sub: user.id, email: user.email, exp: Date.now() + SESSION_TTL })}` +
        `; HttpOnly; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Lax` + (COOKIE_SECURE ? '; Secure' : '');
}

function signSession(obj) {
    const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
    const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${mac}`;
}
function verifySession(token) {
    if (!token || !token.includes('.')) return null;
    const [body, mac] = token.split('.');
    const exp = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (mac.length !== exp.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
    try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString());
        return p.exp > Date.now() ? p : null;
    } catch { return null; }
}
function parseCookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';')
        .map(c => { const i = c.indexOf('='); return i < 0 ? null : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))]; })
        .filter(Boolean));
}
function isAuthed(req) {
    if (!AUTH_ENABLED) return true;
    return !!verifySession(parseCookies(req).sess);
}
function currentUser(req) {
    if (!AUTH_ENABLED) return { sub: 'local', email: 'local' };
    return verifySession(parseCookies(req).sess) || {};
}

const DEAL_FIELDS = 'id, lead_tier, lead_score, is_agent, approved, sent_to_crm, ' +
    'title, url, portal, district, disposition, property_type, ownership, area_m2, ' +
    'price_numeric, price_per_m2, estimated_value_per_m2, discount_vs_estimate_pct, ' +
    'arv_estimate, renovation_estimate, expected_margin_pct, valuation_confidence, ' +
    'distress_factors, notes, last_seen_at, images';

function json(res, code, data) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

async function verifyLiveness(rows) {
    const now = Date.now();
    const stale = rows.filter(r => !r.last_seen_at || (now - new Date(r.last_seen_at).getTime()) > FRESH_MS)
        .slice(0, VERIFY_CAP);
    const dead = new Set();
    let i = 0;
    const workers = Array.from({ length: 6 }, async () => {
        while (i < stale.length) {
            const r = stale[i++];
            const v = await checkOne(r);
            if (v.dead) {
                dead.add(r.id);
                await supabase.from('properties').update({ is_active: false, delisted_at: new Date().toISOString() }).eq('id', r.id);
            } else {
                await supabase.from('properties').update({ last_seen_at: new Date().toISOString() }).eq('id', r.id);
            }
        }
    });
    await Promise.all(workers);
    return dead;
}

async function getSummary() {
    const grid = {};
    for (const t of ['A', 'B', 'C']) {
        for (const agent of [false, true]) {
            const { count } = await supabase.from('properties')
                .select('*', { count: 'exact', head: true })
                .eq('lead_tier', t).eq('is_agent', agent).eq('is_active', true)
                .neq('eval_status', 'dismissed');
            grid[`${t}_${agent ? 'broker' : 'owner'}`] = count || 0;
        }
    }
    return grid;
}

async function getDeals(q) {
    let query = supabase.from('properties').select(DEAL_FIELDS)
        .not('lead_tier', 'is', null)
        .eq('is_active', true)
        .neq('eval_status', 'dismissed')
        .order('lead_score', { ascending: false })
        .limit(120);

    if (q.tier && ['A', 'B', 'C'].includes(q.tier)) query = query.eq('lead_tier', q.tier);
    if (q.seller === 'owner') query = query.eq('is_agent', false);
    if (q.seller === 'broker') query = query.eq('is_agent', true);
    if (q.district) query = query.ilike('district', `%${q.district}%`);
    if (q.minMargin) query = query.gte('expected_margin_pct', Number(q.minMargin));
    if (q.approved === 'yes') query = query.eq('approved', true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const dead = await verifyLiveness(data || []);
    return (data || []).filter(r => !dead.has(r.id)).slice(0, DISPLAY_LIMIT);
}

function readBody(req) {
    return new Promise(resolve => {
        let b = '';
        req.on('data', c => b += c);
        req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    });
}

const server = http.createServer(async (req, res) => {
    try {
        const u = new URL(req.url, `http://localhost:${PORT}`);

        // --- login routes (always public) ---
        if (req.method === 'GET' && u.pathname === '/login') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(LOGIN_HTML);
        }
        if (req.method === 'POST' && u.pathname === '/api/login') {
            const { email, password } = await readBody(req);
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error || !data?.user) return json(res, 401, { error: 'Neplatné přihlášení.' });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(data.user) });
            return res.end(JSON.stringify({ ok: true }));
        }
        if (req.method === 'GET' && u.pathname === '/register') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(REGISTER_HTML);
        }
        if (req.method === 'POST' && u.pathname === '/api/register') {
            const { email, password, code } = await readBody(req);
            if (!INVITE_CODE || code !== INVITE_CODE) return json(res, 403, { error: 'Neplatný zvací kód.' });
            if (!email || !password || password.length < 6) return json(res, 400, { error: 'Zadej e-mail a heslo (min. 6 znaků).' });
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) return json(res, 400, { error: error.message });
            if (data.session) {   // no email confirmation required → log in immediately
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': sessionCookie(data.user) });
                return res.end(JSON.stringify({ ok: true, loggedIn: true }));
            }
            return json(res, 200, { ok: true, loggedIn: false });  // must confirm via e-mail first
        }
        if (req.method === 'POST' && u.pathname === '/api/logout') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'sess=; HttpOnly; Path=/; Max-Age=0' });
            return res.end(JSON.stringify({ ok: true }));
        }

        // --- auth gate for everything else ---
        if (!isAuthed(req)) {
            if (u.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorized' });
            res.writeHead(302, { Location: '/login' });
            return res.end();
        }

        if (req.method === 'GET' && u.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(HTML);
        }
        if (req.method === 'GET' && u.pathname === '/api/summary') {
            return json(res, 200, await getSummary());
        }
        if (req.method === 'GET' && u.pathname === '/api/deals') {
            return json(res, 200, await getDeals(Object.fromEntries(u.searchParams)));
        }
        if (req.method === 'POST' && u.pathname === '/api/approve') {
            const { id, approved } = await readBody(req);
            const who = currentUser(req).email || null;

            if (approved === false) {   // un-approve (cannot un-send CRM)
                const { error } = await supabase.from('properties')
                    .update({ approved: false, approved_by: null }).eq('id', id);
                return error ? json(res, 500, { error: error.message }) : json(res, 200, { ok: true });
            }

            // approve → send the lead to the CRM webhook (once), then mark sent
            const { data: row, error: e1 } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
            if (e1 || !row) return json(res, 500, { error: e1?.message || 'lead nenalezen' });

            await supabase.from('properties').update({ approved: true, approved_by: who }).eq('id', id);

            if (row.sent_to_crm) return json(res, 200, { ok: true, crm: 'already_sent' });
            try {
                await sendToWebhook(buildPayload(row));
                await supabase.from('properties')
                    .update({ sent_to_crm: true, sent_to_crm_at: new Date().toISOString() }).eq('id', id);
                return json(res, 200, { ok: true, crm: 'sent' });
            } catch (e) {
                return json(res, 200, { ok: true, crm: 'failed', error: e.message });
            }
        }
        if (req.method === 'POST' && u.pathname === '/api/dismiss') {
            const { id } = await readBody(req);
            const { error } = await supabase.from('properties')
                .update({ eval_status: 'dismissed', dismissed_by: currentUser(req).email || null }).eq('id', id);
            return error ? json(res, 500, { error: error.message }) : json(res, 200, { ok: true });
        }
        json(res, 404, { error: 'not found' });
    } catch (e) {
        json(res, 500, { error: e.message });
    }
});

server.listen(PORT, () => console.log(`\n  Dashboard běží na  http://localhost:${PORT}\n`));

// ----------------------------------------------------------------------------
const HTML = `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Real Estate — Deal Dashboard</title>
<style>
  :root{--bg:#f4f5f7;--card:#fff;--mut:#6b7280;--line:#e5e7eb;--txt:#1f2430;--a:#e8413a;--b:#f59e0b;--c:#10b981;--blue:#c8102e}
  *{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt)}
  header{padding:14px 20px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
  h1{margin:0;font-size:17px}.sub{color:var(--mut);font-size:12px;margin-top:2px}
  .wrap{padding:16px 20px;max-width:1500px;margin:0 auto}
  .grid{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .cell{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 13px;cursor:pointer;min-width:108px}
  .cell:hover{border-color:#aab}.cell.act{outline:2px solid var(--blue)}
  .cell .lbl{color:var(--mut);font-size:11px}.cell .n{font-size:20px;font-weight:700}
  .filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
  select,input,button{background:#fff;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px}
  button{cursor:pointer}button:hover{border-color:#aab}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .gal{position:relative;aspect-ratio:4/3;background:#e9ebef;overflow:hidden}
  .gal img{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer}
  .gal .nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.45);color:#fff;border:none;width:30px;height:38px;font-size:18px;cursor:pointer;opacity:0;transition:.15s}
  .gal:hover .nav{opacity:1}.gal .prev{left:0;border-radius:0 6px 6px 0}.gal .next{right:0;border-radius:6px 0 0 6px}
  .gal .cnt{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 7px;border-radius:10px}
  .gal .noimg{display:flex;align-items:center;justify-content:center;height:100%;color:#9aa;font-size:13px}
  .badges{position:absolute;top:8px;left:8px;display:flex;gap:5px}
  .tier{font-weight:800;padding:2px 9px;border-radius:6px;color:#fff;font-size:12px}
  .tA{background:var(--a)}.tB{background:var(--b)}.tC{background:var(--c)}
  .seller{position:absolute;top:8px;right:8px;font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.92);font-weight:600}
  .owner{color:#0a8f5b}.broker{color:#6b7280}
  .body{padding:10px 12px;display:flex;flex-direction:column;gap:5px;flex:1}
  .price{font-size:18px;font-weight:800}
  .ttl{font-size:13px;color:#2b3550;text-decoration:none;line-height:1.3}.ttl:hover{text-decoration:underline}
  .loc{color:var(--mut);font-size:12px}
  .spec{font-size:12px;color:#444}
  .metrics{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-top:2px}
  .metrics b{font-size:13px}.pos{color:#0a8f5b}.neg{color:#c0392b}
  .tags{display:flex;gap:4px;flex-wrap:wrap}
  .tag{background:#fff3e0;color:#b26a00;border:1px solid #ffe0b2;font-size:11px;padding:1px 6px;border-radius:5px}
  .act-row{display:flex;gap:6px;margin-top:auto;padding-top:6px}
  .act-row button{flex:1;font-size:12px;padding:7px 6px}
  .appr{background:#e7f7ee;border-color:#a7e0c2;color:#0a8f5b;font-weight:700}
  .hide{color:#b00}
  .count{color:var(--mut);font-size:12px}
</style></head><body>
<header style="display:flex;align-items:center;justify-content:space-between;gap:12px">
  <div><h1>🏠 Real Estate — Deal Dashboard</h1><div class="sub">Flip příležitosti (Praha + Středočeský). Listuj fotky šipkami, otevři kliknutím. Schválené jdou do CRM a učí engine.</div></div>
  <button onclick="logout()" style="white-space:nowrap">Odhlásit</button>
</header>
<div class="wrap">
  <div class="grid" id="sumGrid"></div>
  <div class="filters">
    <select id="fTier"><option value="">Tier: vše</option><option>A</option><option>B</option><option>C</option></select>
    <select id="fSeller"><option value="">Prodejce: vše</option><option value="owner">Majitel</option><option value="broker">Makléř</option></select>
    <input id="fDistrict" placeholder="Okres…" size="11">
    <input id="fMargin" type="number" placeholder="Min. marže %" size="9">
    <label class="count"><input type="checkbox" id="fAppr"> jen schválené</label>
    <button onclick="load()">Filtrovat</button>
    <span class="count" id="count"></span>
  </div>
  <div class="cards" id="cards"></div>
</div>
<script>
const fmt=n=>n==null?'—':Number(n).toLocaleString('cs-CZ');
async function logout(){await fetch('/api/logout',{method:'POST'});location.href='/login';}
async function summary(){
  const g=await (await fetch('/api/summary')).json();
  const grid=document.getElementById('sumGrid');grid.innerHTML='';
  [['A','owner','A · Majitel'],['A','broker','A · Makléř'],['B','owner','B · Majitel'],['B','broker','B · Makléř'],['C','owner','C · Majitel'],['C','broker','C · Makléř']]
   .forEach(([t,s,lbl])=>{const d=document.createElement('div');d.className='cell';
    d.innerHTML='<div class="lbl">'+lbl+'</div><div class="n">'+(g[t+'_'+s]||0)+'</div>';
    d.onclick=()=>{fTier.value=t;fSeller.value=s;document.querySelectorAll('.cell').forEach(c=>c.classList.remove('act'));d.classList.add('act');load();};
    grid.appendChild(d);});
}
function gallery(imgs){
  const g=document.createElement('div');g.className='gal';
  if(!imgs||!imgs.length){g.innerHTML='<div class="noimg">bez fotek</div>';return g;}
  let i=0;
  const img=document.createElement('img');img.loading='lazy';img.src=imgs[0];
  const cnt=document.createElement('div');cnt.className='cnt';cnt.textContent='1/'+imgs.length;
  const show=()=>{img.src=imgs[i];cnt.textContent=(i+1)+'/'+imgs.length;};
  img.onerror=()=>{img.style.opacity=.3;};
  const prev=document.createElement('button');prev.className='nav prev';prev.textContent='‹';
  const next=document.createElement('button');next.className='nav next';next.textContent='›';
  prev.onclick=e=>{e.stopPropagation();i=(i-1+imgs.length)%imgs.length;show();};
  next.onclick=e=>{e.stopPropagation();i=(i+1)%imgs.length;show();};
  g.append(img,cnt);if(imgs.length>1)g.append(prev,next);
  return g;
}
async function load(){
  const p=new URLSearchParams();
  if(fTier.value)p.set('tier',fTier.value);if(fSeller.value)p.set('seller',fSeller.value);
  if(fDistrict.value)p.set('district',fDistrict.value);if(fMargin.value)p.set('minMargin',fMargin.value);
  if(fAppr.checked)p.set('approved','yes');
  const cards=document.getElementById('cards');cards.innerHTML='<div class="count">Načítám a ověřuji živost…</div>';
  const rows=await (await fetch('/api/deals?'+p)).json();
  document.getElementById('count').textContent=rows.length+' inzerátů';
  cards.innerHTML='';
  for(const r of rows){
    const c=document.createElement('div');c.className='card';
    const gal=gallery(r.images);
    const badges=document.createElement('div');badges.className='badges';
    badges.innerHTML='<span class="tier t'+r.lead_tier+'">'+r.lead_tier+'</span>';
    const sel=document.createElement('span');sel.className='seller '+(r.is_agent?'broker':'owner');sel.textContent=r.is_agent?'Makléř':'Majitel';
    gal.appendChild(badges);gal.appendChild(sel);
    gal.querySelector('img,.noimg').onclick=()=>window.open(r.url,'_blank');
    const disc=r.discount_vs_estimate_pct,marg=r.expected_margin_pct;
    const body=document.createElement('div');body.className='body';
    body.innerHTML=
      '<div class="price">'+fmt(r.price_numeric)+' Kč</div>'+
      '<a class="ttl" href="'+r.url+'" target="_blank">'+(r.title||'—')+'</a>'+
      '<div class="loc">'+(r.district||'')+'</div>'+
      '<div class="spec">'+(r.property_type||'')+' '+(r.disposition||'')+' · '+fmt(r.area_m2)+' m²'+(r.ownership?' · '+r.ownership:'')+' · '+fmt(r.price_per_m2)+' Kč/m²</div>'+
      '<div class="metrics">'+
        '<span>Sleva <b class="'+(disc>0?'pos':'neg')+'">'+(disc==null?'—':disc+' %')+'</b></span>'+
        '<span>Marže <b class="'+(marg>0?'pos':'neg')+'">'+(marg==null?'—':marg+' %')+'</b></span>'+
        '<span>Skóre <b>'+(r.lead_score==null?'—':r.lead_score)+'</b></span>'+
      '</div>'+
      '<div class="tags">'+(r.distress_factors||[]).map(x=>'<span class="tag">'+x+'</span>').join('')+'</div>';
    const acts=document.createElement('div');acts.className='act-row';
    const ap=document.createElement('button');
    const setAp=s=>{ if(s==='sent'){ap.className='appr';ap.textContent='✓ V CRM';ap.disabled=true;}
      else if(s==='approved'){ap.className='appr';ap.textContent='✓ Schváleno';ap.disabled=false;}
      else{ap.className='';ap.textContent='Schválit → CRM';ap.disabled=false;} };
    setAp(r.sent_to_crm?'sent':(r.approved?'approved':'none'));
    ap.onclick=async()=>{
      if(ap.classList.contains('appr')&&!ap.disabled){
        await fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,approved:false})});setAp('none');return;}
      ap.disabled=true;ap.textContent='Odesílám…';
      const resp=await fetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,approved:true})});
      const d=await resp.json().catch(()=>({}));
      if(d.crm==='sent'||d.crm==='already_sent')setAp('sent');
      else if(d.crm==='failed'){ap.className='';ap.disabled=false;ap.textContent='CRM chyba – znovu';}
      else setAp('approved');
    };
    const hd=document.createElement('button');hd.className='hide';hd.textContent='Skrýt';
    hd.onclick=async()=>{await fetch('/api/dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id})});c.remove();};
    acts.append(ap,hd);body.appendChild(acts);
    c.append(gal,body);cards.appendChild(c);
  }
}
summary();load();
</script></body></html>`;

// ----------------------------------------------------------------------------
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Přihlášení — Deal Dashboard</title>
<style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f5f7;font:14px system-ui,Segoe UI,Roboto,sans-serif;color:#1f2430}
  .box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;width:320px;box-shadow:0 4px 20px rgba(0,0,0,.06)}
  h1{font-size:18px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin-bottom:18px}
  label{display:block;font-size:12px;color:#6b7280;margin:10px 0 4px}
  input{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px}
  button{width:100%;margin-top:18px;padding:11px;background:#c8102e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
  .err{color:#c0392b;font-size:13px;margin-top:10px;min-height:18px}
</style></head><body>
<form class="box" onsubmit="return login(event)">
  <h1>🏠 Deal Dashboard</h1><div class="sub">Přihlaš se pro přístup k inzerátům.</div>
  <label>E-mail</label><input id="email" type="email" autocomplete="username" required>
  <label>Heslo</label><input id="password" type="password" autocomplete="current-password" required>
  <button type="submit">Přihlásit</button>
  <div class="err" id="err"></div>
  <div style="text-align:center;margin-top:14px;font-size:13px"><a href="/register">Nemáš účet? Zaregistruj se</a></div>
</form>
<script>
async function login(e){
  e.preventDefault();
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email.value,password:password.value})});
  if(r.ok){location.href='/';}else{document.getElementById('err').textContent='Neplatný e-mail nebo heslo.';}
  return false;
}
</script></body></html>`;

// ----------------------------------------------------------------------------
const REGISTER_HTML = `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Registrace — Deal Dashboard</title>
<style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f5f7;font:14px system-ui,Segoe UI,Roboto,sans-serif;color:#1f2430}
  .box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;width:330px;box-shadow:0 4px 20px rgba(0,0,0,.06)}
  h1{font-size:18px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin-bottom:18px}
  label{display:block;font-size:12px;color:#6b7280;margin:10px 0 4px}
  input{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px}
  button{width:100%;margin-top:18px;padding:11px;background:#c8102e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
  .msg{font-size:13px;margin-top:10px;min-height:18px}.err{color:#c0392b}.ok{color:#0a8f5b}
  a{color:#7aa2ff;text-decoration:none}
</style></head><body>
<form class="box" onsubmit="return reg(event)">
  <h1>🏠 Registrace</h1><div class="sub">Vytvoř si účet do Deal Dashboardu.</div>
  <label>E-mail</label><input id="email" type="email" autocomplete="username" required>
  <label>Heslo (min. 6 znaků)</label><input id="password" type="password" autocomplete="new-password" required>
  <label>Zvací kód</label><input id="code" type="text" required>
  <button type="submit">Zaregistrovat</button>
  <div class="msg" id="msg"></div>
  <div style="text-align:center;margin-top:14px;font-size:13px"><a href="/login">Už mám účet — přihlásit</a></div>
</form>
<script>
async function reg(e){
  e.preventDefault();
  const m=document.getElementById('msg');m.className='msg';m.textContent='…';
  const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email.value,password:password.value,code:code.value})});
  const d=await r.json().catch(()=>({}));
  if(r.ok && d.loggedIn){location.href='/';return false;}
  if(r.ok){m.className='msg ok';m.textContent='Účet vytvořen. Potvrď registraci v e-mailu a pak se přihlas.';return false;}
  m.className='msg err';m.textContent=d.error||'Registrace selhala.';
  return false;
}
</script></body></html>`;
