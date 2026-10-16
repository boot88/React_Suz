FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Document archives are created with zip and restored with unzip.
RUN apt-get update \
    && apt-get install -y --no-install-recommends zip unzip \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src

RUN mkdir -p server/uploads server/data \
    && chown -R node:node server/uploads server/data

USER node

EXPOSE 5000

CMD ["node", "server/server.js"]
