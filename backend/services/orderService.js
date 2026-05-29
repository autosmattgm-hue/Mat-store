const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const productService = require('./productService');
const cartService = require('./cartService');
const currencyService = require('./currencyService');
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
    paymentMethod: sanitizeString(payload.paymentMethod || 'stripe', 40),
    paymentStatus: 'pending',
    fulfillmentStatus: 'new',
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
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
      updated = {
        ...order,
        paymentStatus: sanitizeString(payload.paymentStatus || order.paymentStatus, 40),
        fulfillmentStatus: sanitizeString(payload.fulfillmentStatus || order.fulfillmentStatus, 40),
        auditTrail: [
          ...(order.auditTrail || []),
          {
            status: 'updated',
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
  return updated;
}

async function updateOrderPayment(orderId, payload = {}) {
  let updated;
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
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
  if (!updated) throw new HttpError(404, 'Order not found.');
  return updated;
}

async function cancelOrderAndReleaseInventory(orderId, payload = {}) {
  let target;
  await store.update('orders', (orders) =>
    orders.map((order) => {
      if (order.id !== orderId) return order;
      target = order;
      return {
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
    })
  );
  if (!target) throw new HttpError(404, 'Order not found.');
  if (target.fulfillmentStatus !== 'cancelled') {
    for (const item of target.items || []) {
      await productService.adjustInventory(item.productId, item.quantity);
    }
  }
  return {
    ...target,
    paymentStatus: sanitizeString(payload.paymentStatus || 'failed', 40),
    fulfillmentStatus: 'cancelled'
  };
}

function buildWhatsAppOrderUrl(order, whatsappNumber) {
  const lines = [
    `MAT STORE order ${order.orderNumber}`,
    `Customer: ${order.customer.name}`,
    `Email: ${order.customer.email}`,
    `Phone: ${order.customer.phone || 'N/A'}`,
    `Total: ${currencyService.formatMoney(order.totals.displayTotal, order.currency)} ${order.currency}`,
    `Shipping: ${order.checkout?.shippingLabel || 'MAT Standard'} (${order.checkout?.deliveryWindow || 'Delivery calculated at checkout'})`,
    'Items:',
    ...order.items.map((item) => `- ${item.quantity}x ${item.title} (${currencyService.formatMoney(currencyService.convertFromUsd(item.lineTotal, order.currency), order.currency)})`),
    `Ship to: ${order.shippingAddress.line1}, ${order.shippingAddress.city}, ${order.shippingAddress.country}`
  ];
  const number = String(whatsappNumber || '').replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join('\n'))}`;
}

module.exports = {
  createOrder,
  listOrders,
  updateOrderStatus,
  updateOrderPayment,
  cancelOrderAndReleaseInventory,
  buildWhatsAppOrderUrl,
  shippingOptions,
  selectedShippingOption
};
