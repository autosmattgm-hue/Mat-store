import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import * as nativeApp from './api/nativeApp.js' with { type: 'module' };
// nativeApp.exports.handleRequest exists. But we just need to probe the HTTP server.
const http = require('http');
const options = {
  host: 'localhost',
  port: 3000,
  path: '/dashboard.html',
  headers: { 'Accept': 'text/html' }
};
const req = http.get(options, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    console.log('/dashboard.html -> ' + res.statusCode);
    console.log('body preview: ' + data.slice(0, 120).replace(/\n/g, ' '));
  });
});
req.on('error', (e) => console.log('/dashboard.html ERROR: ' + e.message));
req.end();
