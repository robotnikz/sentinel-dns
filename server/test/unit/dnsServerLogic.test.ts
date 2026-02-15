import { describe, expect, it, beforeEach } from 'vitest';
import dnsPacket from 'dns-packet';
import { __testing } from '../../src/dns/dnsServer.js';

describe('dnsServer logic', () => {
  it('normalizeName trims, lowercases and removes trailing dot', () => {
    expect(__testing.normalizeName(' Example.COM. ')).toBe('example.com');
    expect(__testing.normalizeName('')).toBe('');
  });

  it('matchesDomain matches exact and subdomain', () => {
    expect(__testing.matchesDomain('example.com', 'example.com')).toBe(true);
    expect(__testing.matchesDomain('example.com', 'a.b.example.com.')).toBe(true);
    expect(__testing.matchesDomain('example.com', 'example.net')).toBe(false);
  });

  // ── buildCandidateDomains (indexOf walk) ─────────────────────────────
  it('buildCandidateDomains builds suffix list', () => {
    expect(__testing.buildCandidateDomains('a.b.c')).toEqual(['a.b.c', 'b.c', 'c']);
    expect(__testing.buildCandidateDomains('')).toEqual([]);
  });

  it('buildCandidateDomains normalises trailing dot', () => {
    expect(__testing.buildCandidateDomains('Sub.Example.COM.')).toEqual([
      'sub.example.com', 'example.com', 'com'
    ]);
  });

  it('buildCandidateDomains handles single-label domain', () => {
    expect(__testing.buildCandidateDomains('localhost')).toEqual(['localhost']);
  });

  it('buildCandidateDomains handles deeply nested domain', () => {
    const result = __testing.buildCandidateDomains('a.b.c.d.e.f.g');
    expect(result).toEqual(['a.b.c.d.e.f.g', 'b.c.d.e.f.g', 'c.d.e.f.g', 'd.e.f.g', 'e.f.g', 'f.g', 'g']);
    expect(result).toHaveLength(7);
  });

  it('decideRuleIndexed: ignores manual rules (handled earlier) and evaluates blocklists only', () => {
    const index = {
      globalManualAllowed: new Set(['example.com']),
      globalManualBlocked: new Set(['example.com']),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['example.com', '1']])
    };

    const blocklistsById = new Map([
      ['1', { enabled: true, mode: 'ACTIVE', name: 'BL' }]
    ]);

    const selected = new Set(['1']);

    expect(__testing.decideRuleIndexed(index as any, 'example.com', blocklistsById as any, selected as any)).toEqual({
      decision: 'BLOCKED',
      blocklistId: '1'
    });
  });

  it('decideRuleIndexed: returns BLOCKED for active selected blocklist', () => {
    const index = {
      globalManualAllowed: new Set(),
      globalManualBlocked: new Set(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['example.com', '1']])
    };

    const blocklistsById = new Map([
      ['1', { enabled: true, mode: 'ACTIVE', name: 'BL1' }]
    ]);

    const selected = new Set(['1']);

    expect(__testing.decideRuleIndexed(index as any, 'example.com', blocklistsById as any, selected as any)).toEqual({
      decision: 'BLOCKED',
      blocklistId: '1'
    });
  });

  it('decideRuleIndexed: returns SHADOW_BLOCKED for shadow-only selection', () => {
    const index = {
      globalManualAllowed: new Set(),
      globalManualBlocked: new Set(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['example.com', '1']])
    };

    const blocklistsById = new Map([
      ['1', { enabled: true, mode: 'SHADOW', name: 'BL1' }]
    ]);

    const selected = new Set(['1']);

    expect(__testing.decideRuleIndexed(index as any, 'example.com', blocklistsById as any, selected as any)).toEqual({
      decision: 'SHADOW_BLOCKED',
      blocklistId: '1'
    });
  });

  it('decideRuleIndexed: prefers ACTIVE over SHADOW when both hit', () => {
    const index = {
      globalManualAllowed: new Set(),
      globalManualBlocked: new Set(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['example.com', ['1', '2']]])
    };

    const blocklistsById = new Map([
      ['1', { enabled: true, mode: 'SHADOW', name: 'BL1' }],
      ['2', { enabled: true, mode: 'ACTIVE', name: 'BL2' }]
    ]);

    const selected = new Set(['1', '2']);

    expect(__testing.decideRuleIndexed(index as any, 'example.com', blocklistsById as any, selected as any)).toEqual({
      decision: 'BLOCKED',
      blocklistId: '2'
    });
  });

  it('parseTimeToMinutes validates HH:MM', () => {
    expect(__testing.parseTimeToMinutes('08:05')).toBe(8 * 60 + 5);
    expect(__testing.parseTimeToMinutes('24:00')).toBeNull();
    expect(__testing.parseTimeToMinutes('aa:bb')).toBeNull();
  });

  it('isScheduleActiveNow handles schedules spanning midnight', () => {
    const schedule = {
      id: 's1',
      name: 'night',
      days: ['Mon'],
      startTime: '23:00',
      endTime: '01:00',
      active: true,
      mode: 'sleep',
      blockedCategories: [],
      blockedApps: []
    };

    // Use local-time Date construction because isScheduleActiveNow uses local getters.
    // Jan 5, 2026 is a Monday.
    expect(__testing.isScheduleActiveNow(schedule as any, new Date(2026, 0, 5, 23, 30))).toBe(true);
    expect(__testing.isScheduleActiveNow(schedule as any, new Date(2026, 0, 6, 0, 30))).toBe(true);
    expect(__testing.isScheduleActiveNow(schedule as any, new Date(2026, 0, 6, 2, 0))).toBe(false);
  });

  it('findClient prefers exact IP and then most specific CIDR', () => {
    const clients = [
      { id: 'cidr8', name: 'cidr8', cidr: '10.0.0.0/8' },
      { id: 'cidr16', name: 'cidr16', cidr: '10.0.0.0/16' },
      { id: 'exact', name: 'exact', ip: '10.0.0.5' }
    ];

    expect(__testing.findClient(clients as any, '10.0.0.5')?.id).toBe('exact');
    expect(__testing.findClient(clients.slice(0, 2) as any, '10.0.0.5')?.id).toBe('cidr16');
  });

  it('isAppBlockedByPolicy matches known service suffixes', () => {
    expect(__testing.isAppBlockedByPolicy('cdn.discordapp.com', ['discord'] as any)).toBe('discord');
    expect(__testing.isAppBlockedByPolicy('example.com', ['discord'] as any)).toBeNull();
  });

  it('loadRewritesFromSettings normalizes domains and filters invalid entries', () => {
    const rewrites = __testing.loadRewritesFromSettings({
      items: [
        { id: '1', domain: 'Example.COM.', target: '1.2.3.4' },
        { id: '', domain: 'nope.com', target: '1.1.1.1' }
      ]
    });
    expect(rewrites).toEqual([{ id: '1', domain: 'example.com', target: '1.2.3.4', wildcard: false }]);
  });

  it('buildLocalAnswerResponse returns A answer for IPv4 target', () => {
    const query: any = {
      type: 'query',
      id: 123,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type: 'A', name: 'smoke.test' }]
    };

    const buf = __testing.buildLocalAnswerResponse(query, 'smoke.test', 'A', '1.2.3.4');
    expect(buf).toBeInstanceOf(Buffer);

    const dec: any = dnsPacket.decode(buf as Buffer);
    expect(dec.rcode).toBe('NOERROR');
    expect(dec.answers?.[0]?.type).toBe('A');
    expect(dec.answers?.[0]?.data).toBe('1.2.3.4');
  });

  it('buildLocalAnswerResponse uses CNAME when A target is not an IP', () => {
    const query: any = {
      type: 'query',
      id: 123,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type: 'A', name: 'smoke.test' }]
    };

    const buf = __testing.buildLocalAnswerResponse(query, 'smoke.test', 'A', 'Alias.EXAMPLE');
    const dec: any = dnsPacket.decode(buf as Buffer);
    expect(dec.answers?.[0]?.type).toBe('CNAME');
    expect(dec.answers?.[0]?.data).toBe('alias.example');
  });

  it('extractAnswerIpsFromDnsResponse extracts and de-dupes A/AAAA', () => {
    const resp = dnsPacket.encode({
      type: 'response',
      id: 1,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type: 'A', name: 'x.test' }],
      answers: [
        { type: 'A', name: 'x.test', ttl: 60, data: '1.2.3.4' },
        { type: 'A', name: 'x.test', ttl: 60, data: '1.2.3.4' },
        { type: 'AAAA', name: 'x.test', ttl: 60, data: '::1' },
        { type: 'CNAME', name: 'x.test', ttl: 60, data: 'y.test' }
      ]
    } as any);

    expect(__testing.extractAnswerIpsFromDnsResponse(Buffer.from(resp))).toEqual(['1.2.3.4', '::1']);
  });

  it('buildNxDomainResponse overwrites only RCODE bits', () => {
    const query: any = {
      type: 'query',
      id: 999,
      flags: 0x0100, // RD
      questions: [{ type: 'A', name: 'blocked.test' }]
    };

    const buf = __testing.buildNxDomainResponse(query);
    const dec: any = dnsPacket.decode(buf);

    expect(dec.rcode).toBe('NXDOMAIN');
    const flags = typeof dec.flags === 'number' ? dec.flags : 0;
    expect(flags & 0x0100).toBe(0x0100);
    expect(flags & 0x0f).toBe(3);
  });

  it('buildServFailResponse overwrites only RCODE bits', () => {
    const query: any = {
      type: 'query',
      id: 888,
      flags: 0x0100, // RD
      questions: [{ type: 'A', name: 'fail.test' }]
    };

    const buf = __testing.buildServFailResponse(query);
    const dec: any = dnsPacket.decode(buf);

    expect(dec.rcode).toBe('SERVFAIL');
    const flags = typeof dec.flags === 'number' ? dec.flags : 0;
    expect(flags & 0x0100).toBe(0x0100);
    expect(flags & 0x0f).toBe(2);
  });

  // ── decideRuleIndexed with preComputedCandidates ─────────────────────
  it('decideRuleIndexed uses preComputedCandidates when provided', () => {
    const index = {
      globalManualAllowed: new Set<string>(),
      globalManualBlocked: new Set<string>(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['sub.example.com', '1']])
    };
    const blocklistsById = new Map([['1', { enabled: true, mode: 'ACTIVE', name: 'BL' }]]);
    const selected = new Set(['1']);

    // Passing pre-computed candidates means queryName is NOT re-processed
    const candidates = ['sub.example.com', 'example.com', 'com'];
    expect(__testing.decideRuleIndexed(index as any, 'IGNORED', blocklistsById as any, selected as any, candidates)).toEqual({
      decision: 'BLOCKED',
      blocklistId: '1'
    });
  });

  it('decideRuleIndexed returns NONE when preComputedCandidates has no match', () => {
    const index = {
      globalManualAllowed: new Set<string>(),
      globalManualBlocked: new Set<string>(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map([['other.com', '1']])
    };
    const blocklistsById = new Map([['1', { enabled: true, mode: 'ACTIVE', name: 'BL' }]]);
    const selected = new Set(['1']);

    expect(__testing.decideRuleIndexed(index as any, 'no-match.test', blocklistsById as any, selected as any, ['no-match.test', 'test'])).toEqual({
      decision: 'NONE'
    });
  });

  // ── isAppBlockedByPolicy with preNormalized ──────────────────────────
  it('isAppBlockedByPolicy uses preNormalized to skip re-normalisation', () => {
    // Pass a raw queryName with different casing, but also provide preNormalized
    const result = __testing.isAppBlockedByPolicy('SHOULD.BE.IGNORED', ['discord'] as any, 'cdn.discordapp.com');
    expect(result).toBe('discord');
  });

  it('isAppBlockedByPolicy returns null for empty apps list', () => {
    expect(__testing.isAppBlockedByPolicy('cdn.discordapp.com', [] as any)).toBeNull();
  });

  // ── isTailscaleClientIp ──────────────────────────────────────────────
  it('isTailscaleClientIp detects Tailscale IPv4 range', () => {
    expect(__testing.isTailscaleClientIp('100.64.0.1')).toEqual({ isTailscale: true, version: 'v4' });
    expect(__testing.isTailscaleClientIp('100.127.255.254')).toEqual({ isTailscale: true, version: 'v4' });
  });

  it('isTailscaleClientIp rejects non-Tailscale IPv4', () => {
    expect(__testing.isTailscaleClientIp('100.63.0.1')).toEqual({ isTailscale: false, version: null });
    expect(__testing.isTailscaleClientIp('100.128.0.1')).toEqual({ isTailscale: false, version: null });
    expect(__testing.isTailscaleClientIp('192.168.1.1')).toEqual({ isTailscale: false, version: null });
  });

  it('isTailscaleClientIp detects Tailscale IPv6 range', () => {
    expect(__testing.isTailscaleClientIp('fd7a:115c:a1e0::1')).toEqual({ isTailscale: true, version: 'v6' });
    expect(__testing.isTailscaleClientIp('fd7a:115c:a1e0:ab12::1')).toEqual({ isTailscale: true, version: 'v6' });
  });

  it('isTailscaleClientIp rejects non-Tailscale IPv6', () => {
    expect(__testing.isTailscaleClientIp('fd7a:115c:a1e1::1')).toEqual({ isTailscale: false, version: null });
    expect(__testing.isTailscaleClientIp('::1')).toEqual({ isTailscale: false, version: null });
  });

  // ── normalizeClientIp ────────────────────────────────────────────────
  it('normalizeClientIp strips IPv4-mapped IPv6 prefix', () => {
    expect(__testing.normalizeClientIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
  });

  it('normalizeClientIp strips zone id', () => {
    expect(__testing.normalizeClientIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('normalizeClientIp trims whitespace', () => {
    expect(__testing.normalizeClientIp('  192.168.1.1  ')).toBe('192.168.1.1');
  });

  it('normalizeClientIp returns 0.0.0.0 for empty input', () => {
    expect(__testing.normalizeClientIp('')).toBe('0.0.0.0');
    expect(__testing.normalizeClientIp(undefined as any)).toBe('0.0.0.0');
  });

  // ── extractMinTtl ────────────────────────────────────────────────────
  it('extractMinTtl returns minimum TTL from DNS response', () => {
    const resp = dnsPacket.encode({
      type: 'response',
      id: 1,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type: 'A', name: 'x.test' }],
      answers: [
        { type: 'A', name: 'x.test', ttl: 300, data: '1.2.3.4' },
        { type: 'A', name: 'x.test', ttl: 60, data: '5.6.7.8' },
        { type: 'A', name: 'x.test', ttl: 120, data: '9.10.11.12' }
      ]
    } as any);
    expect(__testing.extractMinTtl(Buffer.from(resp))).toBe(60);
  });

  it('extractMinTtl returns 0 for response with no answers', () => {
    const resp = dnsPacket.encode({
      type: 'response',
      id: 1,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{ type: 'A', name: 'x.test' }],
      answers: []
    } as any);
    expect(__testing.extractMinTtl(Buffer.from(resp))).toBe(0);
  });

  it('extractMinTtl returns 0 for malformed buffer', () => {
    expect(__testing.extractMinTtl(Buffer.from([0x00, 0x01]))).toBe(0);
  });

  // ── DNS response cache ──────────────────────────────────────────────
  describe('DNS response cache', () => {
    beforeEach(() => {
      __testing.dnsResponseCache.clear();
    });

    it('cacheSet + cacheGet round-trips a response', () => {
      const buf = Buffer.from('test-response');
      __testing.dnsResponseCacheSet('example.com|A', buf, 10_000);

      const result = __testing.dnsResponseCacheGet('example.com|A');
      expect(result).toEqual(buf);
    });

    it('cacheGet returns null for missing key', () => {
      expect(__testing.dnsResponseCacheGet('nonexistent|A')).toBeNull();
    });

    it('cacheGet returns null for expired entry', () => {
      const buf = Buffer.from('expired');
      // Set with -1 TTL so it's already expired
      __testing.dnsResponseCacheSet('expired|A', buf, -1);
      // The set function skips ttl <= 0, so entry should not exist
      expect(__testing.dnsResponseCacheGet('expired|A')).toBeNull();
    });

    it('cacheSet ignores zero or negative TTL', () => {
      const buf = Buffer.from('no-cache');
      __testing.dnsResponseCacheSet('zero|A', buf, 0);
      expect(__testing.dnsResponseCacheGet('zero|A')).toBeNull();
    });

    it('cache stores distinct keys independently', () => {
      const buf1 = Buffer.from('resp1');
      const buf2 = Buffer.from('resp2');
      __testing.dnsResponseCacheSet('a.com|A', buf1, 60_000);
      __testing.dnsResponseCacheSet('b.com|A', buf2, 60_000);

      expect(__testing.dnsResponseCacheGet('a.com|A')).toEqual(buf1);
      expect(__testing.dnsResponseCacheGet('b.com|A')).toEqual(buf2);
    });
  });
});
