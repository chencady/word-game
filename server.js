/* 零依赖静态服务器：npm run dev [-- --port 7100 --host 127.0.0.1] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argOf(name, dflt) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const START_PORT = parseInt(process.env.PORT || argOf('port', '7100'), 10);
const HOST = process.env.HOST || argOf('host', '127.0.0.1');
const ROOT = __dirname;
const MAX_RETRY = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

let port = START_PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < START_PORT + MAX_RETRY) {
    port++;
    server.listen(port, HOST);
  } else {
    console.error(`启动失败：端口 ${START_PORT}~${port} 均被占用或发生错误（${err.message}）`);
    process.exit(1);
  }
});
server.listen(port, HOST, () => {
  if (port !== START_PORT) console.log(`端口 ${START_PORT} 被占用，已自动切换到 ${port}`);
  console.log(`词根背单词 App 已启动: http://${HOST}:${port}/`);
});
