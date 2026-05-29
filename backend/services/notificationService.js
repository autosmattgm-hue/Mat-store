const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const { sanitizeString } = require('../utils/sanitize');

const CHANNELS = new Set(['email', 'admin', 'system']);

function cleanChannel(value = 'email') {
  const channel = sanitizeString(value || 'email', 24).toLowerCase();
  return CHANNELS.has(channel) ? channel : 'email';
}

async function createNotification(payload = {}) {
  const notification = {
    id: randomUUID(),
    channel: cleanChannel(payload.channel),
    type: sanitizeString(payload.type || 'general', 80),
    status: sanitizeString(payload.status || 'queued', 40),
    recipient: sanitizeString(payload.recipient || '', 254),
    subject: sanitizeString(payload.subject || '', 180),
    preview: sanitizeString(payload.preview || '', 500),
    orderId: sanitizeString(payload.orderId || '', 80),
    productId: sanitizeString(payload.productId || '', 80),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await store.update('notifications', (notifications) => [notification, ...(notifications || [])].slice(0, 1000));
  return notification;
}

async function queueOrderNotification(order = {}, type = 'order_update', options = {}) {
  const recipient = sanitizeString(order.customer?.email || options.recipient || '', 254);
  if (!recipient) return null;
  const subjectMap = {
    order_created: `MAT STORE order ${order.orderNumber} received`,
    payment_confirmed: `Payment confirmed for ${order.orderNumber}`,
    fulfillment_updated: `Order ${order.orderNumber} update`,
    order_cancelled: `Order ${order.orderNumber} cancelled`
  };
  const previewMap = {
    order_created: 'Your order is reserved and ready for secure PayPal payment.',
    payment_confirmed: 'Your PayPal payment has been confirmed and your order is moving into processing.',
    fulfillment_updated: `Your order status is now ${order.fulfillmentStatus || 'updated'}.`,
    order_cancelled: 'Your order was cancelled and inventory was released.'
  };
  return createNotification({
    channel: 'email',
    type,
    recipient,
    subject: options.subject || subjectMap[type] || subjectMap.fulfillment_updated,
    preview: options.preview || previewMap[type] || previewMap.fulfillment_updated,
    orderId: order.id,
    metadata: {
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      trackingNumber: order.trackingNumber || ''
    }
  });
}

async function listNotifications(query = {}) {
  const notifications = await store.read('notifications');
  const limit = Math.min(200, Math.max(1, Number(query.limit || 80)));
  let filtered = notifications || [];
  if (query.type) filtered = filtered.filter((item) => item.type === query.type);
  if (query.status) filtered = filtered.filter((item) => item.status === query.status);
  if (query.orderId) filtered = filtered.filter((item) => item.orderId === query.orderId);
  return filtered
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

module.exports = {
  createNotification,
  queueOrderNotification,
  listNotifications
};
