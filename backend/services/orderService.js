const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const productService = require('./productService');
const cartService = require('./cartService');
const currencyService = require('./currencyService');
const notificationService = require('./notificationService');
const { sanitizeString } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');

function orderNumber() {
  return `MAT-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const shippingOptions = {
  standard: {
    id: 'standard',
    label: 'MAT Standard',
    fee: 0,
    deliveryWindow: '7-14 business days',
    supportLevel: 'Tracked delivery'
  },
  express: {
    id: 'express',
    label: 'MAT Express',
    fee: 12.95,
    deliveryWindow: '4-8 business days',
    supportLevel: 'Faster dispatch'
  },
  priority: {
    id: 'priority',
    label: 'MAT Priority',
    fee: 24.95,
    deliveryWindow: '2-5 business days',
    supportLevel: 'Priority handling'
  },
  concierge: {
    id: 'concierge',
    label: 'MAT Concierge',
    fee: 39.95,
    deliveryWindow: 'Priority window after supplier confirmation',
    supportLevel: 'High-touch order support'
  }
};

function selectedShippingOption(value = 'standard') {
  const key = sanitizeString(value || 'standard', 40).toLowerCase();
  return shippingOptions[key] || shippingOptions.standard;
}

function trackingSteps(order = {}) {
  const steps = [
    { key: 'new', label: 'Order received', description: 'Your order was created and inventory was reserved.' },
    { key: 'processing', label: 'Processing', description: 'MAT STORE is preparing your order for dispatch.' },
    { key: 'shipped', label: 'Shipped', description: 'Your tracking details are available when the carrier confirms movement.' },
    { key: 'delivered', label: 'Delivered', description: 'Your package has been marked delivered.' }
  ];
  const status = sanitizeString(order.fulfillmentStatus || 'new', 40).toLowerCase();
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === status));
  if (status === 'cancelled') {
    return steps.map((step, index) => ({
      ...step,
      complete: index === 0,
      active: false,
      cancelled: true
    }));
  }
  return steps.map((step, index) => ({
    ...step,
    complete: index <= activeIndex,
    active: index === activeIndex,
    cancelled: false
  }));
}

function publicTracking(order = {}) {
  return {
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currency: order.currency,
    totals: order.totals,
    customer: {
      name: order.customer?.name || '',
      email: order.customer?.email || ''
    },
    shippingAddress: {
      city: order.shippingAddress?.city || '',
      region: order.shippingAddress?.region || '',
      country: order.shippingAddress?.country || ''
    },
    checkout: {
      shippingLabel: order.checkout?.shippingLabel || '',
      deliveryWindow: order.checkout?.deliveryWindow || '',
      supportLevel: order.checkout?.supportLevel || ''
    },
    trackingNumber: order.trackingNumber || '',
    trackingCarrier: order.trackingCarrier || '',
    trackingUrl: order.trackingUrl || '',
    items: (order.items || []).map((item) => ({
      title: item.title,
      image: item.image,
      quantity: item.quantity,
      variant: item.variant || '',
      lineTotal: item.lineTotal
    })),
    auditTrail: order.auditTrail || [],
    trackingSteps: trackingSteps(order)
  };
}

async function createOrder(payload) {
  const cart = await cartService.hydrateCart({
    id: payload.cartId || randomUUID(),
    userId: payload.userId || null,
    sessionId: payload.sessionId || null,
    currency: payload.currency || 'USD',
    items: payload.items || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  if (!cart.lineItems.length) throw new HttpError(400, 'Cart is empty.');

  for (const item of cart.lineItems) {
    if (!item.product) throw new HttpError(400, 'One or more products are unavailable.');
    if (item.product.stock < item.quantity) throw new HttpError(409, `${item.product.title} has limited stock.`);
  }

  const promoCode = sanitizeString(payload.promoCode || '', 40).toUpperCase();
  const discountRate = promoCode === 'MAT10' ? 0.1 : promoCode === 'VIP15' ? 0.15 : 0;
  const discount = roundMoney(cart.totals.subtotal * discountRate);
  const shippingOption = selectedShippingOption(payload.shippingMethod);
  const shipping = roundMoney(cart.totals.shipping + shippingOption.fee);
  const totals = {
    ...cart.totals,
    shipping,
    discount,
    total: roundMoney(Math.max(0, cart.totals.subtotal + shipping + cart.totals.tax - discount))
  };
  totals.displayShipping = currencyService.convertFromUsd(totals.shipping, totals.currency);
  totals.displayDiscount = currencyService.convertFromUsd(totals.discount, totals.currency);
  totals.displayTotal = currencyService.convertFromUsd(totals.total, totals.currency);

  const order = {
    id: randomUUID(),
    orderNumber: orderNumber(),
    userId: payload.userId || null,
    customer: {
      name: sanitizeString(payload.customer?.name, 120),
      email: sanitizeString(payload.customer?.email, 254),
      phone: sanitizeString(payload.customer?.phone, 80)
    },
    shippingAddress: {
      name: sanitizeString(payload.shippingAddress?.name || payload.customer?.name, 120),
      line1: sanitizeString(payload.shippingAddress?.line1, 180),
      line2: sanitizeString(payload.shippingAddress?.line2 || '', 180),
      city: sanitizeString(payload.shippingAddress?.city, 120),
      region: sanitizeString(payload.shippingAddress?.region, 120),
      postalCode: sanitizeString(payload.shippingAddress?.postalCode, 40),
      country: sanitizeString(payload.shippingAddress?.country || 'US', 2).toUpperCase()
    },
    items: cart.lineItems.map((item) => ({
      productId: item.productId,
      title: item.product.title,
      image: item.product.image,
      quantity: item.quantity,
      variant: item.variant,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal
    })),
    currency: cart.totals.currency,
    totals,
    checkout: {
      shippingMethod: shippingOption.id,
      shippingLabel: shippingOption.label,
      deliveryWindow: shippingOption.deliveryWindow,
      supportLevel: shippingOption.supportLevel,
      billingSameAsShipping: payload.billingSameAsShipping !== false,
      billingAddress: {
        name: sanitizeString(payload.billingAddress?.name || payload.customer?.name, 120),
        line1: sanitizeString(payload.billingAddress?.line1 || '', 180),
        line2: sanitizeString(payload.billingAddress?.line2 || '', 180),
        city: sanitizeString(payload.billingAddress?.city || '', 120),
        region: sanitizeString(payload.billingAddress?.region || '', 120),
        postalCode: sanitizeString(payload.billingAddress?.postalCode || '', 40),
        country: sanitizeString(payload.billingAddress?.country || payload.shippingAddress?.country || 'US', 2).toUpperCase()
      },
      termsAccepted: Boolean(payload.termsAccepted),
      marketingOptIn: Boolean(payload.marketingOptIn),
      giftMessage: sanitizeString(payload.giftMessage || '', 220)
    },
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    fulfillmentStatus: 'new',
    trackingNumber: '',
    trackingCarrier: '',
    trackingUrl: '',
    promoCode,
    notes: sanitizeString(payload.notes || '', 500),
    auditTrail: [
      {
        status: 'created',
        message: 'Order created and inventory reserved.',
        createdAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  for (const item of cart.lineItems) {
    await productService.adjustInventory(item.productId, -item.quantity);
  }

  await store.update('orders', (orders) => [order, ...orders]);
  await notificationService.queueOrderNotification(order, 'order_created');
  return order;
}

async function listOrders(query = {}) {
  const orders = await store.read('orders');
  let filtered = orders;
  if (query.userId) filtered = filtered.filter((order) => order.userId === query.userId);
  if (query.status) filtered = filtered.filter((order) => order.fulfillmentStatus === query.status);
  return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function updateOrderStatus(orderId, payload) {
  let updated;
  let previousStatus = '';
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
      previousStatus = order.fulfillmentStatus;
      const fulfillmentStatus = sanitizeString(payload.fulfillmentStatus || order.fulfillmentStatus, 40);
      const paymentStatus = sanitizeString(payload.paymentStatus || order.paymentStatus, 40);
      updated = {
        ...order,
        paymentStatus,
        fulfillmentStatus,
        trackingNumber: sanitizeString(payload.trackingNumber ?? order.trackingNumber ?? '', 120),
        trackingCarrier: sanitizeString(payload.trackingCarrier ?? order.trackingCarrier ?? '', 120),
        trackingUrl: sanitizeString(payload.trackingUrl ?? order.trackingUrl ?? '', 260),
        auditTrail: [
          ...(order.auditTrail || []),
          {
            status: fulfillmentStatus === 'cancelled' ? 'cancelled' : 'updated',
            message: sanitizeString(payload.message || 'Order status updated.', 220),
            createdAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString()
      };
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'Order not found.');
  if (updated.fulfillmentStatus === 'cancelled') {
    await notificationService.queueOrderNotification(updated, 'order_cancelled');
  } else if (previousStatus !== updated.fulfillmentStatus || payload.trackingNumber || payload.trackingCarrier || payload.trackingUrl) {
    await notificationService.queueOrderNotification(updated, 'fulfillment_updated');
  }
  return updated;
}

async function updateOrderPayment(orderId, payload = {}) {
  let updated;
  let previousPaymentStatus = '';
  let forbidden = false;
  const requiredUserId = sanitizeString(payload.userId || '', 120);
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
      if (requiredUserId && order.userId !== requiredUserId) {
        forbidden = true;
        return order;
      }
      previousPaymentStatus = order.paymentStatus;
      const payment = {
        ...(order.payment || {}),
        provider: sanitizeString(payload.provider || order.payment?.provider || order.paymentMethod, 40),
        processorOrderId: sanitizeString(payload.processorOrderId || order.payment?.processorOrderId || '', 120),
        processorCaptureId: sanitizeString(payload.processorCaptureId || order.payment?.processorCaptureId || '', 120),
        processorStatus: sanitizeString(payload.processorStatus || order.payment?.processorStatus || '', 80),
        processorMode: sanitizeString(payload.processorMode || order.payment?.processorMode || '', 40),
        settlementCurrency: sanitizeString(payload.settlementCurrency || order.payment?.settlementCurrency || order.currency, 12),
        settlementAmount: Number(payload.settlementAmount ?? order.payment?.settlementAmount ?? 0),
        payerEmail: sanitizeString(payload.payerEmail || order.payment?.payerEmail || '', 254),
        updatedAt: new Date().toISOString()
      };

      updated = {
        ...order,
        payment,
        paymentStatus: sanitizeString(payload.paymentStatus || order.paymentStatus, 40),
        auditTrail: [
          ...(order.auditTrail || []),
          {
            status: 'payment',
            message: sanitizeString(payload.message || 'Payment details updated.', 220),
            createdAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString()
      };
      return updated;
    })
  );
  if (forbidden) throw new HttpError(403, 'This order belongs to another account.');
  if (!updated) throw new HttpError(404, 'Order not found.');
  if (updated.paymentStatus === 'paid' && previousPaymentStatus !== 'paid') {
    await notificationService.queueOrderNotification(updated, 'payment_confirmed');
  }
  return updated;
}

async function cancelOrderAndReleaseInventory(orderId, payload = {}) {
  let target;
  let updated;
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
      target = order;
      updated = {
        ...order,
        paymentStatus: sanitizeString(payload.paymentStatus || 'failed', 40),
        fulfillmentStatus: 'cancelled',
        auditTrail: [
          ...(order.auditTrail || []),
          {
            status: 'cancelled',
            message: sanitizeString(payload.message || 'Order cancelled and inventory released.', 220),
            createdAt: new Date().toISOString()
          }
        ],
        updatedAt: new Date().toISOString()
      };
      return updated;
    })
  );
  if (!target) throw new HttpError(404, 'Order not found.');
  if (target.fulfillmentStatus !== 'cancelled') {
    for (const item of target.items || []) {
      await productService.adjustInventory(item.productId, item.quantity);
    }
  }
  await notificationService.queueOrderNotification(updated, 'order_cancelled');
  return updated;
}

async function trackOrder(query = {}) {
  const orderNumberInput = sanitizeString(query.orderNumber || query.order || '', 80).toLowerCase();
  const emailInput = sanitizeString(query.email || '', 254).toLowerCase();
  if (!orderNumberInput || !emailInput) throw new HttpError(400, 'Order number and email are required.');

  const orders = await store.read('orders');
  const order = orders.find((item) =>
    String(item.orderNumber || '').toLowerCase() === orderNumberInput &&
    String(item.customer?.email || '').toLowerCase() === emailInput
  );
  if (!order) throw new HttpError(404, 'Order not found for that email.');
  return publicTracking(order);
}

module.exports = {
  createOrder,
  listOrders,
  updateOrderStatus,
  updateOrderPayment,
  cancelOrderAndReleaseInventory,
  trackOrder,
  trackingSteps,
  shippingOptions,
  selectedShippingOption
};
