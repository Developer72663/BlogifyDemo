FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

# Install only runtime dependencies and keep the image deterministic enough for
# deployments even when a lockfile is not present in older project revisions.
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY . .

RUN chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 8000) + '/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "app.js"]
