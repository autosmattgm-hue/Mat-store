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
const clientUrl = (envValue('CLIENT_URL', 'PUBLIC_SITE_URL', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL') || vercelClientUrl || 'https://mat-store-dun.vercel.app').replace(/\/+$/, '');
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
  firebase: {
    apiKey: envValue('FIREBASE_API_KEY') || 'AIzaSyCyX0lVUso_O1tdniqqqjw-72kjHZxXqd8',
    authDomain: envValue('FIREBASE_AUTH_DOMAIN') || 'mat-store-a8cb7.firebaseapp.com',
    projectId: envValue('FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT') || 'mat-store-a8cb7',
    storageBucket: envValue('FIREBASE_STORAGE_BUCKET') || 'mat-store-a8cb7.firebasestorage.app',
    messagingSenderId: envValue('FIREBASE_MESSAGING_SENDER_ID') || '641543429512',
    appId: envValue('FIREBASE_APP_ID') || '1:641543429512:web:a2ebd79d71304d4dab6e3d',
    measurementId: envValue('FIREBASE_MEASUREMENT_ID') || 'G-9WDH3M0PY9',
    clientEmail: envValue('FIREBASE_CLIENT_EMAIL'),
    privateKey: envValue('FIREBASE_PRIVATE_KEY'),
    collectionPrefix: envValue('FIREBASE_COLLECTION_PREFIX') || 'mat_store'
  },
  paypal: {
    clientId: envValue('PAYPAL_CLIENT_ID', 'PAYPAL_PUBLIC_CLIENT_ID', 'NEXT_PUBLIC_PAYPAL_CLIENT_ID', 'VITE_PAYPAL_CLIENT_ID'),
    clientSecret: envValue('PAYPAL_CLIENT_SECRET', 'PAYPAL_SECRET', 'PAYPAL_SECRET_KEY', 'PAYPAL_CLIENT_SECRET_KEY'),
    apiBase: paypalApiBase
  }
};

module.exports = config;
