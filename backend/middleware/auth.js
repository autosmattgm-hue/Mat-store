const jwt = require('jsonwebtoken');
const config = require('../config');
const userService = require('../services/userService');
const HttpError = require('../utils/httpError');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return '';
}

async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new HttpError(401, 'Authentication required.');
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await userService.findById(payload.sub);
    if (!user) throw new HttpError(401, 'Authentication required.');
    req.user = user;
    next();
  } catch (error) {
    next(error.status ? error : new HttpError(401, 'Authentication required.'));
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = await userService.findById(payload.sub);
    next();
  } catch {
    next();
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new HttpError(403, 'Admin access required.'));
  return next();
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireAdmin
};
