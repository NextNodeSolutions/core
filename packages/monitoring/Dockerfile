FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS prepare
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	pnpm add -g turbo@2.9.3
COPY . .
RUN turbo prune @nextnode-solutions/monitoring --docker

FROM base AS deps
COPY --from=prepare /repo/out/json/ ./
COPY --from=prepare /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	CI=1 pnpm install --frozen-lockfile

FROM deps AS build
COPY --from=prepare /repo/out/full/ ./
RUN pnpm exec turbo build --filter=@nextnode-solutions/monitoring

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/packages/monitoring/dist ./dist
COPY --from=build /repo/packages/monitoring/package.json ./
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
