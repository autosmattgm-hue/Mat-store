const http = require('http');
const paths = [
  '/dashboard.html',
  '/website-studio.html',
  '/business-ai.html',
  '/login.html',
  '/pricing.html',
  '/unknown.html'
];
(async () => {
  for (const p of paths) {
    const options = { host: 'localhost', port: 3000, path: p, headers: { 'Accept': 'text/html' } };
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        console.log(p + ' -> ' + res.statusCode + ' | len=' + data.length + ' | ' + data.slice(0, 80).replace(/\n/g, ' '));
      });
    });
    req.on('error', (e) => console.log(p + ' -> ERROR ' + e.message));
    req.end();
  }
})();
