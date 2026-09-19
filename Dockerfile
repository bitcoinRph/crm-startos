FROM node:24.21.0-bookworm-slim

COPY --from=oven/bun:1.3.12 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV NODE_ENV=production \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    API_URL=http://127.0.0.1:3001 \
    APP_URL=http://127.0.0.1:3000 \
    CRM_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1

RUN bun install --frozen-lockfile \
    && bun run build \
    && rm -rf node_modules/.cache apps/app/.next/cache \
    && echo "node_modules before: $(du -sh node_modules | cut -f1)" \
    && find . -type d \( \
         -path '*@next*swc-linux-*-musl*' -o \
         -path '*@biomejs*cli-linux-*' -o \
         -path '*@turbo*linux-*' \) \
       -prune -print -exec rm -rf {} + \
    && echo "node_modules after: $(du -sh node_modules | cut -f1)"

EXPOSE 3000 3001 2000
