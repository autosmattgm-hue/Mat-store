const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const idx = src.indexOf('function serveStatic');
if (idx === -1) {
  console.log('serveStatic not found');
  // try variant
  const idx2 = src.indexOf('serveStatic');
  console.log('serveStatic index: ' + idx2);
  return;
}
const chunk = src.slice(idx, idx + 1600);
console.log('---- serveStatic ----');
console.log(chunk);
