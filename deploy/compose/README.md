# Docker Compose templates

This folder contains **multiple** Compose files for different scenarios.

- **docker-compose.yml**: recommended baseline for a normal install (includes optional keepalived sidecar).
- **docker-compose.local-2node.yml**: local 2-node simulation (no VRRP/VIP; useful on Windows/macOS).
- **docker-compose.local.yml**: local dev/build helper.
- **docker-compose.smoke.yml**: smoke-test profile with high ports and a separate volume.

Tip: if you want to customize ports/env without forking these files, create a `docker-compose.override.yml` (or `docker-compose.*.override.yml`).
Those override files are ignored by git via the repo `.gitignore`.
