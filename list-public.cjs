const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split('\n');
let inSet = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const publicFiles = new Set')) { inSet = true; }
  if (inSet) {
    const t = lines[i].trim();
    if (t === ']);') { break; }
    if (t && !t.startsWith('//')) {
      console.log('line ' + (i + 1) + ': ' + t);
    }
  }
}
