const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const productService = require('./productService');
const currencyService = require('./currencyService');
const mediaService = require('./mediaService');
const variantPricing = require('../utils/variantPricing');
const { sanitizeString } = require('../utils/sanitize');
const { cleanProductTitle } = require('../utils/productTitle');

function cartIdentity({ userId, sessionId }) {
  return userId ? { userId } : { sessionId: sanitizeString(sessionId || randomUUID(), 120) };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function upsertCart(payload) {
  const identity = cartIdentity(payload);
  const currency = String(payload.currency || 'USD').toUpperCase();
  const cleanItems = Array.isArray(payload.items)
    ? payload.items
        .map((item) => ({
          productId: sanitizeString(item.productId, 80),
          quantity: Math.max(1, Math.min(99, Math.floor(Number(item.quantity || 1)))),
          variant: sanitizeString(item.variant || '', 120)
        }))
        .filter((item) => item.productId)
    : [];

  const cart = {
    id: payload.cartId || randomUUID(),
    ...identity,
    currency,
    items: cleanItems,
    status: cleanItems.length ? 'active' : 'empty',
    updatedAt: new Date().toISOString(),
    createdAt: payload.createdAt || new Date().toISOString()
  };

  await store.update('carts', (carts) => {
    const withoutPrevious = carts.filter((item) => {
      if (identity.userId) return item.userId !== identity.userId;
      return item.sessionId !== identity.sessionId;
    });
    return [cart, ...withoutPrevious].slice(0, 2000);
  });

  return hydrateCart(cart);
}

async function hydrateCart(cart) {
  const products = await store.read('products');
  const lineItems = (cart.items || []).map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    const pricing = product ? variantPricing.variantPricingForProduct(product, item.variant) : { price: 0, adjusted: false, reasons: [] };
    const unitPrice = pricing.price || product?.price || 0;
    const displayUnitPrice = currencyService.convertFromUsd(unitPrice, cart.currency);
    const image = product
      ? product.images?.find((item) => !mediaService.isGeneratedFallbackUrl(item)) ||
        mediaService.representativeProductImageUrl(product) ||
        product.fallbackImage ||
        ''
      : '';
    return {
      ...item,
      product: product
        ? {
            id: product.id,
            title: cleanProductTitle(product.title),
            image,
            stock: product.stock,
            slug: product.slug
          }
        : null,
      unitPrice,
      variantPricing: pricing,
      displayUnitPrice,
      lineTotal: unitPrice * item.quantity,
      displayLineTotal: displayUnitPrice * item.quantity
    };
  });

  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.lineTotal, 0));
  const shipping = roundMoney(subtotal > 150 || subtotal === 0 ? 0 : 9.95);
  const tax = roundMoney(subtotal * 0.07);
  const total = roundMoney(subtotal + shipping + tax);

  return {
    ...cart,
    lineItems,
    totals: {
      subtotal,
      shipping,
      tax,
      total,
      displaySubtotal: currencyService.convertFromUsd(subtotal, cart.currency),
      displayShipping: currencyService.convertFromUsd(shipping, cart.currency),
      displayTax: currencyService.convertFromUsd(tax, cart.currency),
      displayTotal: currencyService.convertFromUsd(total, cart.currency),
      currency: cart.currency
    }
  };
}

async function getCart(payload) {
  const identity = cartIdentity(payload);
  const carts = await store.read('carts');
  const cart = carts.find((item) => (identity.userId ? item.userId === identity.userId : item.sessionId === identity.sessionId));
  if (!cart) {
    return hydrateCart({
      id: randomUUID(),
      ...identity,
      currency: payload.currency || 'USD',
      items: [],
      status: 'empty',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return hydrateCart(cart);
}

async function markAbandonedCandidates() {
  const cutoff = Date.now() - 1000 * 60 * 30;
  const carts = await store.read('carts');
  const products = await store.read('products');
  const candidates = carts.filter((cart) => cart.items?.length && new Date(cart.updatedAt).getTime() < cutoff);

  if (!candidates.length) return [];

  let records = [];
  await store.update('abandonedCarts', (existing) => {
    const existingIds = new Set(existing.map((item) => item.cartId));
    records = candidates
      .filter((cart) => !existingIds.has(cart.id))
      .map((cart) => ({
        id: randomUUID(),
        cartId: cart.id,
        userId: cart.userId || null,
        sessionId: cart.sessionId || null,
        currency: cart.currency,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        estimatedValue: cart.items.reduce((sum, item) => {
          const product = products.find((entry) => entry.id === item.productId);
          const pricing = product ? variantPricing.variantPricingForProduct(product, item.variant) : { price: 0 };
          return sum + (pricing.price || product?.price || 0) * item.quantity;
        }, 0),
        status: 'ready',
        recoveryChannel: 'email-ready',
        createdAt: new Date().toISOString(),
        lastReminderAt: null
      }));
    return [...records, ...existing].slice(0, 2000);
  });

  return records;
}

async function listAbandonedCarts() {
  await markAbandonedCandidates();
  return store.read('abandonedCarts');
}

module.exports = {
  upsertCart,
  getCart,
  hydrateCart,
  markAbandonedCandidates,
  listAbandonedCarts
};
