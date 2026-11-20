# Next.js web app (public site + internal hub + API). Build context: repository root.
FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/extension/package.json apps/extension/
COPY apps/workers/package.json apps/workers/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/engine/package.json packages/engine/
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @tuck/web

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /repo /repo
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["npm", "run", "start", "-w", "@tuck/web"]
