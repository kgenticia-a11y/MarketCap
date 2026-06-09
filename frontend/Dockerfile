# Frontend Dockerfile — Vite build served by nginx
FROM node:20-alpine AS build

WORKDIR /app

# Install deps with lockfile for reproducible builds
COPY package.json package-lock.json* ./
RUN npm ci

# Build the app — VITE_API_URL must be passed at build time
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build


# ── Runtime ───────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
