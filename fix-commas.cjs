const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// Remove trailing commas in publicFiles set entries: lines matching /^\s+"[^"]+",\s*$/ -> /^\s+"[^"]+"\s*$/ 
const fixed = src.replace(/^(\s+"[^"]+"),$/gm, '$1');
fs.writeFileSync(process.argv[3], fixed, 'utf8');
console.log('Fixed. Lines changed check.');
