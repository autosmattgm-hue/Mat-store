const http = require('http');
async function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: 3000, path }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
    req.end();
  });
}
async function main() {
  const pages = ['/dashboard.html', '/website-studio.html', '/business-ai.html', '/login.html', '/pricing.html'];
  for (const p of pages) {
    try {
      const r = await get(p);
      const bodyPreview = r.data.slice(0, 160).replace(/\n/g, ' ').replace(/\s+/g, ' ');
      console.log(p + ' -> ' + r.status + ' | ' + bodyPreview);
    } catch (e) {
      console.log(p + ' -> ERROR ' + e.message);
    }
  }
}
main();
