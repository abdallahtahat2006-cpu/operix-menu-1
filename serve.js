/* =========================================================================
   Optional local preview server — not part of the product.

       node serve.js      →  http://localhost:4321

   The system runs fine straight from the filesystem (file://), but a real
   HTTP origin is needed to open the table QR codes on a phone over wi-fi,
   and to see the guest menu, the floor console and the dashboard sync in
   separate browsers. No dependencies.
   ========================================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 4321;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/system.html';

    const file = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));

    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found: ' + rel);
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log('Operix Restaurant System → http://localhost:' + PORT);
});
