const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const count = (src.match(/publicFiles/g) || []).length;
console.log('publicFiles occurrence count: ' + count);
// Find all indices
const indices = [];
let i = 0;
while ((i = src.indexOf('publicFiles', i)) !== -1) {
  indices.push(i);
  i += 'publicFiles'.length;
}
console.log('indices: ' + indices.join(', '));
// print the line containing the Set definition
const lines = src.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('publicFiles') && l.includes('new Set')) {
    console.log('--- line ' + (idx + 1) + ': ' + l.trim());
  }
});
