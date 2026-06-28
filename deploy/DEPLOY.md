# Nasazení na Hostinger VPS (Ubuntu)

Cíl: dashboard běží trvale na veřejné HTTPS adrese s přihlášením, a data se každou
hodinu obnovují cronem. Příkazy spouštěj přes SSH na VPS (`ssh root@IP_VPS`).

## 0) Co poběží
- **Dashboard** (always-on Node server) — `src/dashboard/server.js`, drží ho pm2.
- **Datový cyklus** (cron) — `src/run_cycle.js` = sync → normalize → evaluate → liveness.
- **Scrapery** (volitelné, později) — annonce/avizo/hyperinzerce potřebují Playwright
  + Chromium. Bazoš chodí externím feedem, ten neřešíš.

## 1) Node.js + nástroje
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
sudo npm install -g pm2
```

## 2) Kód + závislosti
```bash
cd /opt
git clone <URL_TVeho_REPO> real-estates   # nebo nahraj soubory přes SFTP
cd real-estates
npm install --omit=dev
```

## 3) Konfigurace (.env)
```bash
cp .env.example .env
nano .env            # vyplň SUPABASE_*, N8N_WEBHOOK_URL, OPENAI_API_KEY
                     # AUTH_ENABLED=1, COOKIE_SECURE=1
                     # SESSION_SECRET= $(openssl rand -base64 32)
```
V Supabase založ přihlašovacího uživatele: **Authentication → Users → Add user**.

## 4) Spuštění dashboardu (pm2)
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # vypíše příkaz – spusť ho, aby pm2 naběhl po rebootu
```
Test lokálně na VPS: `curl -I http://127.0.0.1:3000` → mělo by být 302 (redirect na /login).

## 5) Doména + HTTPS (nginx + certbot)
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/deal-dashboard
sudo nano /etc/nginx/sites-available/deal-dashboard   # nastav server_name na svou doménu
sudo ln -s /etc/nginx/sites-available/deal-dashboard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.tvoje-domena.cz    # přidá SSL automaticky
```
(V Hostingeru nasměruj A záznam domény/subdomény na IP VPS.)

## 6) Cron — obnova dat každou hodinu
```bash
crontab -e
# přidej řádek:
0 * * * * cd /opt/real-estates && /usr/bin/node src/run_cycle.js >> /var/log/deal-cycle.log 2>&1
```

## 7) (Později) scrapery na vlastní data
Pro annonce/avizo/hyperinzerce:
```bash
npx playwright install --with-deps chromium
# a do cronu např. 1x denně:
# 30 5 * * * cd /opt/real-estates && /usr/bin/node src/index.js >> /var/log/deal-scrape.log 2>&1
```

## Užitečné
- Logy dashboardu: `pm2 logs deal-dashboard`
- Restart po změně kódu: `git pull && pm2 restart deal-dashboard`
- Cyklus ručně: `node src/run_cycle.js`
