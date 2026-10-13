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
console.log('set size:', publicFiles.size);
for (const v of publicFiles) {
  console.log('  [' + JSON.stringify(v) + ']');
}
