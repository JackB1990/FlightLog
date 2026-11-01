# syntax=docker/dockerfile:1

# ---- Stage 1: fetch front-end libraries and the airport dataset ----------------
FROM node:22-alpine AS assets
WORKDIR /build
RUN apk add --no-cache curl
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund alpinejs@3.14.8 leaflet@1.9.4 \
 && (npm install --no-audit --no-fund tz-lookup@6 || echo 'tz-lookup unavailable: airports will have no time zone (durations are then estimated)')
# OurAirports public-domain dataset (~9,000 airports with IATA codes)
RUN curl -fsSL --retry 3 --retry-delay 2 -o airports.csv \
    https://davidmegginson.github.io/ourairports-data/airports.csv
COPY tools/build-airports.mjs ./
RUN node build-airports.mjs airports.csv airports.json

# ---- Stage 2: the app (no npm dependencies at runtime) -------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app

COPY shared ./shared
COPY server/index.js ./server/index.js
COPY server/data/airports-fallback.json ./server/data/airports-fallback.json
COPY frontend ./frontend
COPY --from=assets /build/airports.json ./server/data/airports.json
COPY --from=assets /build/node_modules/alpinejs/dist/cdn.min.js ./frontend/vendor/alpine.min.js
COPY --from=assets /build/node_modules/leaflet/dist/leaflet.js ./frontend/vendor/leaflet.js
COPY --from=assets /build/node_modules/leaflet/dist/leaflet.css ./frontend/vendor/leaflet.css
COPY --from=assets /build/node_modules/leaflet/dist/images ./frontend/vendor/images

# 568 is the "apps" user on TrueNAS, so dataset permissions line up by default.
RUN mkdir -p /data && chown -R 568:568 /data
USER 568:568
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
