# syntax=docker/dockerfile:1
# ── Etapa de build ────────────────────────────────────────────────────────────
# Tailwind 4 (Oxide) usa un binario nativo: el build SIEMPRE ocurre dentro del
# contenedor, nunca copiando node_modules del host.
# IMPORTANTE: VITE_API_URL se deja SIN definir a propósito. Con eso,
# src/lib/api.ts usa la ruta relativa '/api' y todo queda same-origin detrás
# del nginx de este mismo contenedor (CORS deja de aplicar en el navegador).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Etapa de runtime ──────────────────────────────────────────────────────────
# nginx sirve el SPA, termina TLS (cert de origen de Cloudflare montado desde
# /opt/pamir/certs) y proxea /api al contenedor del backend.
FROM nginx:1.29-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
