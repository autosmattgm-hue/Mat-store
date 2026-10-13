const http = require('http');
const options = {
  host: 'localhost',
  port: 3000,
  path: '/',
  headers: { 'Accept': 'text/html' }
};
const req = http.get(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('STATUS: ' + res.statusCode);
    console.log('CONTENT-LENGTH: ' + res.headers['content-length']);
    console.log('HTML FIRST 120 BYTES: ' + data.slice(0, 120).replace(/\n/g, ' '));
    console.log('IS_HTML: ' + /^<!DOCTYPE html/i.test(data));
  });
});
req.on('error', (err) => {
  console.log('ERROR: ' + err.message);
});
req.end();
