const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = src.indexOf('publicFiles');
console.log('publicFiles index: ' + idx);
// print surrounding context
const chunk = src.slice(Math.max(0, idx - 800), Math.min(src.length, idx + 2600));
console.log('---- context ----');
console.log(chunk);
