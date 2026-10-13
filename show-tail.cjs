const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
console.log('total lines=' + lines.length);
console.log('last 5:');
for (let i = lines.length - 5; i < lines.length; i++) {
  console.log((i + 1) + '| ' + lines[i]);
}
