// Quick DoH wire-format smoke test.
// Usage: node scripts/test-doh.cjs https://dns.google/dns-query example.com A

const dnsPacket = require('../server/node_modules/dns-packet');

const dohUrl = process.argv[2];
const name = process.argv[3] || 'example.com';
const qtype = process.argv[4] || 'A';

if (!dohUrl) {
  console.error('Usage: node scripts/test-doh.cjs <dohUrl> [name] [A|AAAA|...].');
  process.exit(2);
}

const msg = dnsPacket.encode({
  type: 'query',
  id: 1,
  flags: dnsPacket.RECURSION_DESIRED,
  questions: [{ type: qtype, name }]
});

(async () => {
  const res = await fetch(dohUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/dns-message',
      accept: 'application/dns-message',
      'user-agent': 'sentinel-dns-test/0.1'
    },
    body: msg
  });

  console.log('HTTP', res.status);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.log('Body (text):', t.slice(0, 200));
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const dec = dnsPacket.decode(buf);

  console.log('rcode', dec.rcode);
  console.log('answers', (dec.answers || []).slice(0, 10));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});