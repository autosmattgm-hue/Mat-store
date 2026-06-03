const { sanitizeString } = require('./sanitize');
const mediaService = require('../services/mediaService');

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
  if (mediaService.isBlockedStockImageUrl(decoded)) return false;
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

function isTrustedProductImageUrl(value = '') {
  const image = primaryRealProductMedia({ images: [value] }) || value;
  const normalized = mediaService.highQualityImageUrl(image) || image;
  return mediaService.isAllowedRemoteImageUrl(normalized);
}

function isLiveVerifiedSafeImageProduct(product = {}) {
  if (!product.imageVerifiedAt || !['live-product-download', 'search-image-candidate'].includes(product.imageVerification)) return false;
  const image = primaryRealProductMedia(product);
  const normalized = mediaService.highQualityImageUrl(image) || image;
  return isTrustedProductImageUrl(normalized) || mediaService.isSafeTrustedRemoteImageUrl(normalized);
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

  const searchImport = /\b(?:mat-store-search|exact-search|mat-ai-search|mat store search|search discovery)\b/i.test(text);
  if (searchImport && /\b(?:drivers?|how\s+to\s+connect|revealed|design\s+details|first\s+images?|reviews?|ratings?|news|article|blog|guide|wallpapers?|backgrounds?|templates?|mockup|stock\s+photos?|free\s+\w+\s+image|assortment\s+image|security\s+features?\s+explained|features?\s+explained)\b/i.test(text)) return true;

  if (/\b(?:replica|counterfeit|knockoff|fake|clone)\b/i.test(text)) return true;
  if (/\b1\s*:\s*1\b/i.test(text)) return true;
  if (/\boriginal intelligent\b/i.test(text)) return true;
  if (/\bdual card dual standby\b/i.test(text)) return true;
  if (/\bi\s*\d{1,2}\s*(?:pro\s*max|promax)\b/i.test(text) && !/\biphone\b/i.test(text)) return true;
  if (/\bglobal version\b/i.test(text) && /\b(?:promax|pro max|dual standby)\b/i.test(text)) return true;

  return false;
}

function generatedSearchText(product = {}) {
  return [
    product.supplierProductCode,
    product.supplierUrl,
    product.sourceUrl,
    product.originalUrl,
    product.resolvedUrl,
    product.description,
    product.shortDescription,
    product.ai?.provider,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.features) ? product.features : []),
    ...(Array.isArray(product.marketplaceDetails?.about) ? product.marketplaceDetails.about : [])
  ]
    .map((value) => sanitizeString(String(value || ''), 500))
    .filter(Boolean)
    .join(' ');
}

function isGeneratedSearchProduct(product = {}) {
  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag || '').toLowerCase().replace(/\s+/g, '-'))
    : [];
  const code = sanitizeString(product.supplierProductCode || '', 120);
  const generatedCode = /^(?:mat-store|mat\s+store)-[a-z0-9-]+-\d+$/i.test(code)
    && (tags.includes('mat-store-search') || tags.includes('exact-search'));
  const text = generatedSearchText(product);

  return generatedCode
    || /#mat-(?:search|walmart)-/i.test(text)
    || /\b(?:mat-store-search-fallback|exact-search-fallback)\b/i.test(text)
    || /product details should be verified before fulfillment/i.test(text)
    || /created only when catalog parsing is blocked or incomplete/i.test(text)
    || /exact MAT STORE search entry/i.test(text);
}

function isUntrustedDiscoveredImageProduct(product = {}) {
  if (product.imageStatus !== 'discovered-product-image') return false;
  const image = primaryRealProductMedia(product);
  return !isTrustedProductImageUrl(image) && !isLiveVerifiedSafeImageProduct(product);
}

function isSearchProduct(product = {}) {
  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag || '').toLowerCase().replace(/\s+/g, '-'))
    : [];
  const provider = String(product.ai?.provider || '').toLowerCase();
  const collection = String(product.collection || '').toLowerCase();
  return tags.includes('mat-store-search')
    || tags.includes('exact-search')
    || provider.includes('search')
    || collection.includes('mat store search');
}

function isUnverifiedSearchImageProduct(product = {}) {
  return isSearchProduct(product)
    && !isLiveVerifiedSafeImageProduct(product)
    && (!product.imageVerifiedAt || !isTrustedProductImageUrl(primaryRealProductMedia(product)));
}

module.exports = {
  hasRealProductMedia,
  primaryRealProductMedia,
  isTrustedProductImageUrl,
  isLiveVerifiedSafeImageProduct,
  isQuestionableProduct,
  isGeneratedSearchProduct,
  isUntrustedDiscoveredImageProduct,
  isSearchProduct,
  isUnverifiedSearchImageProduct
};
