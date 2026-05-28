const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');

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

async function myOrders(req, res, next) {
  try {
    const orders = await orderService.listOrders({ userId: req.user.id });
    res.json({ orders });
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
  myOrders,
  list,
  update
};
