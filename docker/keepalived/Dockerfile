FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    keepalived \
    curl \
    iproute2 \
    jq \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY docker/keepalived/entrypoint.sh /entrypoint.sh
COPY docker/keepalived/keepalived.conf.template /keepalived.conf.template
COPY docker/keepalived/notify.sh /notify.sh

RUN chmod +x /entrypoint.sh /notify.sh

ENTRYPOINT ["/entrypoint.sh"]
