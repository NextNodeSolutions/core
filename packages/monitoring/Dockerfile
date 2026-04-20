FROM node:24-alpine AS base
WORKDIR /repo
RUN corepack enable pnpm

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @nextnode-solutions/monitoring...

FROM deps AS build
COPY . .
RUN pnpm --filter @nextnode-solutions/monitoring build

FROM build AS bundle
RUN pnpm --filter @nextnode-solutions/monitoring deploy --legacy --prod /deploy

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=bundle /deploy ./
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
