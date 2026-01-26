## 0.4.0 (2026-01-26)

* Merge pull request #33 from robotnikz/ui-fixes ([d5eca3b](https://github.com/robotnikz/sentinel-dns/commit/d5eca3b)), closes [#33](https://github.com/robotnikz/sentinel-dns/issues/33)
* test(server): cover ignore retention and upstream filtering ([41c4f0d](https://github.com/robotnikz/sentinel-dns/commit/41c4f0d))
* fix(web): improve modal UX ([3f5c4d7](https://github.com/robotnikz/sentinel-dns/commit/3f5c4d7))
* feat(server): increase metrics granularity ([b97ac58](https://github.com/robotnikz/sentinel-dns/commit/b97ac58))
* feat(server): persist ignored suspicious signatures ([72be73c](https://github.com/robotnikz/sentinel-dns/commit/72be73c))
* feat(web): persist suspicious ignores ([a928fbe](https://github.com/robotnikz/sentinel-dns/commit/a928fbe))

## <small>0.3.5 (2026-01-26)</small>

* Merge pull request #32 from robotnikz/fix/misc-fixes-2 ([480631b](https://github.com/robotnikz/sentinel-dns/commit/480631b)), closes [#32](https://github.com/robotnikz/sentinel-dns/issues/32)
* fix: add client policy edit and delete ([bd44d78](https://github.com/robotnikz/sentinel-dns/commit/bd44d78))
* fix: add traffic analysis time picker ([2d86fb0](https://github.com/robotnikz/sentinel-dns/commit/2d86fb0))
* fix: address frontend typecheck errors ([4aa7e64](https://github.com/robotnikz/sentinel-dns/commit/4aa7e64))
* fix: dedupe category rows and clarify app lists ([01177e3](https://github.com/robotnikz/sentinel-dns/commit/01177e3))
* fix: improve query log navigation and live view ([a0713bd](https://github.com/robotnikz/sentinel-dns/commit/a0713bd))
* fix: streamline default blocklists and category sources ([810741c](https://github.com/robotnikz/sentinel-dns/commit/810741c))
* fix: sync suspicious activity views ([4a76ac2](https://github.com/robotnikz/sentinel-dns/commit/4a76ac2))

## <small>0.3.4 (2026-01-26)</small>

* Merge pull request #31 from robotnikz/fix/query-logs-hostnames ([d4556b2](https://github.com/robotnikz/sentinel-dns/commit/d4556b2)), closes [#31](https://github.com/robotnikz/sentinel-dns/issues/31)
* fix: show discovered hostnames in query logs ([5cc7ebe](https://github.com/robotnikz/sentinel-dns/commit/5cc7ebe))

## <small>0.3.3 (2026-01-26)</small>

* Merge pull request #30 from robotnikz/fix/doh-upstream-headers ([df04523](https://github.com/robotnikz/sentinel-dns/commit/df04523)), closes [#30](https://github.com/robotnikz/sentinel-dns/issues/30)
* fix: set http2 DoH authority and SNI ([6050e37](https://github.com/robotnikz/sentinel-dns/commit/6050e37))

## <small>0.3.2 (2026-01-26)</small>

* Merge pull request #29 from robotnikz/fix/dns-rewrites ([5ed2e19](https://github.com/robotnikz/sentinel-dns/commit/5ed2e19)), closes [#29](https://github.com/robotnikz/sentinel-dns/issues/29)
* fix: support wildcard DNS rewrites ([f8752d1](https://github.com/robotnikz/sentinel-dns/commit/f8752d1))

## <small>0.3.1 (2026-01-26)</small>

* Merge pull request #28 from robotnikz/fix/doh-http2 ([12ca24a](https://github.com/robotnikz/sentinel-dns/commit/12ca24a)), closes [#28](https://github.com/robotnikz/sentinel-dns/issues/28)
* fix: add HTTP/2 support for DoH upstreams ([16ceec7](https://github.com/robotnikz/sentinel-dns/commit/16ceec7))

## 0.3.0 (2026-01-26)

* Fix CodeQL alerts + stabilize E2E ([5851e09](https://github.com/robotnikz/sentinel-dns/commit/5851e09))
* Fix CodeQL rate limit and RNG alerts ([02fde5d](https://github.com/robotnikz/sentinel-dns/commit/02fde5d))
* Fix CodeQL rate limit detection ([8a77b59](https://github.com/robotnikz/sentinel-dns/commit/8a77b59))
* Fix CodeQL rate limit detection ([62ed023](https://github.com/robotnikz/sentinel-dns/commit/62ed023))
* Harden rate limiting for CodeQL ([67c08b4](https://github.com/robotnikz/sentinel-dns/commit/67c08b4))
* Merge pull request #21 from robotnikz/security/authz-hardening ([01ddc12](https://github.com/robotnikz/sentinel-dns/commit/01ddc12)), closes [#21](https://github.com/robotnikz/sentinel-dns/issues/21)
* Rate limit DB/FS routes (CodeQL) ([f60bc80](https://github.com/robotnikz/sentinel-dns/commit/f60bc80))
* Fix: make rate limiting CodeQL-detectable ([f091f7e](https://github.com/robotnikz/sentinel-dns/commit/f091f7e))
* Fix: make route rate limits detectable ([2858b33](https://github.com/robotnikz/sentinel-dns/commit/2858b33))
* chore(ci): add workflows and test tooling ([5ec431b](https://github.com/robotnikz/sentinel-dns/commit/5ec431b))
* chore(repo): move frontend to web and compose to deploy ([fa85f45](https://github.com/robotnikz/sentinel-dns/commit/fa85f45))
* chore(security): make CodeQL recognize rate limits ([213e83c](https://github.com/robotnikz/sentinel-dns/commit/213e83c))
* chore(security): make rate limiting CodeQL-visible ([f772372](https://github.com/robotnikz/sentinel-dns/commit/f772372))
* ci: add frontend typecheck and cache Playwright ([d894017](https://github.com/robotnikz/sentinel-dns/commit/d894017))
* ci: build frontend on PRs ([f978feb](https://github.com/robotnikz/sentinel-dns/commit/f978feb))
* test: add unit/integration/smoke/e2e coverage ([530af32](https://github.com/robotnikz/sentinel-dns/commit/530af32))
* feat(server): authz hardening and DNS behavior ([cddd5f5](https://github.com/robotnikz/sentinel-dns/commit/cddd5f5))
* docs: fix compose snippet and docs consistency ([17709ef](https://github.com/robotnikz/sentinel-dns/commit/17709ef))

## <small>0.2.3 (2026-01-25)</small>

* fix(ui): don't force https via CSP/HSTS ([c9ae9c3](https://github.com/robotnikz/sentinel-dns/commit/c9ae9c3))

## <small>0.2.2 (2026-01-25)</small>

* fix(ui): avoid SPA fallback for missing assets ([d7e0767](https://github.com/robotnikz/sentinel-dns/commit/d7e0767))

## <small>0.2.1 (2026-01-25)</small>

* fix(compose): ensure UI binds on all interfaces ([42bf21f](https://github.com/robotnikz/sentinel-dns/commit/42bf21f))
* chore(repo): add discussion templates ([396024d](https://github.com/robotnikz/sentinel-dns/commit/396024d))

## 0.2.0 (2026-01-25)

* chore(repo): add community health files ([aaa124e](https://github.com/robotnikz/sentinel-dns/commit/aaa124e))
* chore(screenshots): default to viewport captures ([f878912](https://github.com/robotnikz/sentinel-dns/commit/f878912))
* docs(readme): highlight key features ([d95a873](https://github.com/robotnikz/sentinel-dns/commit/d95a873))
* docs(readme): sunflow-style quickstart + screenshots ([9ccb9d6](https://github.com/robotnikz/sentinel-dns/commit/9ccb9d6))
* docs(screenshots): normalize preview sizes ([56563b9](https://github.com/robotnikz/sentinel-dns/commit/56563b9))
* feat(geoip): keep blocked-domain map points ([595d959](https://github.com/robotnikz/sentinel-dns/commit/595d959))
* feat(tailscale): support exit-node mode ([051e3e7](https://github.com/robotnikz/sentinel-dns/commit/051e3e7))

## <small>0.1.1 (2026-01-25)</small>

* fix(docker): install rollup package per arch ([56058d0](https://github.com/robotnikz/sentinel-dns/commit/56058d0))

## 0.1.0 (2026-01-25)

* fix(ci): add conventionalcommits preset for semantic-release ([0a971a7](https://github.com/robotnikz/sentinel-dns/commit/0a971a7))
* fix(ci): force ISO git dates for release notes ([eeeb851](https://github.com/robotnikz/sentinel-dns/commit/eeeb851))
* fix(ci): guard invalid commit dates in release notes ([8911d4e](https://github.com/robotnikz/sentinel-dns/commit/8911d4e))
* fix(ci): publish ghcr image and set container name ([b1b40a0](https://github.com/robotnikz/sentinel-dns/commit/b1b40a0))
* fix(ci): run semantic-release via npx ([e3ca161](https://github.com/robotnikz/sentinel-dns/commit/e3ca161))
* feat: add CI/CD pipeline with semantic-release and GHCR ([23f48ed](https://github.com/robotnikz/sentinel-dns/commit/23f48ed))

# Changelog

All notable changes to this project will be documented in this file.

This project uses semantic-release.
