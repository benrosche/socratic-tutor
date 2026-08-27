# Build context is the repo root, so the deploy does not depend on Railway's
# "Root Directory" service setting being configured correctly. Leave that setting
# blank.
#
# Everything the image needs lives under server/src. The schema is embedded in the
# TypeScript (src/schema.ts) rather than shipped as a .sql file, because Railway's
# build context repeatedly failed to include it at any path.

FROM node:22-slim AS build
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
# --include=dev: TypeScript is a devDependency and the build needs it.
RUN npm ci --include=dev

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build


FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
