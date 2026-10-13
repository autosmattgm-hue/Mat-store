const http = require('http');
const options = { host: 'localhost', port: 3000, path: '/', headers: { 'Accept': 'text/html' } };
const req = http.get(options, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    console.log('STATUS: ' + res.statusCode);
    console.log('LEN: ' + data.length);
    console.log('HTML: ' + /^<!DOCTYPE html/i.test(data));
  });
});
req.on('error', (e) => {
  console.log('ERROR: ' + e.message);
});
req.end();
