import http from 'node:http';
import net from 'node:net';
import {lookup} from 'node:dns/promises';

const result = {probe: '__NONCE__', done: false, dns: false, tcp: false};
http.createServer((req, res) => {
  res.writeHead(503, {'content-type': 'application/json', 'cache-control': 'no-store'});
  res.end(JSON.stringify(req.url === '/api/health' ? result : {status: 'maintenance'}));
}).listen(Number(process.env.PORT || 8080), '0.0.0.0');
// A bounded test in the application worker, without using database credentials.
try {
  const host = process.env.PGHOST;
  if (!host) throw new Error('PGHOST_MISSING');
  let timer;
  try {
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000);}),
    ]);
    result.dns = true;
  } finally {clearTimeout(timer);}
  await new Promise(resolve => {
    const socket = net.createConnection({host, port: 5432});
    let finished = false;
    const finish = code => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      result.tcp = code === 'CONNECTED';
      result.code = code;
      socket.destroy();
      resolve();
    };
    const deadline = setTimeout(() => finish('TCP_TIMEOUT'), 10000);
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', error => finish(error.code || 'TCP_FAILED'));
  });
} catch (error) {result.code = error.code || 'DNS_OR_CONFIG_FAILED';}
result.done = true;
