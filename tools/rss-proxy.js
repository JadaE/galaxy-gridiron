// Dev-only CORS proxy so headless-Chrome screenshots can show YouTube RSS (browsers block cross-origin RSS). Not part of the app.
const http = require('http'), https = require('https');
http.createServer((req, res) => {
  const id = new URL(req.url, 'http://x').searchParams.get('channel_id');
  if (!/^UC[\w-]{22}$/.test(id || '')) { res.writeHead(400); return res.end(); }
  https.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
    res.writeHead(r.statusCode, { 'Content-Type': 'application/xml', 'Access-Control-Allow-Origin': '*' }); r.pipe(res);
  }).on('error', () => { res.writeHead(502); res.end(); });
}).listen(8090, '127.0.0.1');
