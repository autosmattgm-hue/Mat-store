const http = require('http');
const paths = ['/css/style.css', '/js/app.js', '/assets/logo.svg', '/robots.txt', '/manifest.webmanifest'];
(async () => {
  for (const p of paths) {
    const options = { host: 'localhost', port: 3000, path: p };
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        console.log(p + ' -> ' + res.statusCode + ' | len=' + data.length + ' | type=' + res.headers['content-type']);
      });
    });
    req.on('error', (e) => console.log(p + ' -> ERROR ' + e.message));
    req.end();
  }
})();
