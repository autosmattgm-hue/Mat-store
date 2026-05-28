const userService = require('../services/userService');
const currencyService = require('../services/currencyService');

async function register(req, res, next) {
  try {
    const result = await userService.register({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await userService.login({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const result = await userService.refresh(req.body.refreshToken, req.headers['user-agent'], req.ip);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const result = await userService.logout(req.user.id, req.body.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function me(req, res) {
  res.json({ user: userService.publicUser(req.user) });
}

async function updateProfile(req, res, next) {
  try {
    const user = await userService.updateProfile(req.user.id, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

async function saveAddress(req, res, next) {
  try {
    const user = await userService.saveAddress(req.user.id, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

async function toggleWishlist(req, res, next) {
  try {
    const user = await userService.toggleWishlist(req.user.id, req.params.productId);
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const result = await userService.requestPasswordReset(req.body.email);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const result = await userService.resetPassword(req.body.token, req.body.password);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

function currencies(req, res) {
  res.json({
    supported: currencyService.supportedCurrencies(),
    rates: currencyService.ratesToUsd,
    symbols: currencyService.currencySymbols
  });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  updateProfile,
  saveAddress,
  toggleWishlist,
  forgotPassword,
  resetPassword,
  currencies
};
