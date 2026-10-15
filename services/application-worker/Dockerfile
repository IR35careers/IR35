FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && node -e "const p=require('playwright-core/package.json');if(p.version!=='1.61.0')throw new Error('Update the Playwright image and package together')"

COPY --chown=pwuser:pwuser tsconfig.json ./
COPY --chown=pwuser:pwuser src ./src
COPY --chown=pwuser:pwuser services/application-worker ./services/application-worker

ENV NODE_ENV=production
ENV PORT=8787
ENV APPLICATION_RUNNER_BUDGET_MS=300000

EXPOSE 8787

USER pwuser
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "services/application-worker/railway.ts"]
