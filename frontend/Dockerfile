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

# ── Runtime stage ─────────────────────────────────────────────────────────────
# nginx serves the SPA and proxies /api to the backend container. It never
# terminates TLS and mounts no certificates: it runs behind the server's
# shared Traefik, which does that job and forwards plain HTTP over the
# Docker network.
FROM nginx:1.29-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Identifies images from this stack so the deploy can prune only its own
# dangling images on the shared server, never other projects'.
LABEL cl.riala.stack="riala"
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
