# Dashboard + cycle runtime. No Playwright browsers needed here (scrapers run
# elsewhere), so we skip the browser download to keep the image slim.
FROM node:20-slim

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000
CMD ["node", "src/dashboard/server.js"]
