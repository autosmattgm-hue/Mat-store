const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');
const HttpError = require('../utils/httpError');

async function create(req, res, next) {
  try {
    const order = await orderService.createOrder({
      ...req.body,
      userId: req.user?.id || null
    });
    const payment = await paymentService.createPaymentHandoff(order);
    res.status(201).json({ order, payment });
  } catch (error) {
    next(error);
  }
}

async function paypalConfig(req, res, next) {
  try {
    res.json(paymentService.paypalClientConfig(req.query.currency || 'USD'));
  } catch (error) {
    next(error);
  }
}

async function createPaypalOrder(req, res, next) {
  let order = null;
  try {
    if (!paymentService.paypalClientConfig(req.body.currency || 'USD').enabled) {
      throw new HttpError(424, 'PayPal checkout is not configured yet.');
    }
    order = await orderService.createOrder({
      ...req.body,
      paymentMethod: 'paypal',
      userId: req.user?.id || null
    });
    const payment = await paymentService.createPayPalOrder(order, { required: true });
    res.status(201).json({ order, payment });
  } catch (error) {
    if (order?.id) {
      try {
        await orderService.cancelOrderAndReleaseInventory(order.id, {
          paymentStatus: 'failed',
          message: `PayPal order creation failed: ${error.message}`
        });
      } catch (releaseError) {
        error.details = {
          ...(error.details || {}),
          releaseError: releaseError.message
        };
      }
    }
    next(error);
  }
}

async function capturePaypalOrder(req, res, next) {
  try {
    const payment = await paymentService.capturePayPalOrder({
      ...req.body,
      userId: req.user.id
    });
    res.json({ payment, order: payment.order });
  } catch (error) {
    next(error);
  }
}

async function myOrders(req, res, next) {
  try {
    const orders = await orderService.listOrders({ userId: req.user.id });
    res.json({ orders });
  } catch (error) {
    next(error);
  }
}

async function track(req, res, next) {
  try {
    const tracking = await orderService.trackOrder(req.query);
    res.json({ tracking });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const orders = await orderService.listOrders(req.query);
    res.json({ orders });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const order = await orderService.updateOrderStatus(req.params.id, req.body);
    res.json({ order });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  create,
  paypalConfig,
  createPaypalOrder,
  capturePaypalOrder,
  track,
  myOrders,
  list,
  update
};
