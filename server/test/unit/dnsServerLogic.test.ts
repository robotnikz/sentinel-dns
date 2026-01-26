import { describe, expect, it } from 'vitest';
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

  it('buildCandidateDomains builds suffix list', () => {
    expect(__testing.buildCandidateDomains('a.b.c')).toEqual(['a.b.c', 'b.c', 'c']);
    expect(__testing.buildCandidateDomains('')).toEqual([]);
  });

  it('decideRuleIndexed: manual ALLOW wins over blocklist/manual block', () => {
    const index = {
      manualAllowed: new Set(['example.com']),
      manualBlocked: new Set(['example.com']),
      blockedByDomain: new Map([['example.com', '1']])
    };

    const blocklistsById = new Map([
      ['1', { enabled: true, mode: 'ACTIVE', name: 'BL' }]
    ]);

    const selected = new Set(['1']);

    expect(__testing.decideRuleIndexed(index as any, 'example.com', blocklistsById as any, selected as any)).toEqual({
      decision: 'ALLOWED'
    });
  });

  it('decideRuleIndexed: returns BLOCKED for active selected blocklist', () => {
    const index = {
      manualAllowed: new Set(),
      manualBlocked: new Set(),
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
      manualAllowed: new Set(),
      manualBlocked: new Set(),
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
      manualAllowed: new Set(),
      manualBlocked: new Set(),
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
    expect(rewrites).toEqual([{ id: '1', domain: 'example.com', target: '1.2.3.4' }]);
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
});
