const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const setLines = [];
let inSet = false;
for (let i = 0; i < src.split('\n').length; i++) {
  const line = src.split('\n')[i];
  if (line.includes('const publicFiles = new Set')) { inSet = true; }
  if (inSet) {
    const t = line.trim();
    if (t === ']);') break;
    if (t && !t.startsWith('//')) setLines.push(t);
  }
}
const setSrc = 'let publicFiles = new Set([' + setLines.join('\n') + ']);\nmodule.exports = publicFiles;';
const moduleObj = { exports: {} };
new Function('module', setSrc)(moduleObj);
const publicFiles = moduleObj.exports;
const testPaths = ['/', '/index.html', '/dashboard.html', '/website-studio.html', '/business-ai.html', '/login.html', '/pricing.html', '/unknown.html'];
for (const p of testPaths) {
  console.log(p + ' -> ' + publicFiles.has(p));
}
