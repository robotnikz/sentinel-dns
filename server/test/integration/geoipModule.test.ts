import { describe, expect, it, vi } from 'vitest';

// Note: This lives under the integration config, but it's a pure unit-style test
// to improve coverage in `src/geoip/geoip.ts` deterministically (no Docker, no WAN).

describe('geoip module (deterministic)', () => {
  it('getGeoIpStatus returns available=false when GEOIP_DB_PATH missing', async () => {
    vi.resetModules();
    const mod = await import('../../src/geoip/geoip.js');
    const res = await mod.getGeoIpStatus({ GEOIP_DB_PATH: '' } as any);
    expect(res).toEqual({ available: false, dbPath: '' });
  });

  it('lookupCountry classifies private IPs without reading mmdb', async () => {
    vi.resetModules();
    const mod = await import('../../src/geoip/geoip.js');
    const res = await mod.lookupCountry({ GEOIP_DB_PATH: 'X.mmdb' } as any, '192.168.1.10');
    expect(res).toMatchObject({ source: 'private', code: 'ZZ' });
    expect(res.name).toContain('Private');
  });

  it('createGeoIpLookup uses maxmind reader and parses country/city fields', async () => {
    vi.resetModules();

    const open = vi.fn(async () => {
      return {
        get: (ip: string) => {
          if (ip === '8.8.8.8') {
            return {
              country: { iso_code: 'US', names: { en: 'United States' } },
              location: { latitude: 37.0, longitude: -122.0 },
              city: { names: { en: 'Mountain View' } },
              subdivisions: [{ names: { en: 'California' }, iso_code: 'CA' }]
            };
          }
          return null;
        },
        metadata: { databaseType: 'GeoLite2-City' }
      };
    });

    vi.doMock('maxmind', () => ({ default: { open } }));
    vi.doMock('node:fs', () => {
      const actual: any = vi.importActual('node:fs');
      return {
        ...actual,
        default: {
          ...((actual as any).default ?? actual),
          promises: {
            stat: async () => ({ mtimeMs: 123 }),
            access: async () => {}
          },
          constants: { R_OK: 4 }
        },
        promises: {
          stat: async () => ({ mtimeMs: 123 }),
          access: async () => {}
        },
        constants: { R_OK: 4 }
      };
    });

    const mod = await import('../../src/geoip/geoip.js');

    const lookup = await mod.createGeoIpLookup({ GEOIP_DB_PATH: '/tmp/fake.mmdb' } as any);
    expect(lookup.status).toMatchObject({ available: true, dbPath: '/tmp/fake.mmdb' });

    const res = lookup.lookup('8.8.8.8');
    expect(res).toMatchObject({ source: 'maxmind', code: 'US', name: 'United States' });
    expect(res.lat).toBe(37.0);
    expect(res.lon).toBe(-122.0);
    expect(res.city).toBe('Mountain View');
    expect(res.region).toBe('California');

    const edition = await mod.getGeoIpEditionId({ GEOIP_DB_PATH: '/tmp/fake.mmdb' } as any);
    expect(edition).toBe('GeoLite2-City');
  });

  it('createGeoIpLookup reuses cached reader when mtime unchanged (no reload storm)', async () => {
    vi.resetModules();

    const open = vi.fn(async () => {
      return {
        get: () => ({ country: { iso_code: 'DE', names: { en: 'Germany' } } }),
        metadata: { databaseType: 'GeoLite2-Country' }
      };
    });

    vi.doMock('maxmind', () => ({ default: { open } }));
    vi.doMock('node:fs', () => {
      const actual: any = vi.importActual('node:fs');
      return {
        ...actual,
        default: {
          ...((actual as any).default ?? actual),
          promises: {
            stat: async () => ({ mtimeMs: 999 }),
            access: async () => {}
          },
          constants: { R_OK: 4 }
        },
        promises: {
          stat: async () => ({ mtimeMs: 999 }),
          access: async () => {}
        },
        constants: { R_OK: 4 }
      };
    });

    const mod = await import('../../src/geoip/geoip.js');

    const config = { GEOIP_DB_PATH: '/tmp/cache.mmdb' } as any;
    const l1 = await mod.createGeoIpLookup(config);
    const l2 = await mod.createGeoIpLookup(config);

    expect(l1.lookup('1.2.3.4')).toMatchObject({ source: 'maxmind', code: 'DE' });
    expect(l2.lookup('1.2.3.4')).toMatchObject({ source: 'maxmind', code: 'DE' });

    // should be opened only once due to module-level cache
    expect(open).toHaveBeenCalledTimes(1);
  });
});
