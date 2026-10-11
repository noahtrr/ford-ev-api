# Schritt 1: App bauen (mit allen Entwicklungswerkzeugen)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build

# Schritt 2: schlankes Image nur mit dem, was zum Laufen nötig ist
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/frontend/dist \
    PORT=8080
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace backend && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
# Docker prüft regelmäßig, ob die App antwortet (wird beim automatischen Deploy abgewartet).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "backend/dist/index.js"]
