const cartService = require('../services/cartService');

async function get(req, res, next) {
  try {
    const cart = await cartService.getCart({
      userId: req.user?.id,
      sessionId: req.query.sessionId,
      currency: req.query.currency
    });
    res.json({ cart });
  } catch (error) {
    next(error);
  }
}

async function upsert(req, res, next) {
  try {
    const cart = await cartService.upsertCart({
      ...req.body,
      userId: req.user?.id
    });
    res.json({ cart });
  } catch (error) {
    next(error);
  }
}

async function abandoned(req, res, next) {
  try {
    const carts = await cartService.listAbandonedCarts();
    res.json({ carts });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  get,
  upsert,
  abandoned
};
