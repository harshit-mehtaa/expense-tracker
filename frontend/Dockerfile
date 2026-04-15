# ── Stage 1: builder (used for dev) ──────────────────────────────────────
FROM ghcr.io/harshit-mehtaa/node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# ── Stage 2: production (static build served by nginx) ───────────────────
FROM builder AS production

RUN npx vite build

FROM ghcr.io/harshit-mehtaa/nginx:alpine AS production-server
COPY --from=production /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
