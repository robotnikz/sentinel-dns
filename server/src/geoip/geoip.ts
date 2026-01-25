import fs from 'node:fs';
import maxmind from 'maxmind';
import ipaddr from 'ipaddr.js';

import type { AppConfig } from '../config.js';

export type GeoCountry = {
  code: string; // ISO 3166-1 alpha-2, e.g. "DE"
  name: string;
  source: 'maxmind' | 'private' | 'unknown';
  lat?: number;
  lon?: number;
  city?: string;
  region?: string;
};

type CachedReader = {
  dbPath: string;
  mtimeMs: number;
  loadedAt: number;
  reader: maxmind.Reader<any>;
};

let cached: CachedReader | null = null;

function isPrivateIp(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    // ipaddr.js treats loopback/multicast/etc. as "range" as well.
    const range = addr.range();
    return (
      range === 'private' ||
      range === 'loopback' ||
      range === 'linkLocal' ||
      range === 'carrierGradeNat' ||
      range === 'uniqueLocal' ||
      range === 'unspecified'
    );
  } catch {
    return false;
  }
}

async function getReader(dbPath: string): Promise<maxmind.Reader<any> | null> {
  try {
    const stat = await fs.promises.stat(dbPath);
    const now = Date.now();

    if (
      cached &&
      cached.dbPath === dbPath &&
      cached.mtimeMs === stat.mtimeMs &&
      // avoid stat+reload storms
      now - cached.loadedAt < 60_000
    ) {
      return cached.reader;
    }

    const reader = await maxmind.open(dbPath);
    cached = { dbPath, mtimeMs: stat.mtimeMs, loadedAt: now, reader };
    return reader;
  } catch {
    return null;
  }
}

export async function lookupCountry(config: AppConfig, ip: string): Promise<GeoCountry> {
  const clientIp = String(ip ?? '').trim();
  if (!clientIp) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };

  if (isPrivateIp(clientIp)) {
    return { code: 'ZZ', name: 'Private Network', source: 'private' };
  }

  const dbPath = String((config as any).GEOIP_DB_PATH ?? '').trim();
  if (!dbPath) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };

  const reader = await getReader(dbPath);
  if (!reader) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };

  try {
    const res = reader.get(clientIp);
    const code = typeof res?.country?.iso_code === 'string' ? String(res.country.iso_code) : '';
    const name = typeof res?.country?.names?.en === 'string' ? String(res.country.names.en) : '';

    const lat = typeof res?.location?.latitude === 'number' ? res.location.latitude : undefined;
    const lon = typeof res?.location?.longitude === 'number' ? res.location.longitude : undefined;
    const city = typeof res?.city?.names?.en === 'string' ? String(res.city.names.en) : undefined;
    const region =
      typeof res?.subdivisions?.[0]?.names?.en === 'string'
        ? String(res.subdivisions[0].names.en)
        : typeof res?.subdivisions?.[0]?.iso_code === 'string'
          ? String(res.subdivisions[0].iso_code)
          : undefined;

    if (!code && !name) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
    return { code: code || 'ZZ', name: name || code || 'Unknown', source: 'maxmind', lat, lon, city, region };
  } catch {
    return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
  }
}

export async function getGeoIpStatus(config: AppConfig): Promise<{
  available: boolean;
  dbPath: string;
}> {
  const dbPath = String((config as any).GEOIP_DB_PATH ?? '').trim();
  if (!dbPath) return { available: false, dbPath: '' };
  try {
    await fs.promises.access(dbPath, fs.constants.R_OK);
    return { available: true, dbPath };
  } catch {
    return { available: false, dbPath };
  }
}

export async function getGeoIpEditionId(config: AppConfig): Promise<string> {
  const dbPath = String((config as any).GEOIP_DB_PATH ?? '').trim();
  if (!dbPath) return 'Unknown';

  const reader = await getReader(dbPath);
  if (!reader) return 'Unknown';

  const meta: any = (reader as any).metadata;
  const editionId =
    (typeof meta?.databaseType === 'string' && meta.databaseType) ||
    (typeof meta?.database_type === 'string' && meta.database_type) ||
    '';

  return editionId || 'Unknown';
}

export async function createGeoIpLookup(config: AppConfig): Promise<{
  status: { available: boolean; dbPath: string };
  lookup: (ip: string) => GeoCountry;
}> {
  const dbPath = String((config as any).GEOIP_DB_PATH ?? '').trim();
  if (!dbPath) {
    return {
      status: { available: false, dbPath: '' },
      lookup: (ip) => {
        const clientIp = String(ip ?? '').trim();
        if (!clientIp) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
        if (isPrivateIp(clientIp)) return { code: 'ZZ', name: 'Private Network', source: 'private' };
        return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
      }
    };
  }

  let reader: maxmind.Reader<any> | null = null;
  try {
    reader = await getReader(dbPath);
  } catch {
    reader = null;
  }

  if (!reader) {
    return {
      status: { available: false, dbPath },
      lookup: (ip) => {
        const clientIp = String(ip ?? '').trim();
        if (!clientIp) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
        if (isPrivateIp(clientIp)) return { code: 'ZZ', name: 'Private Network', source: 'private' };
        return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
      }
    };
  }

  return {
    status: { available: true, dbPath },
    lookup: (ip) => {
      const clientIp = String(ip ?? '').trim();
      if (!clientIp) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
      if (isPrivateIp(clientIp)) return { code: 'ZZ', name: 'Private Network', source: 'private' };
      try {
        const res = reader!.get(clientIp);
        const code = typeof res?.country?.iso_code === 'string' ? String(res.country.iso_code) : '';
        const name = typeof res?.country?.names?.en === 'string' ? String(res.country.names.en) : '';
        const lat = typeof res?.location?.latitude === 'number' ? res.location.latitude : undefined;
        const lon = typeof res?.location?.longitude === 'number' ? res.location.longitude : undefined;
        const city = typeof res?.city?.names?.en === 'string' ? String(res.city.names.en) : undefined;
        const region =
          typeof res?.subdivisions?.[0]?.names?.en === 'string'
            ? String(res.subdivisions[0].names.en)
            : typeof res?.subdivisions?.[0]?.iso_code === 'string'
              ? String(res.subdivisions[0].iso_code)
              : undefined;
        if (!code && !name) return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
        return { code: code || 'ZZ', name: name || code || 'Unknown', source: 'maxmind', lat, lon, city, region };
      } catch {
        return { code: 'ZZ', name: 'Unknown', source: 'unknown' };
      }
    }
  };
}
