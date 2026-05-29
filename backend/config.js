const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const env = process.env.NODE_ENV || 'development';
const vercelClientUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
const clientUrl = (envValue('CLIENT_URL', 'PUBLIC_SITE_URL', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL') || vercelClientUrl || 'http://localhost:3000').replace(/\/+$/, '');
const paypalMode = envValue('PAYPAL_MODE', 'PAYPAL_ENV').toLowerCase();
const paypalApiBase =
  envValue('PAYPAL_API_BASE') ||
  (paypalMode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : paypalMode === 'live' || env === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com');

const config = {
  env,
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
    clientId: envValue('PAYPAL_CLIENT_ID', 'PAYPAL_PUBLIC_CLIENT_ID', 'NEXT_PUBLIC_PAYPAL_CLIENT_ID', 'VITE_PAYPAL_CLIENT_ID'),
    clientSecret: envValue('PAYPAL_CLIENT_SECRET', 'PAYPAL_SECRET', 'PAYPAL_SECRET_KEY', 'PAYPAL_CLIENT_SECRET_KEY'),
    apiBase: paypalApiBase
  }
};

module.exports = config;
