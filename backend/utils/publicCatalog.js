const { cleanProductTitle, formatBrandTitle } = require('./productTitle');
const mediaService = require('../services/mediaService');

const SOURCE_PATTERN = /\b(?:amazon(?:\.[a-z]{2,}){0,4}|walmart(?:\.[a-z]{2,}){0,4}|aliexpress(?:\.[a-z]{2,}){0,4}|ali\s*express|alibaba(?:\.[a-z]{2,}){0,4}|ebay(?:\.[a-z]{2,}){0,4}|temu(?:\.[a-z]{2,}){0,4}|best\s*buy|etsy|ldlc|supplier|marketplace|seller|shipper|fulfillment|source)\b/i;
const SOURCE_LABEL_PATTERN = /^(?:marketplace|supplier(?:\s+(?:code|list\s+price|search\s+url|price|cost))?|source|seller|shipper|fulfillment|image\s+override)$/i;

function cleanSourceText(value = '') {
  return String(value || '')
    .replace(/\bAmazon\.com\s*:\s*/gi, '')
    .replace(/\b(?:Best\s*Buy|Etsy|LDLC|Game\s*Hub|ARTLEMI(?:\s+Store)?|LAZA\s+GOODS|Killscreen|Sonix\s+Wireless(?:\s+INC)?|Mundo\s+Gamer)\s*:\s*/gi, '')
    .replace(/\s*(?:\u2022|\||-)\s*compare prices?.*$/gi, '')
    .replace(/\s*[:|,-]\s*(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)(?:\.[a-z]{2,}){0,4}(?:\s*[:|,-]\s*[^|,:-]+)?\s*$/gi, '')
    .replace(/\s*(?:\||\s-\s)\s*(?:Best\s*Buy|Etsy|LDLC|Game\s*Hub|ARTLEMI(?:\s+Store)?|LAZA\s+GOODS|Killscreen|Sonix\s+Wireless(?:\s+INC)?|Mundo\s+Gamer)\s*$/gi, '')
    .replace(/\s+\|\s+[A-Z][A-Za-z0-9 &.'-]{1,40}$/g, '')
    .replace(/\b(?:MAT\s*)?STORE\.com\s*:\s*/gi, '')
    .replace(/\b(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)\s+(?:Search|Goldbox|Front Page|Global Deals|Marketplace|Deals|Picks?)\s*:?\s*/gi, '')
    .replace(/\b(?:from|via|on|at)\s+(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)(?:\.[a-z]{2,}){0,4}\b/gi, '')
    .replace(/\b(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)\s+(?:product|deal|search pick|search match)\b/gi, 'Product')
    .replace(/\b(?:supplier|marketplace)\s+(?:seller|fulfillment|source|page|url|code|cost|price)\b/gi, '')
    .replace(/\b(?:seller|shipper)\s*:\s*[^.]+/gi, '')
    .replace(/\bsupplier\b/gi, 'product')
    .replace(/\bmarketplace\b/gi, 'MAT STORE')
    .replace(/\b(?:seller|shipper)\b/gi, 'MAT STORE')
    .replace(/\bfulfillment\b/gi, 'service')
    .replace(/\bsource\b/gi, 'catalog')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function hasSourceText(value = '') {
  return SOURCE_PATTERN.test(String(value || ''));
}

function publicCategoryLabel(category = '') {
  const clean = String(category || 'premium picks').replace(/[-_]+/g, ' ').trim();
  if (/smart\s*phones?|smartphones/i.test(clean)) return 'Smartphones';
  return formatBrandTitle(clean || 'Premium Picks');
}

function publicCollection(product = {}) {
  const category = publicCategoryLabel(product.category);
  if (/trending/i.test(product.collection || product.category || '')) return 'Trending Products';
  if (/deal|sale/i.test(product.collection || '')) return 'Premium Deals';
  if (/new/i.test(product.collection || '')) return 'Newest Arrivals';
  return category;
}

function publicDescription(product = {}) {
  const title = cleanProductTitle(cleanSourceText(product.title || 'Premium Product'));
  const cleanDescription = cleanSourceText(product.description || '');
  if (cleanDescription && !hasSourceText(cleanDescription) && cleanDescription.length > 60) return cleanDescription;
  return `${title} selected for MAT STORE customers with premium presentation, secure checkout, clear product details, and customer-first support.`;
}

function safeList(items = [], maxItems = 10, fallback = []) {
  const seen = new Set();
  const output = [];
  for (const item of [...(items || []), ...fallback]) {
    const clean = cleanSourceText(item);
    const key = clean.toLowerCase();
    if (!clean || hasSourceText(clean) || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= maxItems) break;
  }
  return output;
}

function cleanPublicValue(value = '', fallback = '') {
  const clean = cleanSourceText(value);
  return clean && !hasSourceText(clean) ? clean : fallback;
}

function publicVariants(product = {}) {
  const metadataLabels = new Set(['collection', 'fulfillment', 'supplier code', 'deal badge', 'image override', 'marketplace', 'source']);
  const seen = new Set();
  const variants = [];

  for (const variant of product.variants || []) {
    const name = cleanSourceText(variant?.name || '');
    const value = cleanSourceText(variant?.value || variant?.label || '');
    const key = `${name}:${value}`.toLowerCase();
    if (!name || !value || seen.has(key)) continue;
    if (metadataLabels.has(String(variant?.name || name).toLowerCase())) continue;
    if (SOURCE_LABEL_PATTERN.test(name) || hasSourceText(`${name} ${value}`)) continue;

    seen.add(key);
    variants.push({
      name,
      value,
      ...(Number.isFinite(Number(variant.price)) ? { price: Number(variant.price) } : {}),
      ...(Number.isFinite(Number(variant.priceDelta)) ? { priceDelta: Number(variant.priceDelta) } : {}),
      ...(Number.isFinite(Number(variant.multiplier)) ? { multiplier: Number(variant.multiplier) } : {})
    });
    if (variants.length >= 16) break;
  }

  return variants;
}

function unproxiedImageUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/api/media/image')) return raw;
  try {
    const parsed = new URL(raw, 'https://matstore.local');
    return parsed.searchParams.get('url') || '';
  } catch {
    return '';
  }
}

function publicRemoteImageUrl(value = '') {
  const raw = unproxiedImageUrl(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  if (mediaService.isBlockedStockImageUrl(raw)) return '';
  return mediaService.highQualityImageUrl(raw) || raw;
}

function publicMediaKey(product = {}) {
  return encodeURIComponent(product.id || product.slug || '');
}

function publicCatalogImageUrl(product = {}, index = 0) {
  const key = publicMediaKey(product);
  if (!key) return '';
  return `/api/media/catalog/${key}/${index}`;
}

function publicCatalogFallbackImageUrl(product = {}) {
  const key = publicMediaKey(product);
  if (!key) return '';
  return `/api/media/catalog/${key}/fallback`;
}

function publicImageCount(product = {}) {
  const candidates = [
    ...(Array.isArray(product.images) ? product.images : []),
    product.image,
    product.supplierImageUrl
  ];
  const seen = new Set();
  const images = [];

  for (const candidate of candidates) {
    const image = publicRemoteImageUrl(candidate);
    const key = image.toLowerCase();
    if (!image || seen.has(key)) continue;
    seen.add(key);
    images.push(image);
    if (images.length >= 8) break;
  }

  return images.length;
}

function publicImages(product = {}) {
  const count = publicImageCount(product);
  return Array.from({ length: count }, (_, index) => publicCatalogImageUrl(product, index)).filter(Boolean);
}

function publicMarketplaceDetails(product = {}) {
  const details = product.marketplaceDetails || {};
  const about = safeList(details.about, 8, product.features || []);
  const specs = (details.specs || [])
    .map((item) => ({
      name: cleanSourceText(item?.name || ''),
      value: cleanSourceText(item?.value || '')
    }))
    .filter((item) => item.name && item.value && !SOURCE_LABEL_PATTERN.test(item.name) && !hasSourceText(`${item.name} ${item.value}`))
    .slice(0, 12);

  return {
    availability: cleanPublicValue(details.availability, Number(product.stock || 0) > 0 ? 'In stock' : 'Stock pending'),
    returns: 'MAT STORE support review',
    payment: 'Secure MAT STORE transaction',
    delivery: cleanPublicValue(details.delivery, 'Delivery calculated at checkout'),
    shipping: 'Shipping calculated at checkout',
    badge: cleanPublicValue(details.badge, ''),
    listPrice: Number.isFinite(Number(details.listPrice)) ? Number(details.listPrice) : null,
    savingsPercent: Number.isFinite(Number(details.savingsPercent)) ? Number(details.savingsPercent) : null,
    about: about.length ? about : ['Premium product presentation', 'Secure MAT STORE checkout', 'Customer-first support workflow'],
    specs,
    buyingOptions: ['Add to cart', 'Buy now', 'Secure MAT STORE checkout'],
    videos: {
      count: Math.max(0, Math.floor(Number(details.videos?.count || 0))),
      label: 'Product videos appear when media is available'
    },
    reviews: {
      rating: Number(details.reviews?.rating || product.rating || 4.8),
      count: Math.max(0, Math.floor(Number(details.reviews?.count || product.reviewsCount || 0))),
      summary: cleanPublicValue(details.reviews?.summary || product.shortDescription || '', 'Customer reviews appear as MAT STORE collects verified feedback.')
    }
  };
}

function publicRelatedProduct(product = {}) {
  const title = cleanProductTitle(cleanSourceText(product.title || 'MAT STORE Product'));
  const images = publicImages(product);
  const fallbackImage = publicCatalogFallbackImageUrl(product) || images[0] || undefined;
  return {
    id: product.id,
    slug: product.id,
    title,
    category: publicCategoryLabel(product.category),
    collection: publicCollection(product),
    price: product.price,
    formattedPrice: product.formattedPrice,
    currency: product.currency,
    rating: product.rating,
    reviewsCount: product.reviewsCount,
    images,
    image: images[0] || undefined,
    fallbackImage
  };
}

function publicProduct(product = {}) {
  const title = cleanProductTitle(cleanSourceText(product.title || 'MAT STORE Product'));
  const description = publicDescription({ ...product, title });
  const shortDescription = cleanSourceText(product.shortDescription || '');
  const images = publicImages(product);
  const fallbackImage = publicCatalogFallbackImageUrl(product) || images[0] || undefined;
  return {
    ...product,
    slug: product.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title,
    description,
    shortDescription: shortDescription && !hasSourceText(shortDescription)
      ? shortDescription
      : `${publicCategoryLabel(product.category)} selected for secure MAT STORE checkout.`,
    collection: publicCollection(product),
    images,
    image: images[0] || undefined,
    fallbackImage,
    supplierUrl: undefined,
    supplierName: undefined,
    supplierProductCode: undefined,
    supplierPrice: undefined,
    supplierImageUrl: undefined,
    supplierHost: undefined,
    sku: undefined,
    sourceUrl: undefined,
    originalUrl: undefined,
    resolvedUrl: undefined,
    displaySupplierPrice: undefined,
    pricingPlan: undefined,
    imageSource: undefined,
    imageStatus: undefined,
    imageCandidateCount: undefined,
    mediaConfidence: undefined,
    markupPercent: undefined,
    related: Array.isArray(product.related) ? product.related.map(publicRelatedProduct) : undefined,
    createdAt: undefined,
    updatedAt: undefined,
    variants: publicVariants(product),
    tags: safeList(product.tags, 10),
    features: safeList(product.features, 8, ['Premium product presentation', 'Secure checkout', 'Customer-first support']),
    marketplaceDetails: publicMarketplaceDetails(product),
    seo: {
      title: cleanSourceText(product.seo?.title || `${title} | MAT STORE`),
      description: cleanSourceText(product.seo?.description || description),
      keywords: safeList(product.seo?.keywords, 10),
      images,
      image: images[0] || fallbackImage
    },
    ai: product.ai ? {
      provider: 'MAT STORE intelligence',
      luxuryAngle: 'Premium merchandising, clear product presentation, and trust-focused checkout.',
      lastEnhancedAt: product.ai.lastEnhancedAt || null
    } : undefined
  };
}

function publicCatalogResult(result = {}) {
  return {
    ...result,
    items: (result.items || []).map(publicProduct),
    brands: (result.brands || [])
      .map((brand) => cleanSourceText(brand))
      .filter((brand) => brand && !hasSourceText(brand)),
    marketplaceStats: undefined
  };
}

function publicSuggestion(item = {}) {
  const realImage = publicImages(item)[0] || '';
  return {
    ...item,
    slug: item.id || item.slug,
    title: cleanProductTitle(cleanSourceText(item.title || 'MAT STORE Product')),
    image: realImage,
    supplierName: undefined,
    supplierProductCode: undefined
  };
}

function publicMarketplaceSearchResult(result = {}) {
  return {
    ...result,
    products: (result.products || []).map(publicProduct),
    sources: undefined,
    errors: [],
    publicSummary: result.imported ? `${result.imported} MAT STORE products added.` : 'MAT STORE search updated.'
  };
}

module.exports = {
  publicCatalogResult,
  publicMarketplaceSearchResult,
  publicProduct,
  publicSuggestion
};
