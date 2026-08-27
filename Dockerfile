# Build context is the repo root, so the deploy does not depend on Railway's
# "Root Directory" service setting being configured correctly. Leave that setting
# blank.
#
# Everything the image needs lives under server/, including db/schema.sql. Nothing
# is copied from elsewhere in the repo: an earlier version pulled the schema from a
# top-level db/ and Railway's build context did not reliably contain it.

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
COPY server/db ./db

EXPOSE 3000
CMD ["node", "dist/index.js"]
