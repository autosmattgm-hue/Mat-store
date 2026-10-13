const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');
const publicFiles = new Set();
let inSet = false;
for (const line of lines) {
  if (line.includes('const publicFiles = new Set')) { inSet = true; continue; }
  if (inSet) {
    const t = line.trim();
    if (t === ']);') break;
    if (t && !t.startsWith('//')) publicFiles.add(t);
  }
}
console.log('contains /manifest.webmanifest:', publicFiles.has('/manifest.webmanifest'));
console.log('contains /robots.txt:', publicFiles.has('/robots.txt'));
console.log('contains /dashboard.html:', publicFiles.has('/dashboard.html'));
console.log('size:', publicFiles.size);
