const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
};

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Solicitud no válida'); return; }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Método no permitido'); return;
  }
  const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Acceso denegado'); return;
  }
  const relativeSegments = path.relative(root, filename).split(path.sep);
  if (relativeSegments.some(segment => segment.startsWith('.'))) { response.writeHead(404).end('No encontrado'); return; }
  fs.stat(filename, (statError, stat) => {
    if (statError || !stat.isFile()) { response.writeHead(404).end('No encontrado'); return; }
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
    });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(filename).pipe(response);
  });
}).listen(port, '0.0.0.0', () => console.log(`StudyHelp está disponible en el puerto ${port}`));

