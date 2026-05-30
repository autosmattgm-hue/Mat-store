const { sanitizeString } = require('./sanitize');
const { isBlockedStockImageUrl } = require('../services/mediaService');

function valueLooksLikeRealProductMedia(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  if (/\/api\/media\/fallback/i.test(decoded)) return false;
  if (isBlockedStockImageUrl(decoded)) return false;
  if (/^\/api\/media\/image\?url=/i.test(raw)) return true;
  return /^https?:\/\//i.test(raw);
}

function hasRealProductMedia(product = {}) {
  const candidates = [
    product.supplierImageUrl,
    product.image,
    ...(Array.isArray(product.images) ? product.images : [])
  ];
  return candidates.some(valueLooksLikeRealProductMedia);
}

function primaryRealProductMedia(product = {}) {
  const candidates = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image,
    product.supplierImageUrl
  ];
  return candidates.find(valueLooksLikeRealProductMedia) || '';
}

function catalogText(product = {}) {
  return [
    product.title,
    product.description,
    product.shortDescription,
    product.category,
    product.collection,
    product.supplierName,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.features) ? product.features : [])
  ]
    .map((value) => sanitizeString(String(value || ''), 400))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isQuestionableProduct(product = {}) {
  const text = catalogText(product);
  if (!text) return false;

  if (/\b(?:replica|counterfeit|knockoff|fake|clone)\b/i.test(text)) return true;
  if (/\b1\s*:\s*1\b/i.test(text)) return true;
  if (/\boriginal intelligent\b/i.test(text)) return true;
  if (/\bdual card dual standby\b/i.test(text)) return true;
  if (/\bi\s*\d{1,2}\s*(?:pro\s*max|promax)\b/i.test(text) && !/\biphone\b/i.test(text)) return true;
  if (/\bglobal version\b/i.test(text) && /\b(?:promax|pro max|dual standby)\b/i.test(text)) return true;

  return false;
}

module.exports = {
  hasRealProductMedia,
  primaryRealProductMedia,
  isQuestionableProduct
};
