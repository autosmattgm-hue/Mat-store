const fs = require('fs');
const path = require('path');
// Reproduce the serveStatic isPublic logic against the actual file
const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');
const publicFiles = new Set();
const publicFolders = ['/css/', '/js/', '/assets/', '/components/'];
let inSet = false;
for (const line of lines) {
  if (line.includes('const publicFiles = new Set')) { inSet = true; continue; }
  if (inSet) {
    const t = line.trim();
    if (t === ']);') break;
    if (t && !t.startsWith('//')) publicFiles.add(t);
  }
}
const testPaths = ['/', '/index.html', '/dashboard.html', '/website-studio.html', '/business-ai.html', '/login.html', '/pricing.html', '/unknown.html'];
console.log('publicFiles.has("/dashboard.html"):', publicFiles.has('/dashboard.html'));
console.log('publicFiles.size:', publicFiles.size);
console.log('--- isPublic check ---');
for (const p of testPaths) {
  const urlPathname = p;
  const requested = urlPathname === '/' ? '/index.html' : urlPathname;
  const isPublic = publicFiles.has(urlPathname) || publicFiles.has(requested) || publicFolders.some(f => requested.startsWith(f));
  console.log(p + ' -> isPublic=' + isPublic);
}
