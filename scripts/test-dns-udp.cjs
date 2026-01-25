// UDP DNS wire-format smoke test.
// Usage:
//   node scripts/test-dns-udp.cjs <host> <port> <name> [A|AAAA|...]

const dgram = require('node:dgram');
const dnsPacket = require('../server/node_modules/dns-packet');

const host = process.argv[2] || '127.0.0.1';
const port = Number(process.argv[3] || '53');
const name = process.argv[4] || 'example.com';
const qtype = process.argv[5] || 'A';

if (!Number.isFinite(port) || port <= 0) {
  console.error('Invalid port:', process.argv[3]);
  process.exit(2);
}

const msg = dnsPacket.encode({
  type: 'query',
  id: 1,
  flags: dnsPacket.RECURSION_DESIRED,
  questions: [{ type: qtype, name }]
});

const socket = dgram.createSocket('udp4');

const timer = setTimeout(() => {
  console.error('TIMEOUT');
  try { socket.close(); } catch {}
  process.exit(1);
}, 4000);

socket.once('message', (data) => {
  clearTimeout(timer);
  try { socket.close(); } catch {}

  const dec = dnsPacket.decode(data);
  console.log('rcode', dec.rcode);
  console.log('answers', (dec.answers || []).slice(0, 10));
});

socket.send(msg, port, host);
