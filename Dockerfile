FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
# sqlite3 is native: its prebuilt binary may require a newer glibc than
# Bookworm, so compile it here without adding toolchains to the final image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm_config_build_from_source=true npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/database.sqlite
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node index.js ./index.js
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/api/health', r => { r.resume(); process.exitCode = r.statusCode === 200 ? 0 : 1 }).on('error', () => { process.exitCode = 1 })"
CMD ["node", "index.js"]
