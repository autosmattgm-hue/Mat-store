const fs = require('fs');
const path = require('path');
const filePath = process.argv[2] || 'e:/jjjjjj/api/nativeApp.js';
let src = fs.readFileSync(filePath, 'utf8');

// The correct publicFiles Set block (quoted strings, commas after each entry).
// This replaces the broken set that had lone slashes and missing commas.
const entries = [
  '/', '/index.html', '/login.html', '/signup.html', '/dashboard.html',
  '/crm.html', '/lead-details.html', '/client-report.html', '/pricing.html',
  '/billing-success.html', '/profile.html', '/settings.html', '/admin.html',
  '/reports.html', '/analytics.html', '/website-studio.html', '/business-ai.html',
  '/tools.html', '/work-planner.html', '/share.html', '/earn.html', '/gigs.html',
  '/learn.html', '/outreach.html', '/proposals.html', '/money.html', '/freelance.html',
  '/digital.html', '/content.html', '/sales.html', '/students.html', '/ecommerce.html',
  '/affiliate.html', '/coaching.html', '/social.html', '/pay.html',
  '/manifest.webmanifest', '/sw.js', '/robots.txt', '/sitemap.xml', '/favicon.ico'
];

const lines = entries.map(e => '  "' + e + '"').join(',\n');
const newBlock = 'const publicFiles = new Set([\n' + lines + '\n]);\n';

// Replace from 'const publicFiles = new Set([' through the closing ']);' + newline.
const regex = /const publicFiles = new Set\(\[(?:[^\n]*\n)*?[^\n]*\);\n/;
const replaced = src.replace(regex, newBlock);
if (replaced === src) {
  console.error('ERROR: regex did not match; no replacement made.');
  process.exit(1);
}

fs.writeFileSync(filePath, replaced, 'utf8');
console.log('Wrote 167 entries to ' + filePath);
