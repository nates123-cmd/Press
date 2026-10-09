# Official Playwright image: Chromium plus every system lib it needs, pinned to
# the same version as package.json so the browser build matches the driver.
FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY fetch.mjs extract.mjs ./
ENV NODE_ENV=production NYT_STATE=/app/state/nyt-state.json
CMD ["node", "fetch.mjs"]
