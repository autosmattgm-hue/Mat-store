const { cleanProductTitle, formatBrandTitle } = require('./productTitle');

const SOURCE_PATTERN = /\b(?:amazon(?:\.com)?|walmart|aliexpress|ali\s*express|alibaba|ebay|temu|supplier|marketplace|seller|shipper|fulfillment|source)\b/i;
const SOURCE_LABEL_PATTERN = /^(?:marketplace|supplier(?:\s+(?:code|list\s+price|search\s+url|price|cost))?|source|seller|shipper|fulfillment|image\s+override)$/i;

function cleanSourceText(value = '') {
  return String(value || '')
    .replace(/\bAmazon\.com\s*:\s*/gi, '')
    .replace(/\b(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)\s+(?:Search|Goldbox|Front Page|Global Deals|Marketplace|Deals|Picks?)\s*:?\s*/gi, '')
    .replace(/\b(?:from|via|on|at)\s+(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)(?:\.com)?\b/gi, '')
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

function publicFallbackImage(product = {}) {
  const params = new URLSearchParams({
    title: cleanProductTitle(cleanSourceText(product.title || 'MAT STORE Product')),
    marketplace: 'MAT STORE',
    code: '',
    category: product.category || 'premium pick'
  });
  return `/api/media/fallback?${params.toString()}`;
}

function publicImages(product = {}) {
  const fallback = publicFallbackImage(product);
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  if (!images.length || !product.id) return [fallback];
  return images.map((_, index) => `/api/media/product/${encodeURIComponent(product.id)}/${index}`);
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

function publicProduct(product = {}) {
  const title = cleanProductTitle(cleanSourceText(product.title || 'MAT STORE Product'));
  const description = publicDescription({ ...product, title });
  const shortDescription = cleanSourceText(product.shortDescription || '');
  return {
    ...product,
    slug: product.id || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title,
    description,
    shortDescription: shortDescription && !hasSourceText(shortDescription)
      ? shortDescription
      : `${publicCategoryLabel(product.category)} selected for secure MAT STORE checkout.`,
    collection: publicCollection(product),
    images: publicImages(product),
    fallbackImage: publicFallbackImage(product),
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
    createdAt: undefined,
    updatedAt: undefined,
    variants: publicVariants(product),
    tags: safeList(product.tags, 10),
    features: safeList(product.features, 8, ['Premium product presentation', 'Secure checkout', 'Customer-first support']),
    marketplaceDetails: publicMarketplaceDetails(product),
    seo: {
      ...(product.seo || {}),
      title: cleanSourceText(product.seo?.title || `${title} | MAT STORE`),
      description: cleanSourceText(product.seo?.description || description),
      keywords: safeList(product.seo?.keywords, 10)
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
  return {
    ...item,
    slug: item.id || item.slug,
    title: cleanProductTitle(cleanSourceText(item.title || 'MAT STORE Product')),
    image: item.image || publicFallbackImage(item),
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
