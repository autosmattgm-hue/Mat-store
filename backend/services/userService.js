const { randomUUID, randomBytes, createHash } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('../database/jsonStore');
const config = require('../config');
const { sanitizeEmail, sanitizeString } = require('../utils/sanitize');
const currencyService = require('./currencyService');
const HttpError = require('../utils/httpError');

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, refreshTokens, resetTokens, ...safeUser } = user;
  return safeUser;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email
    },
    config.jwtSecret,
    { expiresIn: '15m' }
  );
}

function createRefreshToken() {
  return `${randomUUID()}.${randomBytes(32).toString('hex')}`;
}

async function findById(id) {
  const users = await store.read('users');
  return users.find((user) => user.id === id) || null;
}

async function findByEmail(email) {
  const users = await store.read('users');
  return users.find((user) => user.email === sanitizeEmail(email)) || null;
}

async function ensureAdminUser() {
  const email = sanitizeEmail(config.adminEmail);
  const existing = await findByEmail(email);
  if (existing) return publicUser(existing);

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  const admin = {
    id: randomUUID(),
    name: 'MAT STORE Admin',
    email,
    passwordHash,
    role: 'admin',
    country: 'US',
    currency: 'USD',
    addresses: [],
    wishlist: [],
    preferences: {
      theme: 'dark',
      marketingOptIn: true
    },
    refreshTokens: [],
    resetTokens: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null
  };

  await store.update('users', (users) => [admin, ...users]);
  return publicUser(admin);
}

async function register(payload) {
  const email = sanitizeEmail(payload.email);
  const name = sanitizeString(payload.name, 120);
  const password = String(payload.password || '');
  const country = sanitizeString(payload.country || 'US', 2).toUpperCase();
  const currency = sanitizeString(payload.currency || currencyService.detectCurrency(country), 6).toUpperCase();

  if (!name || !email || !password) throw new HttpError(400, 'Name, email, and password are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (!currencyService.supportedCurrencies().includes(currency)) throw new HttpError(400, 'Currency is not supported.');
  if (await findByEmail(email)) throw new HttpError(409, 'An account with this email already exists.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = {
    id: randomUUID(),
    name,
    email,
    passwordHash,
    role: 'user',
    country,
    currency,
    addresses: [],
    wishlist: [],
    preferences: {
      theme: 'dark',
      marketingOptIn: Boolean(payload.marketingOptIn)
    },
    refreshTokens: [],
    resetTokens: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null
  };

  await store.update('users', (users) => [user, ...users]);
  return createSession(user, payload.userAgent, payload.ip);
}

async function login(payload) {
  const email = sanitizeEmail(payload.email);
  const password = String(payload.password || '');
  const user = await findByEmail(email);
  if (!user) throw new HttpError(401, 'Invalid credentials.');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new HttpError(401, 'Invalid credentials.');

  return createSession(user, payload.userAgent, payload.ip);
}

async function createSession(user, userAgent = '', ip = '') {
  const refreshToken = createRefreshToken();
  const tokenRecord = {
    id: randomUUID(),
    hash: hashToken(refreshToken),
    userAgent: sanitizeString(userAgent, 180),
    ip: sanitizeString(ip, 80),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  };

  let nextUser = user;
  await store.update('users', (users) =>
    users.map((item) => {
      if (item.id !== user.id) return item;
      nextUser = {
        ...item,
        refreshTokens: [...(item.refreshTokens || []).filter((token) => new Date(token.expiresAt) > new Date()), tokenRecord].slice(-8),
        lastLoginAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return nextUser;
    })
  );

  return {
    user: publicUser(nextUser),
    accessToken: signAccessToken(nextUser),
    refreshToken
  };
}

async function refresh(refreshToken, userAgent = '', ip = '') {
  const tokenHash = hashToken(String(refreshToken || ''));
  const users = await store.read('users');
  const user = users.find((item) => (item.refreshTokens || []).some((token) => token.hash === tokenHash));
  if (!user) throw new HttpError(401, 'Invalid refresh token.');

  const tokenRecord = (user.refreshTokens || []).find((token) => token.hash === tokenHash);
  if (!tokenRecord || new Date(tokenRecord.expiresAt) <= new Date()) throw new HttpError(401, 'Expired refresh token.');

  await logout(user.id, refreshToken);
  return createSession(user, userAgent, ip);
}

async function logout(userId, refreshToken) {
  const tokenHash = hashToken(String(refreshToken || ''));
  await store.update('users', (users) =>
    users.map((user) => {
      if (user.id !== userId) return user;
      return {
        ...user,
        refreshTokens: (user.refreshTokens || []).filter((token) => token.hash !== tokenHash),
        updatedAt: new Date().toISOString()
      };
    })
  );
  return { success: true };
}

async function updateProfile(userId, payload) {
  let updated;
  await store.update('users', (users) =>
    users.map((user) => {
      if (user.id !== userId) return user;
      const country = sanitizeString(payload.country || user.country || 'US', 2).toUpperCase();
      const currency = sanitizeString(payload.currency || user.currency || currencyService.detectCurrency(country), 6).toUpperCase();
      if (!currencyService.supportedCurrencies().includes(currency)) throw new HttpError(400, 'Currency is not supported.');
      updated = {
        ...user,
        name: sanitizeString(payload.name || user.name, 120),
        country,
        currency,
        preferences: {
          ...(user.preferences || {}),
          ...(payload.preferences || {})
        },
        updatedAt: new Date().toISOString()
      };
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'User not found.');
  return publicUser(updated);
}

async function saveAddress(userId, payload) {
  const address = {
    id: payload.id || randomUUID(),
    label: sanitizeString(payload.label || 'Primary', 80),
    name: sanitizeString(payload.name, 120),
    line1: sanitizeString(payload.line1, 180),
    line2: sanitizeString(payload.line2 || '', 180),
    city: sanitizeString(payload.city, 120),
    region: sanitizeString(payload.region, 120),
    postalCode: sanitizeString(payload.postalCode, 40),
    country: sanitizeString(payload.country, 2).toUpperCase(),
    phone: sanitizeString(payload.phone, 60),
    updatedAt: new Date().toISOString()
  };
  if (!address.name || !address.line1 || !address.city || !address.country) throw new HttpError(400, 'Address is incomplete.');

  let updated;
  await store.update('users', (users) =>
    users.map((user) => {
      if (user.id !== userId) return user;
      const addresses = [...(user.addresses || []).filter((item) => item.id !== address.id), address].slice(-8);
      updated = { ...user, addresses, updatedAt: new Date().toISOString() };
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'User not found.');
  return publicUser(updated);
}

async function toggleWishlist(userId, productId) {
  let updated;
  await store.update('users', (users) =>
    users.map((user) => {
      if (user.id !== userId) return user;
      const wishlist = new Set(user.wishlist || []);
      if (wishlist.has(productId)) wishlist.delete(productId);
      else wishlist.add(productId);
      updated = { ...user, wishlist: [...wishlist], updatedAt: new Date().toISOString() };
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'User not found.');
  return publicUser(updated);
}

async function requestPasswordReset(email) {
  const token = createRefreshToken();
  const tokenHash = hashToken(token);
  let userFound = false;
  await store.update('users', (users) =>
    users.map((user) => {
      if (user.email !== sanitizeEmail(email)) return user;
      userFound = true;
      return {
        ...user,
        resetTokens: [
          ...(user.resetTokens || []),
          {
            hash: tokenHash,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString()
          }
        ].slice(-3),
        updatedAt: new Date().toISOString()
      };
    })
  );

  return {
    message: 'If that account exists, a secure password reset link is ready to send.',
    devResetToken: config.env === 'production' || !userFound ? undefined : token
  };
}

async function resetPassword(token, password) {
  if (String(password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  const tokenHash = hashToken(String(token || ''));
  const passwordHash = await bcrypt.hash(String(password), 12);
  let updated = false;

  await store.update('users', (users) =>
    users.map((user) => {
      const resetToken = (user.resetTokens || []).find((item) => item.hash === tokenHash);
      if (!resetToken || new Date(resetToken.expiresAt) <= new Date()) return user;
      updated = true;
      return {
        ...user,
        passwordHash,
        resetTokens: [],
        refreshTokens: [],
        updatedAt: new Date().toISOString()
      };
    })
  );

  if (!updated) throw new HttpError(400, 'Reset token is invalid or expired.');
  return { success: true };
}

async function listCustomers() {
  const users = await store.read('users');
  return users.map(publicUser).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  publicUser,
  findById,
  findByEmail,
  ensureAdminUser,
  register,
  login,
  refresh,
  logout,
  updateProfile,
  saveAddress,
  toggleWishlist,
  requestPasswordReset,
  resetPassword,
  listCustomers
};
