// PM2 process config — keeps the dashboard running and auto-restarts on crash/reboot.
//   pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
    apps: [
        {
            name: 'deal-dashboard',
            script: 'src/dashboard/server.js',
            cwd: __dirname,            // load .env from project root
            instances: 1,
            autorestart: true,
            max_restarts: 10,
            env: { NODE_ENV: 'production' }
            // All secrets/flags come from .env (loaded via dotenv in db/client.js).
        }
    ]
};
