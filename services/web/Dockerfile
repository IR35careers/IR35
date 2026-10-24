# syntax=docker/dockerfile:1.7
# Official multi-arch index verified to include linux/arm64; no paid builder.
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm install --global npm@11.19.0 --ignore-scripts --no-audit --no-fund && npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN --mount=type=secret,id=web-build,target=/opt/ir35/.env.web-build,required=true node services/web/build.mjs
RUN node node_modules/esbuild/bin/esbuild services/web/server.ts --bundle --platform=node --target=node22 --format=esm --outfile=web-server.mjs
RUN node node_modules/esbuild/bin/esbuild services/web/run-cron.ts --bundle --platform=node --target=node22 --format=esm --outfile=web-cron.mjs

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=128
COPY --from=build --chown=1002:1002 /app/.next/standalone ./
COPY --from=build --chown=1002:1002 /app/.next/static ./.next/static
COPY --from=build --chown=1002:1002 /app/public ./public
COPY --from=build --chown=1002:1002 /app/web-server.mjs ./web-server.mjs
COPY --from=build --chown=1002:1002 /app/web-cron.mjs ./web-cron.mjs
USER 1002:1002
EXPOSE 3000
# Liveness is not full stack readiness. /api/health truthfully remains503 until
# every required dependency (including the P6 worker) actually passes.
HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "web-server.mjs"]
