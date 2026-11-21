# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.22.3
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=10000
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Keep migration files available for the separate pre-deploy command.
COPY --chown=node:node package.json package-lock.json knexfile.ts tsconfig.json ./
COPY --chown=node:node migrations ./migrations

USER node
EXPOSE 10000

CMD ["node", "dist/server.js"]
