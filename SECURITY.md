# Security

This project is intended for **self-hosting**.

## Hardening checklist

- Keep the container image up to date and prefer pinned version tags for controlled upgrades.
- Do not expose DNS (port 53) to the public internet.
- If you must expose the Web UI, put it behind TLS (reverse proxy) and restrict access.
- Use a strong admin password and rotate credentials if you suspect compromise.
- Treat API keys (AI providers, MaxMind license key, Tailscale auth keys) as secrets.
- Prefer LAN/VPN access (e.g. Tailscale) over public exposure.

## Supported versions

We generally support the latest release on `main` and the current published container image.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Preferred:

1. Use GitHub Security Advisories ("Report a vulnerability") if enabled for this repository.

If that option is not available:

2. Contact the maintainer privately, or open a normal GitHub issue **only** for non-sensitive hardening suggestions.

Include:

- A clear description of the issue and impact
- Steps to reproduce (if applicable)
- Affected versions/tags
- Any logs/screenshots that help (redact secrets)

## Disclosure

We aim to acknowledge reports quickly and provide a fix or mitigation as soon as feasible.
