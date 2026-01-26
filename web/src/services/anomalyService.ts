import { DnsQuery, QueryStatus, Anomaly } from '../types';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const baseDomain = (domain: string) => {
  const d = String(domain || '').toLowerCase().trim();
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 2) return d;
  return parts.slice(-2).join('.');
};

const shannonEntropy = (s: string) => {
  const str = String(s || '').toLowerCase();
  if (!str) return 0;
  const counts: Record<string, number> = {};
  for (const ch of str) counts[ch] = (counts[ch] || 0) + 1;
  const n = str.length;
  let ent = 0;
  for (const k of Object.keys(counts)) {
    const p = counts[k] / n;
    ent -= p * Math.log2(p);
  }
  return ent;
};

const looksLikeDga = (domain: string) => {
  const d = String(domain || '').toLowerCase();
  const label = d.split('.')[0] || '';
  if (label.length < 12) return { score: 0, reason: '' };
  const ent = shannonEntropy(label);
  const digitCount = (label.match(/[0-9]/g) || []).length;
  const hyphenCount = (label.match(/-/g) || []).length;
  const digitRatio = digitCount / Math.max(1, label.length);
  const hyphenRatio = hyphenCount / Math.max(1, label.length);

  // Heuristic: high entropy + lots of digits tends to be DGA-ish.
  const entScore = clamp01((ent - 3.2) / 1.0);
  const digitScore = clamp01((digitRatio - 0.15) / 0.35);
  const lenScore = clamp01((label.length - 12) / 18);
  const score = clamp01(entScore * 0.55 + digitScore * 0.3 + lenScore * 0.15);
  if (score < 0.6) return { score, reason: '' };

  const reason = `High-entropy label (H=${ent.toFixed(2)}) with ${Math.round(digitRatio * 100)}% digits`;
  return { score, reason };
};

const keywordHits = (domain: string, keywords: string[]) => {
  const d = String(domain || '').toLowerCase();
  return keywords.filter((k) => d.includes(k));
};

const topN = (items: Record<string, number>, n: number) => {
  return Object.entries(items)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([domain, count]) => ({ domain, count }));
};

// Logic definitions for what constitutes an anomaly
export const detectAnomalies = (queries: DnsQuery[], opts?: { limit?: number }): Anomaly[] => {
    const anomalies: Anomaly[] = [];
    const clientStats: Record<string, { total: number; blocked: number; name: string; ip: string; blockedDomains: Record<string, number> }> = {};

    const nowIso = new Date().toISOString();
    const pornKeywords = ['porn', 'xxx', 'sex', 'adult', 'escort', 'cam', 'hentai'];
    const gamblingKeywords = ['casino', 'bet', 'poker', 'slots', 'gamble'];
    const cryptoKeywords = ['pool', 'miner', 'mining', 'hash', 'wallet', 'crypto'];
    const tunnelingKeywords = ['dns-tunnel', 'dnscat', 'iodine'];

    // 1. First Pass: Analyze individual queries and aggregate stats
    queries.forEach(q => {
        // Build stats per client
        if (!clientStats[q.clientIp]) {
            clientStats[q.clientIp] = { total: 0, blocked: 0, name: q.client, ip: q.clientIp, blockedDomains: {} };
        }
        clientStats[q.clientIp].total++;
        if (q.status === QueryStatus.BLOCKED) {
            clientStats[q.clientIp].blocked++;
            const d = baseDomain(q.domain);
            if (d) clientStats[q.clientIp].blockedDomains[d] = (clientStats[q.clientIp].blockedDomains[d] || 0) + 1;
        }

        const domain = String(q.domain || '').toLowerCase();
        if (!domain) return;

        // Malware-ish keyword pattern (useful when it gets through as PERMITTED).
        const cryptoHit = keywordHits(domain, cryptoKeywords);
        if (cryptoHit.length > 0 && (q.status === QueryStatus.PERMITTED || q.status === QueryStatus.CACHED)) {
            anomalies.push({
                id: Date.now() + anomalies.length,
                device: q.client,
                clientIp: q.clientIp,
                issue: 'Potential Crypto Mining',
                detail: `Suspicious crypto-mining keyword (${cryptoHit[0]}) seen in: ${domain}`,
                domain: baseDomain(domain),
                reasons: ['Keyword match', `Status: ${q.status}`],
                confidence: 0.75,
                risk: 'critical',
                timestamp: q.timestamp || nowIso
            });
        }

        // Parental control / policy: adult + gambling keywords that are currently permitted.
        const adultHit = keywordHits(domain, pornKeywords);
        const gambleHit = keywordHits(domain, gamblingKeywords);
        const policyHit = adultHit.length > 0 ? { cat: 'Adult content', hit: adultHit[0] } : gambleHit.length > 0 ? { cat: 'Gambling', hit: gambleHit[0] } : null;
        if (policyHit && (q.status === QueryStatus.PERMITTED || q.status === QueryStatus.CACHED)) {
            anomalies.push({
                id: Date.now() + anomalies.length,
                device: q.client,
                clientIp: q.clientIp,
                issue: `Policy Risk: ${policyHit.cat}`,
                detail: `Permitted domain matched policy keyword (${policyHit.hit}): ${domain}`,
                domain: baseDomain(domain),
                reasons: ['Keyword match', 'Permitted traffic'],
                confidence: 0.65,
                risk: 'high',
                timestamp: q.timestamp || nowIso
            });
        }

        // DGA-ish domains (regardless of status; blocked may still indicate infection).
        const dga = looksLikeDga(domain);
        if (dga.reason) {
            anomalies.push({
                id: Date.now() + anomalies.length,
                device: q.client,
                clientIp: q.clientIp,
                issue: 'Possible DGA / Malware Beaconing',
                detail: `Domain looks algorithmically generated: ${domain}`,
                domain: baseDomain(domain),
                reasons: [dga.reason],
                confidence: clamp01(0.55 + dga.score * 0.45),
                risk: q.status === QueryStatus.BLOCKED ? 'medium' : 'high',
                timestamp: q.timestamp || nowIso
            });
        }

        // Simple tunneling hints (very long first label, often TXT; we only have q.type).
        const firstLabel = domain.split('.')[0] || '';
        if (firstLabel.length >= 40 || (q.type && String(q.type).toUpperCase() === 'TXT')) {
            const tHit = keywordHits(domain, tunnelingKeywords);
            const longLabel = firstLabel.length >= 40;
            if (longLabel || tHit.length > 0) {
                anomalies.push({
                    id: Date.now() + anomalies.length,
                    device: q.client,
                    clientIp: q.clientIp,
                    issue: 'Possible DNS Tunneling',
                    detail: `Unusual DNS pattern (${longLabel ? 'very long subdomain' : 'keyword'}): ${domain}`,
                    domain: baseDomain(domain),
                    reasons: [longLabel ? `Very long subdomain (${firstLabel.length} chars)` : `Keyword match (${tHit[0]})`],
                    confidence: longLabel ? 0.6 : 0.7,
                    risk: 'high',
                    timestamp: q.timestamp || nowIso
                });
            }
        }
    });

    // 2. Second Pass: Analyze aggregates
    Object.entries(clientStats).forEach(([ip, stats]) => {
        // Rule: Excessive Block Rate (>30%)
        // We need a minimum sample size to avoid false positives on 1/2 requests
        if (stats.total > 2 && (stats.blocked / stats.total) > 0.3) {
            const blockRate = Math.round((stats.blocked / stats.total) * 100);
            anomalies.push({
                id: Date.now() + anomalies.length,
                device: stats.name,
                clientIp: stats.ip,
                issue: 'High Infection Risk (Block Rate)',
                detail: `Device has ${blockRate}% blocked queries (possible adware/malware or aggressive tracking).`,
                reasons: ['High blocked/total ratio', `Blocked: ${stats.blocked}/${stats.total}`],
                relatedDomains: topN(stats.blockedDomains, 3),
                confidence: clamp01((blockRate - 30) / 50),
                risk: 'medium',
                timestamp: nowIso
            });
        }
    });

    // Return unique anomalies (simplified dedupe by issue+device)
    const unique = anomalies.filter((a, index, self) =>
        index === self.findIndex((t) => (
            t.device === a.device && t.issue === a.issue
        ))
    );

    const limit = typeof opts?.limit === 'number' ? opts.limit : 5;
    if (!Number.isFinite(limit) || limit <= 0) return unique;
    return unique.slice(0, limit);
};

export const sendNotification = async (anomaly: Anomaly) => {
    const storedWebhook = localStorage.getItem('sentinel_discord_webhook');
    
    if (!storedWebhook) {
        console.warn('Notification skipped: No Discord Webhook configured.');
        return;
    }

    const payload = {
        username: "Sentinel DNS",
        avatar_url: "https://i.imgur.com/4M34hi2.png",
        embeds: [
            {
                title: `⚠️ ${anomaly.issue} Detected`,
                color: anomaly.risk === 'critical' ? 15158332 : 15105570,
                fields: [
                    { name: "Device", value: anomaly.device, inline: true },
                    { name: "Risk Level", value: anomaly.risk.toUpperCase(), inline: true },
                    { name: "Details", value: anomaly.detail }
                ],
                footer: { text: "Sentinel Network Guardian" },
                timestamp: new Date().toISOString()
            }
        ]
    };

    try {
        // In a real browser environment without a proxy, this might hit CORS.
        // For this demo, we assume the environment allows it or we log the attempt.
        console.log("Dispatching Webhook:", JSON.stringify(payload, null, 2));
        
        // Uncomment to actually fire if CORS is handled:
        // await fetch(storedWebhook, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    } catch (e) {
        console.error("Failed to send notification", e);
    }
};