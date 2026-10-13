const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
let inSet = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('const publicFiles = new Set')) { inSet = true; }
  if (inSet) {
    // Show raw line with visible special chars
    const visible = line.replace(/["\\]/g, c => ({ '"': '\\"', '\\': '\\\\' }[c]));
    if (line.trim() === ']);') {
      console.log('line ' + (i + 1) + ': [END_OF_SET]');
      break;
    }
    if (line.trim() && !line.trim().startsWith('//')) {
      console.log('line ' + (i + 1) + ': ' + visible);
    }
  }
}
