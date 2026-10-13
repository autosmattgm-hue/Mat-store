const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = src.indexOf('function serveStatic');
console.log('serveStatic at char idx: ' + idx);
console.log('---- code from idx ----');
console.log(src.slice(idx, idx + 1400));
