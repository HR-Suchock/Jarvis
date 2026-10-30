'use strict';
// Minimal in-memory imitation of the Firebase Realtime Database REST + SSE API (enough for Jarvis' inbox protocol).
const http = require('http');

function start(port = 0) {
  const data = {};            // path -> {key: value}
  const streams = new Map();  // path -> Set(res)
  let seq = 0;
  const log = [];

  const send = (res, ev, o) => res.write('event: ' + ev + '\ndata: ' + JSON.stringify(o) + '\n\n');
  const split = (p) => {
    const parts = p.replace(/\.json$/, '').split('/').filter(Boolean);
    return parts;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = split(decodeURIComponent(url.pathname));
    log.push(req.method + ' ' + url.pathname);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
        const path = parts.join('/');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (!streams.has(path)) streams.set(path, new Set());
        streams.get(path).add(res);
        send(res, 'put', { path: '/', data: data[path] && Object.keys(data[path]).length ? data[path] : null });
        const ka = setInterval(() => res.write('event: keep-alive\ndata: null\n\n'), 20000);
        res.on('close', () => { clearInterval(ka); streams.get(path).delete(res); });
        return;
      }
      if (req.method === 'POST') {
        const path = parts.join('/'); const key = '-N' + String(++seq).padStart(6, '0');
        (data[path] = data[path] || {})[key] = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: key }));
        for (const s of streams.get(path) || []) send(s, 'put', { path: '/' + key, data: data[path][key] });
        return;
      }
      if (req.method === 'DELETE') {
        const key = parts.pop(); const path = parts.join('/');
        if (data[path]) delete data[path][key];
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('null');
        for (const s of streams.get(path) || []) send(s, 'put', { path: '/' + key, data: null });
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({
      url: 'http://127.0.0.1:' + server.address().port, data, log,
      close: () => { for (const set of streams.values()) for (const r of set) r.end(); server.closeAllConnections(); return new Promise((r) => server.close(r)); },
    });
  }));
}

if (require.main === module) start(Number(process.argv[2] || 9099)).then((s) => console.log('fake rtdb on', s.url));
module.exports = { start };
