## [0.8.2](https://github.com/robotnikz/sentinel-dns/compare/v0.8.1...v0.8.2) (2026-01-28)

### fix

* release ([](https://github.com/robotnikz/sentinel-dns/commit/c11ee2e07a855372e514a9607868107a5975fc8d))

## [0.8.1](https://github.com/robotnikz/sentinel-dns/compare/v0.8.0...v0.8.1) (2026-01-28)

### fix

* **ui:** correct HA failover label and prevent cluster page crash ([](https://github.com/robotnikz/sentinel-dns/commit/642c77c6b8d8f106a08eeca50da82eb0b86305b3))

### chore

* ignore local overrides and artifacts ([](https://github.com/robotnikz/sentinel-dns/commit/7781b6120fa535f2bd7ebd6b8c8f21891a3b835a))

### docs

* improve public install docs ([](https://github.com/robotnikz/sentinel-dns/commit/d65debf1daeac147c9e99c84eefd4fb83ffd51d5))

## [0.8.0](https://github.com/robotnikz/sentinel-dns/compare/v0.7.8...v0.8.0) (2026-01-28)

### chore

* bump version ([](https://github.com/robotnikz/sentinel-dns/commit/a722a639f81fa26e225e18368e359a9834060070))
* **screenshots:** seed demo data and optional 2-node cluster ([](https://github.com/robotnikz/sentinel-dns/commit/ab60ca9c209b3c94e8c7670ff6055d91a330da62))

### docs

* refresh screenshots ([](https://github.com/robotnikz/sentinel-dns/commit/ad09bfb26fa5c0276ba68d0cdf8f710b048bc612))
* update install instructions and docs index ([](https://github.com/robotnikz/sentinel-dns/commit/dc8ccf7c9be2db9261040652c2aa59c025b5a965))

### fix

* **cluster:** make sync convergent and expose peer status ([](https://github.com/robotnikz/sentinel-dns/commit/dbfc8114990a10e9100ea369ce64336653eea14b))
* **ui:** prevent edits on follower client policies ([](https://github.com/robotnikz/sentinel-dns/commit/627d044eb0b221769c2d582f2a90a839ae52bd65))
* **ui:** simplify cluster page after setup ([](https://github.com/robotnikz/sentinel-dns/commit/ab0ee91f55f8f56a7f59a496695c177b1f736345))

### feat

* **ui:** show cluster indicator in sidebar ([](https://github.com/robotnikz/sentinel-dns/commit/3d32d4c4eb9de1f8c20f366e757bafbc6a50c133))

## [0.7.8](https://github.com/robotnikz/sentinel-dns/compare/v0.7.7...v0.7.8) (2026-01-28)

### fix

* **ha:** readiness uses configured role for failback ([](https://github.com/robotnikz/sentinel-dns/commit/9883dc09d647ab6e701c5ac080d5c983ba9bf906))

## [0.7.7](https://github.com/robotnikz/sentinel-dns/compare/v0.7.6...v0.7.7) (2026-01-28)

### fix

* **dns:** bootstrap resolve DoH/DoT endpoints ([](https://github.com/robotnikz/sentinel-dns/commit/4be1abb5a7e70263dc738f623b7a7f52499629ac))

## [0.7.6](https://github.com/robotnikz/sentinel-dns/compare/v0.7.5...v0.7.6) (2026-01-28)

### fix

* **ha:** enable failback + faster ARP convergence ([](https://github.com/robotnikz/sentinel-dns/commit/f13f7b228a824156b4d43408f9412c2d704255eb))

## [0.7.5](https://github.com/robotnikz/sentinel-dns/compare/v0.7.4...v0.7.5) (2026-01-28)

### fix

* **cluster:** preserve local admin sessions on follower ([](https://github.com/robotnikz/sentinel-dns/commit/0eff64a104410eaa91baa2e2d415c8f59d3c6e3f))

## [0.7.4](https://github.com/robotnikz/sentinel-dns/compare/v0.7.3...v0.7.4) (2026-01-28)

### fix

* **ha:** make keepalived ready-check parse JSON ([](https://github.com/robotnikz/sentinel-dns/commit/b80353d0c784ad9c55c381d4715826483f9b4758))

## [0.7.3](https://github.com/robotnikz/sentinel-dns/compare/v0.7.2...v0.7.3) (2026-01-28)

### fix

* **ui:** simplify HA setup wizard ([](https://github.com/robotnikz/sentinel-dns/commit/6f412f202d448f1690301ebb8107d75708f5dc13))

## [0.7.2](https://github.com/robotnikz/sentinel-dns/compare/v0.7.1...v0.7.2) (2026-01-28)

* Merge pull request #51 from robotnikz/fix/ha-autodetect-joincode ([](https://github.com/robotnikz/sentinel-dns/commit/b689c2ada09eb5e47c30d014964e53c61ff1c3f7)), closes [#51](https://github.com/robotnikz/sentinel-dns/issues/51)

### fix

* HA autodetect + join code under role override ([](https://github.com/robotnikz/sentinel-dns/commit/ea77ef843d5808e0ca94ff82822e042d14eb3c29))

## [0.7.1](https://github.com/robotnikz/sentinel-dns/compare/v0.7.0...v0.7.1) (2026-01-28)

* Merge pull request #50 from robotnikz/fix/compose-keepalived-image ([](https://github.com/robotnikz/sentinel-dns/commit/b3a52c1dafe159a0d8cf0dd09196837f599aed86)), closes [#50](https://github.com/robotnikz/sentinel-dns/issues/50)

### fix

* **compose:** deploy keepalived via image by default ([](https://github.com/robotnikz/sentinel-dns/commit/b96436f3929db51a6c7a61fcd38f7ce552931b06))

## [0.7.0](https://github.com/robotnikz/sentinel-dns/compare/v0.6.5...v0.7.0) (2026-01-28)

* Merge pull request #49 from robotnikz/node-sync ([](https://github.com/robotnikz/sentinel-dns/commit/3878a74f87e77b2a14d5211c10d63ddf6e9e9c81)), closes [#49](https://github.com/robotnikz/sentinel-dns/issues/49)
* Merge remote-tracking branch 'origin/main' into node-sync ([](https://github.com/robotnikz/sentinel-dns/commit/d18400f22a54230b77684a71bf38ff8a8ed96dac))

### chore

* **dev:** add local 2-node HA test harness ([](https://github.com/robotnikz/sentinel-dns/commit/0717d7620cf3b05f32a30ea20a91af7d974d0596))

### docs

* **cluster:** add concrete port-53 fix steps ([](https://github.com/robotnikz/sentinel-dns/commit/dc2b8f98339a2a18b2e1a7761b3929aff9c971c3))
* **cluster:** add Proxmox LXC workaround ([](https://github.com/robotnikz/sentinel-dns/commit/1b1a2e5a083afb65a1d9ebfbf0c943f98faff4a1))
* keep README basic; link advanced guides ([](https://github.com/robotnikz/sentinel-dns/commit/5ec538956e95e9a35e4241b5a6793fcd6dd9f0eb))
* **readme:** update compose example ([](https://github.com/robotnikz/sentinel-dns/commit/0d7d344e6dc7d66a673cd91482094714c1032890))

### fix

* **web:** prevent Cluster/HA blank page ([](https://github.com/robotnikz/sentinel-dns/commit/2dcbe6bc65b978c3636ac7d0a93cd8d341e333cb))

### feat

* **cluster:** add VIP HA + sync UI ([](https://github.com/robotnikz/sentinel-dns/commit/c16238553aa9f0d7ddaef3c70b642a64c4d722b8))
* **cluster:** harden HA guard + add integration tests ([](https://github.com/robotnikz/sentinel-dns/commit/8af4b0b92344160e70da6d110b46535f2818a3de))
* **cluster:** join-code TTL + sync metrics + HMAC hardening ([](https://github.com/robotnikz/sentinel-dns/commit/b4636d833865261b71d92c5adc0bc29d8799ce5a))

### ui

* **cluster:** show active/standby badge ([](https://github.com/robotnikz/sentinel-dns/commit/c1118bb2ee165ef705e1ea238cf0427ddc48b98b))

## [0.6.5](https://github.com/robotnikz/sentinel-dns/compare/v0.6.4...v0.6.5) (2026-01-28)

* Merge pull request #48 from robotnikz/fix/remove-dating-and-auditor-domaincheck ([](https://github.com/robotnikz/sentinel-dns/commit/faa745d1a48ed3dcb2142943a958418c7c9e1e71)), closes [#48](https://github.com/robotnikz/sentinel-dns/issues/48)

### fix

* remove dating category and improve policy auditing ([](https://github.com/robotnikz/sentinel-dns/commit/b693a9ab123abd06baa0e5dc5bb622aeaeceab97))

## [0.6.4](https://github.com/robotnikz/sentinel-dns/compare/v0.6.3...v0.6.4) (2026-01-28)

* Merge pull request #47 from robotnikz/fix/modal-client-network-settings ([](https://github.com/robotnikz/sentinel-dns/commit/8de6095760ace39eb47542820b29a1bea93500c1)), closes [#47](https://github.com/robotnikz/sentinel-dns/issues/47)

### fix

* restore modal settings + subnet create feedback ([](https://github.com/robotnikz/sentinel-dns/commit/d6cb5ac049bedd36ee53711ef78b6f649adc4096))

## [0.6.3](https://github.com/robotnikz/sentinel-dns/compare/v0.6.2...v0.6.3) (2026-01-27)

* Merge pull request #46 from robotnikz/fix/trigger-release ([](https://github.com/robotnikz/sentinel-dns/commit/c2fbc7d4b1e9f86546220f0aed665934790bd18e)), closes [#46](https://github.com/robotnikz/sentinel-dns/issues/46)

### fix

* **dns:** fix DoH IPv4-first lookup for undici ([](https://github.com/robotnikz/sentinel-dns/commit/6262ae640b9b21a84729abab7e61ed30519ded7d))
* **release:** trigger patch release ([](https://github.com/robotnikz/sentinel-dns/commit/aad150889d9a9f24429ba5f98f1b2f79048ad3af))

## [0.6.2](https://github.com/robotnikz/sentinel-dns/compare/v0.6.1...v0.6.2) (2026-01-27)

* Merge pull request #45 from robotnikz/fix/dns-forward-timeouts ([](https://github.com/robotnikz/sentinel-dns/commit/80083934449881d512ce346eb0c99d97baa55daa)), closes [#45](https://github.com/robotnikz/sentinel-dns/issues/45)

### fix

* **dns:** default DoH prefer IPv4 with fallback ([](https://github.com/robotnikz/sentinel-dns/commit/917f62ae73b2687d74f58fc6305c69841a0b46d9))
* **dns:** DoH keep-alive + optional IPv4 prefer ([](https://github.com/robotnikz/sentinel-dns/commit/23231a4a8950465055f264b2e3c1e3df1de5b455))
* **dns:** prefer DoH over HTTP/1 ([](https://github.com/robotnikz/sentinel-dns/commit/bb2679f9c1cc275f5b22d1080e79166e0a148a69))

## [0.6.1](https://github.com/robotnikz/sentinel-dns/compare/v0.6.0...v0.6.1) (2026-01-27)

* Merge pull request #44 from robotnikz/fix/dns-forward-timeouts ([](https://github.com/robotnikz/sentinel-dns/commit/79893372d0bd5353db9731012d3c46c26d9d2729)), closes [#44](https://github.com/robotnikz/sentinel-dns/issues/44)

### fix

* **dns:** configurable forward timeouts ([](https://github.com/robotnikz/sentinel-dns/commit/fba135b8be8cacc738befa2b96e55dd600a4b7dd))
* **dns:** default forward timeouts when missing ([](https://github.com/robotnikz/sentinel-dns/commit/e547639594efaf56ce8ef931465b55afd1361231))
* **dns:** raise default DoH forward timeout ([](https://github.com/robotnikz/sentinel-dns/commit/17ff7a3d231db36473fca306264a45508c48c6b3))

## [0.6.0](https://github.com/robotnikz/sentinel-dns/compare/v0.5.6...v0.6.0) (2026-01-27)

* Merge pull request #43 from robotnikz/fix/dns-upstream-telemetry ([](https://github.com/robotnikz/sentinel-dns/commit/966810e6ff2a2520308bd00493d55a5d4bd744c7)), closes [#43](https://github.com/robotnikz/sentinel-dns/issues/43)

### feat

* **dns:** add upstream forward telemetry ([](https://github.com/robotnikz/sentinel-dns/commit/953c76e7e75ef7b5097397c87fd36d4f05df280c))
* **server:** add maintenance endpoints ([](https://github.com/robotnikz/sentinel-dns/commit/51e079bb26edac8a288865aa0b938277fe232262))
* **server:** add query logs flush endpoint ([](https://github.com/robotnikz/sentinel-dns/commit/245fd13e15d1136611475a3cfd497f3cc4730dea))
* **web:** add maintenance settings UI ([](https://github.com/robotnikz/sentinel-dns/commit/e03144fe31cf61a037533106854c48e1a5d143ff))
* **web:** add reusable modal components ([](https://github.com/robotnikz/sentinel-dns/commit/6b18b9338b7fe3791013df94bc9e951f11df6f6f))
* **web:** slide-in client details sidebar ([](https://github.com/robotnikz/sentinel-dns/commit/738463df143f62c39ca1b354a22e937eaec239e2))
* **web:** slide-in network map details panel ([](https://github.com/robotnikz/sentinel-dns/commit/207cff0c2bcac2bd98d617c2bfa8aef31dbdb8e9))

### fix

* **web:** allow deleting schedules ([](https://github.com/robotnikz/sentinel-dns/commit/149f5114a35212fe10886239e2ac78a9e259d40d))
* **web:** avoid mixed dynamic import warning ([](https://github.com/robotnikz/sentinel-dns/commit/f53a96932af7c362be7767ca38cc05f418262aa1))
* **web:** keep custom upstream resolvers on select ([](https://github.com/robotnikz/sentinel-dns/commit/746411835c6c4a715796f9cb03595913e15a6c32))
* **web:** prevent custom upstream from disappearing on select ([](https://github.com/robotnikz/sentinel-dns/commit/0e5a97cc2f2b1bcc99d9ac08e2c1be4d033f4be0))

### refactor

* **web:** standardize query log modals ([](https://github.com/robotnikz/sentinel-dns/commit/e26727d3e99288fef46e5cdd1bac3af83a2c7753))

### chore

* **deploy:** add local compose override ([](https://github.com/robotnikz/sentinel-dns/commit/a02c0c705527d1332a9569616821d387281ffb68))

## [0.5.6](https://github.com/robotnikz/sentinel-dns/compare/v0.5.5...v0.5.6) (2026-01-27)

### fix

* mention Tailscale Override DNS Servers ([](https://github.com/robotnikz/sentinel-dns/commit/9fd254b545ef2e4fb8a02c2815fbedd63b169d40))

## [0.5.5](https://github.com/robotnikz/sentinel-dns/compare/v0.5.4...v0.5.5) (2026-01-27)

### fix

* add DNS status + normalize client IPs ([](https://github.com/robotnikz/sentinel-dns/commit/cee3b5b051d2ec546f4ea8db493faed83fca444d))

## [0.5.4](https://github.com/robotnikz/sentinel-dns/compare/v0.5.3...v0.5.4) (2026-01-27)

### fix

* trigger patch release ([](https://github.com/robotnikz/sentinel-dns/commit/7a2f7bb107af1b95d164017ecb0bd05f79e0fefa))

* Merge pull request #42 from robotnikz/fix/tailscale-dns-logs ([](https://github.com/robotnikz/sentinel-dns/commit/918e552bd4c9e5d0d790a4092f3c30d8cb80ea52)), closes [#42](https://github.com/robotnikz/sentinel-dns/issues/42)

### Fix

* log Tailscale IPv6 DNS queries ([](https://github.com/robotnikz/sentinel-dns/commit/cf1d765c4d4b4bdeb754a2fc5ac6228a264dfb9e))

### docs

* overhaul app audit and mark completed items ([](https://github.com/robotnikz/sentinel-dns/commit/9d69d6153a8efce5fceb621de4794601ee64d3a8))

## [0.5.3](https://github.com/robotnikz/sentinel-dns/compare/v0.5.2...v0.5.3) (2026-01-27)

* Merge pull request #40 from robotnikz/bugfixes ([](https://github.com/robotnikz/sentinel-dns/commit/7462b9a9d724c749cdfd6c05fbbfd0577190b14d)), closes [#40](https://github.com/robotnikz/sentinel-dns/issues/40)

### web

* smooth live query log row updates ([](https://github.com/robotnikz/sentinel-dns/commit/5dcce3cfc98911fec6e3207aaedc25e7dd199ef7))

### docs

* add audit, threat model and test cases ([](https://github.com/robotnikz/sentinel-dns/commit/fa331c7ef32d5133ee6c1b0424a7be3d0bc4f351))
* clarify LAN/proxy defaults and retention ([](https://github.com/robotnikz/sentinel-dns/commit/0384512fb4ad96b2a4bc7d9e507ac7b12838e5cb))

### test

* **frontend:** cover apiFetch shim and clients loading ([](https://github.com/robotnikz/sentinel-dns/commit/6afd5ed27cfcfcfda241f2aa9520f9c51eb16122))

### fix

* **frontend:** default /api fetch to include cookies ([](https://github.com/robotnikz/sentinel-dns/commit/422403fcaad6838c9fec41935e35848b90b85b57))
* **server:** make trust proxy configurable ([](https://github.com/robotnikz/sentinel-dns/commit/c4a5c36022b80a5c6c794629c3bd0c8daf8449b6))

### perf

* **server:** batch query-logs ingest ([](https://github.com/robotnikz/sentinel-dns/commit/13ca013e74d5f54e62943699059fac2c937f5986))
* **server:** indexes, retention and metrics TTL cache ([](https://github.com/robotnikz/sentinel-dns/commit/060ac923ba83e5aa737511f4e795bade5b67c19a))

### security

* **server:** harden settings/secrets validation ([](https://github.com/robotnikz/sentinel-dns/commit/fb02a12124962b9322e371aba0af49cc17a2ad64))

### chore

* **release:** upgrade semantic-release toolchain ([](https://github.com/robotnikz/sentinel-dns/commit/4da1c1700d84bc5cdedfef6b5c436ef2579f1e76))

## <small>0.5.2 (2026-01-27)</small>

* fix: make client deletion reliable ([da13516](https://github.com/robotnikz/sentinel-dns/commit/da13516))

## <small>0.5.1 (2026-01-27)</small>

* fix: client/subnet policy precedence and clients page rename ([3e429d6](https://github.com/robotnikz/sentinel-dns/commit/3e429d6)), closes [#39](https://github.com/robotnikz/sentinel-dns/issues/39)
* Fix client/subnet rule precedence and cleanup ([c86ad93](https://github.com/robotnikz/sentinel-dns/commit/c86ad93))
* Fix e2e navigation after Clients rename ([1eded14](https://github.com/robotnikz/sentinel-dns/commit/1eded14))
* Merge pull request #39 from robotnikz/fix/quick-fixes ([3dbbd61](https://github.com/robotnikz/sentinel-dns/commit/3dbbd61)), closes [#39](https://github.com/robotnikz/sentinel-dns/issues/39)
* Remove Network Map graph tab and rename menu ([557b240](https://github.com/robotnikz/sentinel-dns/commit/557b240))

## 0.5.0 (2026-01-26)

* Merge pull request #38 from robotnikz/feat/dashboard-toplists-timeframe ([9099fa4](https://github.com/robotnikz/sentinel-dns/commit/9099fa4)), closes [#38](https://github.com/robotnikz/sentinel-dns/issues/38)
* feat(dashboard): sync toplists with traffic timeframe ([7711360](https://github.com/robotnikz/sentinel-dns/commit/7711360))

## <small>0.4.3 (2026-01-26)</small>

* Merge pull request #37 from robotnikz/fix/top-domains-resolver-noise ([eb64321](https://github.com/robotnikz/sentinel-dns/commit/eb64321)), closes [#37](https://github.com/robotnikz/sentinel-dns/issues/37)
* fix(metrics): exclude resolver noise domains ([e446dd2](https://github.com/robotnikz/sentinel-dns/commit/e446dd2))

## <small>0.4.2 (2026-01-26)</small>

* Merge pull request #36 from robotnikz/fix/top-domains-upstreams ([ec33686](https://github.com/robotnikz/sentinel-dns/commit/ec33686)), closes [#36](https://github.com/robotnikz/sentinel-dns/issues/36)
* fix(metrics): hide all configured upstream domains ([6b67650](https://github.com/robotnikz/sentinel-dns/commit/6b67650))

## <small>0.4.1 (2026-01-26)</small>

* Merge pull request #35 from robotnikz/fix/docker-dns ([8912574](https://github.com/robotnikz/sentinel-dns/commit/8912574)), closes [#35](https://github.com/robotnikz/sentinel-dns/issues/35)
* fix(docker): bootstrap outbound DNS on restart loops ([8a503dd](https://github.com/robotnikz/sentinel-dns/commit/8a503dd))

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
