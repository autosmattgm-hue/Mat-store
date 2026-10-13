const http = require('http');
function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: 'localhost', port: 3000, path }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
    req.end();
  });
}
async function main() {
  const pages = ['/', '/index.html', '/dashboard.html', '/website-studio.html', '/business-ai.html'];
  for (const p of pages) {
    try {
      const r = await get(p);
      console.log(p + ' -> ' + r.status + ' | len=' + r.data.length + ' | html=' + /^<!DOCTYPE html/i.test(r.data));
    } catch (e) {
      console.log(p + ' -> ERROR ' + e.message);
    }
  }
  console.log('--- /api/ai/status check ---');
  try {
    const r = await get('/api/health');
    console.log('/api/health -> ' + r.status + ' ' + r.data.slice(0, 200));
  } catch (e) {
    console.log('/api/health -> ERROR ' + e.message);
  }
}
main();
