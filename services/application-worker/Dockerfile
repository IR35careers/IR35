FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci && \
    mkdir -p /ms-playwright && \
    npx playwright-core install --with-deps chromium && \
    chown -R node:node /app /ms-playwright

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=8787
ENV APPLICATION_RUNNER_BUDGET_MS=300000

EXPOSE 8787

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "services/application-worker/server.ts"]
