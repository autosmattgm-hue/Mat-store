const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = src.lastIndexOf('handleRequest');
console.log('handleRequest index: ' + idx);
const chunk = src.slice(Math.max(0, idx - 400), Math.min(src.length, idx + 3000));
console.log('---- context ----');
console.log(chunk);
