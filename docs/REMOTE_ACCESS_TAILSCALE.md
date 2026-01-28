# Remote access (Tailscale)

This guide covers **optional remote access** for Sentinel-DNS using **Tailscale**.

If you only want LAN DNS blocking, you do **not** need this.

## What you can do

- Reach the **Web UI / API** over your tailnet.
- Use Sentinel as a **tailnet DNS nameserver** for on-the-go devices.
- (Optional) Enable **Exit Node** to route all traffic “back home” over Tailscale.

## Prerequisites

- A Tailscale account + access to the admin console.
- Sentinel-DNS running (see the main README Quickstart).

Notes:

- Exit Node requires extra container privileges (`NET_ADMIN`, `/dev/net/tun`, and IP forwarding sysctls).
- DNS-only tailnet usage does **not** require Exit Node.

## Setup (UI)

1. Open the Web UI.
2. Go to: **Settings → Remote Access (Tailscale)**.
3. Use the sign-in/connect flow (browser auth) and complete the login.
4. Optional: instead of browser auth, paste a reusable **auth key** from the Tailscale admin console.
5. If you enabled Exit Node, approve the route/exit-node advertisement in the Tailscale admin console.

## Configure tailnet DNS to use Sentinel

To route DNS through Sentinel for your tailnet devices:

- Set your tailnet **DNS nameserver(s)** to Sentinel’s **Tailscale IP**.
- In the Tailscale admin console, ensure **Override DNS Servers** is enabled.

## Tailscale clients + Query Logs (common gotcha)

If tailnet devices use Sentinel as DNS but you **don’t see queries** in Query Logs:

- Some Tailscale clients prefer the **IPv6 tailnet address** of the resolver (e.g. `fd7a:...`).
- Sentinel’s DNS server must be listening on **IPv4 and IPv6** to see and log those requests.

Per-client policies for Tailscale work the same as LAN devices:

- Add each device as a client using its stable Tailscale IP (usually in `100.64.0.0/10`, or an IPv6 tailnet address).
- Or add a CIDR client for a whole tailnet range if you want one shared policy.

Once the DNS requests are logged, the Query Logs view can help identify which client IPs you should add.

## Related docs

- Operations notes (exposure, reverse proxy, backups): [docs/OPERATIONS.md](OPERATIONS.md)
- HA / VIP failover (unrelated to Tailscale): [docs/CLUSTER_HA.md](CLUSTER_HA.md)
