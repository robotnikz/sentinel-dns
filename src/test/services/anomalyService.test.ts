import { describe, expect, it } from 'vitest';
import { detectAnomalies } from '../../services/anomalyService';
import { QueryStatus, type DnsQuery } from '../../types';

function q(partial: Partial<DnsQuery>): DnsQuery {
  return {
    id: partial.id ?? `q-${Math.random().toString(16).slice(2)}`,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    domain: partial.domain ?? 'example.com',
    client: partial.client ?? 'Device',
    clientIp: partial.clientIp ?? '192.168.1.10',
    status: partial.status ?? QueryStatus.PERMITTED,
    type: partial.type ?? 'A',
    durationMs: partial.durationMs ?? 1
  };
}

describe('anomalyService.detectAnomalies', () => {
  it('flags permitted crypto-mining keywords', () => {
    const anomalies = detectAnomalies([
      q({ domain: 'minerpool.example.com', status: QueryStatus.PERMITTED, client: 'Laptop', clientIp: '192.168.1.2' })
    ]);

    expect(anomalies.some((a) => a.issue === 'Potential Crypto Mining')).toBe(true);
  });

  it('flags DGA-ish domains with long high-entropy labels', () => {
    const anomalies = detectAnomalies([
      q({ domain: 'a1b2c3d4e5f6g7h8i9j0.example.com', status: QueryStatus.PERMITTED, client: 'Laptop' })
    ]);

    expect(anomalies.some((a) => a.issue === 'Possible DGA / Malware Beaconing')).toBe(true);
  });

  it('flags high block-rate clients (aggregate anomaly)', () => {
    const queries = [
      q({ domain: 'ads.foo.com', status: QueryStatus.BLOCKED, client: 'TV', clientIp: '192.168.1.50' }),
      q({ domain: 'ads.bar.com', status: QueryStatus.BLOCKED, client: 'TV', clientIp: '192.168.1.50' }),
      q({ domain: 'news.example.com', status: QueryStatus.PERMITTED, client: 'TV', clientIp: '192.168.1.50' })
    ];

    const anomalies = detectAnomalies(queries);

    expect(anomalies.some((a) => a.issue === 'High Infection Risk (Block Rate)')).toBe(true);
  });

  it('respects the limit option', () => {
    const queries = [
      q({ domain: 'minerpool.example.com', status: QueryStatus.PERMITTED, client: 'Laptop' }),
      q({ domain: 'porn.example.com', status: QueryStatus.PERMITTED, client: 'Laptop' }),
      q({ domain: 'a1b2c3d4e5f6g7h8i9j0.example.com', status: QueryStatus.PERMITTED, client: 'Laptop' })
    ];

    const anomalies = detectAnomalies(queries, { limit: 1 });
    expect(anomalies.length).toBe(1);
  });
});
