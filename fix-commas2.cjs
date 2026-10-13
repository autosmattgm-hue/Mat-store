const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
// Remove trailing commas AND surrounding quotes from each entry line.
// Entry line like:   "/",  ->  "/"
// Pattern: optional whitespace, optional quote, then content, then quote + optional comma + optional whitespace, end of line.
const fixed = src.replace(/^(\s*)"([^"]*)",?\s*$/gm, (m, indent, content) => {
  return indent + content;
});
fs.writeFileSync(process.argv[3], fixed, 'utf8');
console.log('Fixed. Output written to ' + process.argv[3]);
