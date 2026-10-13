const http = require('http');
// Check multiple potential ports to find all servers
const ports = [3000, 3001, 3002, 3003];
for (const port of ports) {
  const options = { host: 'localhost', port, path: '/' };
  const req = http.get(options, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      console.log('port ' + port + ' -> ' + res.statusCode + ' | ' + d.slice(0, 60).replace(/\n/g, ' '));
    });
  });
  req.on('error', () => console.log('port ' + port + ' -> not listening'));
  req.end();
}
