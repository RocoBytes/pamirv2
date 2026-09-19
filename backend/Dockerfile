# syntax=docker/dockerfile:1
# ── Etapa de build ────────────────────────────────────────────────────────────
# Orden crítico (mismo que render.yaml): prisma generate → tsc.
# src/generated/ está gitignorado, por lo que SIEMPRE debe generarse aquí.
# Las migraciones NO corren en build (no hay DB viva): ver servicio `migrate`
# en deploy/docker-compose.yml.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run db:generate && npm run build

# ── Etapa de runtime ──────────────────────────────────────────────────────────
# Solo deps de producción (incluye la CLI de prisma para `migrate deploy`,
# que el servicio one-shot `migrate` ejecuta en cada deploy).
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY prisma.config.ts ./
COPY prisma ./prisma
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
