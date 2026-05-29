const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const vercelClientUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
const clientUrl = (process.env.CLIENT_URL || vercelClientUrl || 'http://localhost:3000').replace(/\/+$/, '');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  clientUrl,
  jwtSecret: process.env.JWT_SECRET || 'mat-store-dev-access-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'mat-store-dev-refresh-secret-change-me',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@matstore.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '11223344ADMIN',
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NVIDIA_MODEL || 'meta/llama-4-maverick-17b-128e-instruct',
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions'
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    apiBase: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'
  }
};

module.exports = config;
