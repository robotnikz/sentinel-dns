import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { createGeoIpLookup } from '../geoip/geoip.js';

type GeoCountriesQuerystring = {
  hours?: string;
  limit?: string;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

type CountryAgg = {
  countryCode: string;
  countryName: string;
  count: number;
  blocked: number;
  topDomains: Map<string, number>;
};

type GeoPointAgg = {
  lat: number;
  lon: number;
  count: number;
  blocked: number;
  permitted: number;
  labels: Map<string, number>;
  topPermittedDomains: Map<string, number>;
  topBlockedDomains: Map<string, number>;
};

function bump(map: Map<string, number>, key: string): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN(map: Map<string, number>, n: number): Array<{ domain: string; count: number }> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain, count]) => ({ domain, count }));
}

function pickDestinationIp(entry: any): string {
  const ips = Array.isArray(entry?.answerIps) ? entry.answerIps : [];
  for (const ip of ips) {
    if (typeof ip === 'string' && ip.trim()) return ip.trim();
  }
  return '';
}

export async function registerGeoRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/geo/countries',
    async (request: FastifyRequest<{ Querystring: GeoCountriesQuerystring }>) => {
      await requireAdmin(db, request);

      const hours = clampInt(request.query.hours, 24, 1, 168);
      const limit = clampInt(request.query.limit, 20, 1, 200);

      // Bound input to keep this endpoint cheap.
      const maxLogs = 50_000;

      const res = await db.pool.query(
        `SELECT entry
         FROM query_logs
         WHERE ts >= NOW() - ($1::text || ' hours')::interval
         ORDER BY ts DESC, id DESC
         LIMIT $2`,
        [String(hours), maxLogs]
      );

      const geoip = await createGeoIpLookup(config);

      const byCountry = new Map<string, CountryAgg>();
      const byPoint = new Map<string, GeoPointAgg>();

      for (const row of res.rows) {
        const entry: any = row?.entry;
        if (!entry || typeof entry !== 'object') continue;

        const domain = typeof entry.domain === 'string' ? entry.domain : '';
        const status = typeof entry.status === 'string' ? entry.status : '';

        const destIp = pickDestinationIp(entry);
        const isBlocked = status === 'BLOCKED' || status === 'SHADOW_BLOCKED';

        // World map is for outbound destinations, so we geolocate the resolved answer IP.
        // If there are no answers (blocked/NXDOMAIN/etc), show that explicitly instead of “Unknown”.
        let countryCode = 'ZZ';
        let countryName = '';

        if (!destIp) {
          const qtype = typeof entry.type === 'string' ? String(entry.type) : '';
          if (isBlocked) {
            countryName = 'Blocked (no IP answers)';
          } else if (qtype && qtype !== 'A' && qtype !== 'AAAA' && qtype !== 'ANY') {
            // Many successful DNS lookups (TXT/HTTPS/SVCB/SRV/CNAME-only/etc.) still contain no IPs.
            // World map is strictly “where the resolved IPs are”, so these are intentionally excluded.
            countryName = 'No IP answers (non-A/AAAA)';
          } else {
            countryName = 'No IP answers';
          }
        } else {
          const geo = geoip.lookup(destIp);

          // If GeoIP provides coordinates (City DB), aggregate point markers.
          if (
            geo.source === 'maxmind' &&
            typeof geo.lat === 'number' &&
            Number.isFinite(geo.lat) &&
            typeof geo.lon === 'number' &&
            Number.isFinite(geo.lon)
          ) {
            // Reduce noise by bucketing points to ~0.1° (~11km).
            const lat = Math.round(geo.lat * 10) / 10;
            const lon = Math.round(geo.lon * 10) / 10;
            const key = `${lat}|${lon}`;

            const existing = byPoint.get(key);
            const label = (() => {
              if (!geo.city) return '';
              const cc = geo.code && geo.code !== 'ZZ' ? geo.code : '';
              const region = geo.region ? String(geo.region).trim() : '';
              const base = region && region.toLowerCase() !== geo.city.toLowerCase() ? `${geo.city}, ${region}` : geo.city;
              return cc ? `${base} (${cc})` : base;
            })();
            if (existing) {
              existing.count += 1;
              if (isBlocked) existing.blocked += 1;
              else existing.permitted += 1;

              if (label) existing.labels.set(label, (existing.labels.get(label) ?? 0) + 1);

              if (domain) {
                if (isBlocked) bump(existing.topBlockedDomains, domain);
                else bump(existing.topPermittedDomains, domain);
              }
            } else {
              byPoint.set(key, {
                lat,
                lon,
                count: 1,
                blocked: isBlocked ? 1 : 0,
                permitted: isBlocked ? 0 : 1,
                labels: label ? new Map([[label, 1]]) : new Map()
                ,
                topPermittedDomains: !isBlocked && domain ? new Map([[domain, 1]]) : new Map(),
                topBlockedDomains: isBlocked && domain ? new Map([[domain, 1]]) : new Map()
              });
            }
          }

          // When GeoIP DB is missing, we can still classify private/reserved IPs, but everything else
          // would show up as “Unknown” — make that cause visible.
          if (!geoip.status.available && geo.source !== 'private') {
            countryCode = 'ZZ';
            countryName = 'GeoIP not configured';
          } else {
            countryCode = geo.code || 'ZZ';
            if (geo.source === 'unknown') {
              countryName = 'Unmapped IP';
            } else {
              countryName = geo.name || 'Unknown';
            }
          }
        }

        const key = `${countryCode}|${countryName}`;
        let agg = byCountry.get(key);
        if (!agg) {
          agg = {
            countryCode,
            countryName,
            count: 0,
            blocked: 0,
            topDomains: new Map<string, number>()
          };
          byCountry.set(key, agg);
        }

        agg.count += 1;
        if (isBlocked) agg.blocked += 1;

        if (domain) {
          agg.topDomains.set(domain, (agg.topDomains.get(domain) ?? 0) + 1);
        }
      }

      const items = Array.from(byCountry.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map((c) => {
          const topDomains = Array.from(c.topDomains.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([domain, count]) => ({ domain, count }));

          return {
            countryCode: c.countryCode,
            countryName: c.countryName,
            count: c.count,
            blocked: c.blocked,
            topDomains
          };
        });

      return {
        windowHours: hours,
        geoip: geoip.status,
        items,
        // If GEOIP_DB_PATH points to a City DB (e.g. GeoLite2-City), we also include point markers.
        points: Array.from(byPoint.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 500)
          .map((p) => {
            const label = Array.from(p.labels.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            return {
              lat: p.lat,
              lon: p.lon,
              count: p.count,
              blocked: p.blocked,
              permitted: p.permitted,
              label,
              topPermittedDomains: topN(p.topPermittedDomains, 3),
              topBlockedDomains: topN(p.topBlockedDomains, 3)
            };
          })
      };
    }
  );
}
