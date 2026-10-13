const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = 23739;
console.log('===== context around 23739 =====');
console.log(src.slice(idx - 200, idx + 300));
