# Built with the Railway service's Root Directory set to `/server`, so the build
# context is this directory and every path below is relative to it.
#
# Nothing outside server/ is referenced: the database schema is embedded in
# src/schema.ts rather than shipped as a file, so the image is self-contained.
#
# Locally:  cd server && docker build -t tutor-server .

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --include=dev is deliberate: TypeScript is a devDependency and the build needs
# it, but Railway sets NODE_ENV=production, under which npm ci would skip it.
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
