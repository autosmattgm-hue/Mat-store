const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = src.indexOf('isPublic');
console.log('isPublic at char idx: ' + idx);
console.log('---- isPublic context ----');
console.log(src.slice(idx - 200, idx + 300));
