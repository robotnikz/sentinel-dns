# Single-container mode: Node (API+DNS) + Unbound + Postgres in one image.
# This is intentionally similar to the "appliance" style of Pi-hole / AdGuard Home.
# For production hardening you may later split DB out again.

FROM node:22-bookworm

# Build stage uses dev deps (Vite/TS). Runtime NODE_ENV is set later.
ENV NODE_ENV=development
ENV UPSTREAM_DNS=127.0.0.1:5335
ENV FRONTEND_ORIGIN=http://localhost:8080



# Install unbound + postgres + supervisor + tailscale deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    unbound \
    dns-root-data \
    postgresql \
    postgresql-contrib \
    supervisor \
    ca-certificates \
    curl \
    gnupg \
    iptables \
    iproute2 \
  && rm -rf /var/lib/apt/lists/*

# Prepare a writable location for Unbound's auto-updated DNSSEC trust anchor.
RUN mkdir -p /var/lib/unbound \
  && cp /usr/share/dns/root.key /var/lib/unbound/root.key \
  && chown -R unbound:unbound /var/lib/unbound

# Install Tailscale (official repo)
RUN set -eux; \
  curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg; \
  curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends tailscale; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first for better caching
COPY package.json ./
COPY server/package.json ./server/

# Install deps
# Note: we intentionally avoid copying host-generated package-lock.json here.
# Cross-platform lockfiles can break optional native deps (e.g. Rollup) in Linux builds.
RUN npm install --include=optional --no-audit --no-fund \
  && npm install --no-save @rollup/rollup-linux-x64-gnu \
  && npm --prefix server install --include=optional --no-audit --no-fund

# Copy sources
COPY . .

# Build UI + server
RUN npm run build \
  && npm --prefix server run build

# Unbound config
COPY docker/single/unbound.conf /etc/unbound/unbound.conf

# Supervisor config + entrypoint
COPY docker/single/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/single/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data dirs
VOLUME ["/data"]

EXPOSE 53/udp 53/tcp 8080

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DNS_HOST=0.0.0.0 \
    DNS_PORT=53 \
    ENABLE_DNS=true \
    UPSTREAM_DNS=127.0.0.1:5335 \
    FRONTEND_ORIGIN=http://localhost:8080

CMD ["/entrypoint.sh"]
