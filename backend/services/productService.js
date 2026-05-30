const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const slugify = require('../utils/slug');
const pricingService = require('./pricingService');
const currencyService = require('./currencyService');
const mediaService = require('./mediaService');
const reviewService = require('./reviewService');
const searchMatch = require('../utils/searchMatch');
const { sanitizeString } = require('../utils/sanitize');
const { cleanProductTitle } = require('../utils/productTitle');
const { hasRealProductMedia, isQuestionableProduct, primaryRealProductMedia } = require('../utils/catalogQuality');
const HttpError = require('../utils/httpError');

function sanitizeImageUrl(value) {
  const clean = sanitizeString(value, 2048);
  if (mediaService.isBlockedStockImageUrl(clean)) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^\/(?:api\/media|assets)\//i.test(clean)) return clean;
  return '';
}

function sanitizeImages(value, existing = []) {
  const nextImages = Array.isArray(value) ? value : existing;
  return nextImages.map(sanitizeImageUrl).filter(Boolean).slice(0, 8);
}

function highQualityDisplayImage(value) {
  const clean = sanitizeImageUrl(value);
  if (!clean) return '';
  if (/^\/api\/media\/image/i.test(clean) || /^https:\/\//i.test(clean)) {
    return mediaService.imageProxyUrl(clean) || clean;
  }
  return clean;
}

function sanitizeList(value, maxItems = 12, maxLength = 180) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeSpecs(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      name: sanitizeString(item?.name || item?.key || '', 80),
      value: sanitizeString(item?.value || '', 180)
    }))
    .filter((item) => item.name && item.value)
    .slice(0, 18);
}

function visibleProductKey(product = {}) {
  const supplier = sanitizeString(product.supplierName || '', 80).toLowerCase();
  const titleKey = sanitizeString(cleanProductTitle(product.title || ''), 220)
    .toLowerCase()
    .replace(/^mat\s+/, '')
    .replace(/\b(?:new|renewed|refurbished|open box|used)\b/g, '')
    .replace(/\b(?:amazon|walmart|aliexpress|ali express|alibaba|ebay|temu)\s+(?:search|goldbox|front page|global deals|marketplace|deals|picks?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
  if (titleKey) return titleKey;
  return `${supplier}:${product.supplierProductCode || product.supplierUrl || product.slug || product.id || titleKey}`;
}

function duplicateKeysFor(product = {}) {
  const supplier = sanitizeString(product.supplierName || '', 120).toLowerCase();
  const supplierCode = sanitizeString(product.supplierProductCode || '', 80).toLowerCase();
  const supplierUrl = sanitizeString(product.supplierUrl || '', 2048).toLowerCase();
  return [
    supplierUrl && `url:${supplierUrl}`,
    supplier && supplierCode && `code:${supplier}:${supplierCode}`,
    visibleProductKey(product) && `visible:${visibleProductKey(product)}`
  ].filter(Boolean);
}

function productQualityScore(product = {}) {
  const title = cleanProductTitle(product.title || '');
  const details = product.marketplaceDetails || {};
  let score = 0;
  if (product.status === 'active') score += 40;
  if (product.images?.length) score += 25;
  if (product.supplierImageUrl) score += 12;
  if (product.imageStatus === 'supplier-image' || product.imageStatus === 'discovered-product-image') score += 18;
  if (product.supplierUrl && !/#mat-search-/i.test(product.supplierUrl)) score += 18;
  if (product.supplierProductCode && !/^mat-search/i.test(product.supplierProductCode)) score += 8;
  if (Number(product.supplierPrice || 0) > 0) score += 8;
  score += Math.min(Number(product.reviewsCount || details.reviews?.count || 0), 5000) / 250;
  score += Number(product.rating || details.reviews?.rating || 0);
  score += Math.min(title.length, 140) / 20;
  if (/\b(?:product|deal|search pick|search match)\b/i.test(title)) score -= 30;
  if (/#mat-search-/i.test(product.supplierUrl || '')) score -= 10;
  return score;
}

function isGeneratedCategoryProduct(product = {}) {
  const title = cleanProductTitle(product.title || '');
  const genericTitle = /^(?:Trending Products|Electronics|Fashion|Gadgets|Accessories|Shoes|Beauty|Premium Picks?)(?:\s+(?:Pro|Plus|New Arrival|Bundle|Set|Standard|Portable|Store Pick|Top Rated|Value Deal))?$/i.test(title);
  const generatedCode = /^(?:amazon|walmart|temu|alibaba|aliexpress|ebay)-(?:trending-products|electronics|fashion|gadgets|accessories|shoes|beauty|premium-picks?)-\d+$/i.test(product.supplierProductCode || '');
  const generatedUrl = /#mat-(?:search|walmart)-\d+/i.test(product.supplierUrl || '');
  return genericTitle && (generatedCode || generatedUrl);
}

function isWeakProductImage(product = {}) {
  const imageText = [product.imageStatus, product.imageSource, product.images?.[0]].filter(Boolean).join(' ');
  return !product.images?.length
    || /curated-photo-fallback|generated-fallback|representative|fallback/i.test(imageText)
    || mediaService.isBlockedStockImageUrl(imageText)
    || mediaService.isGeneratedFallbackUrl(product.images?.[0] || '');
}

function dedupeVisibleProducts(products = []) {
  const seen = new Set();
  const unique = [];
  for (const product of products) {
    const key = visibleProductKey(product);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(product);
  }
  return unique;
}

function trendScore(product = {}) {
  const details = product.marketplaceDetails || {};
  const text = [
    product.title,
    product.category,
    product.collection,
    details.badge,
    details.boughtInPastMonth,
    ...(product.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
  const reviews = Math.min(Number(product.reviewsCount || details.reviews?.count || 0), 20000);
  const rating = Number(product.rating || details.reviews?.rating || 4.8);
  const updatedAgeHours = Math.max(1, (Date.now() - new Date(product.updatedAt || product.createdAt || Date.now()).getTime()) / 36e5);
  let score = reviews / 160 + rating * 16 + Math.max(0, 80 - updatedAgeHours / 12);
  if (/\b(trending|popular|best seller|amazon's choice|choice|deal|goldbox|front page|global deals|new arrival|customer favorite)\b/i.test(text)) score += 95;
  if (/\b(iphone|galaxy|laptop|tv|smartwatch|headphone|ssd|gaming|speaker|tablet|camera|shoe|beauty)\b/i.test(text)) score += 35;
  if (Number(product.stock || 0) > 0) score += 18;
  if (product.images?.length || product.supplierImageUrl || product.fallbackImage) score += 12;
  if (product.pricingPlan?.protected) score += 8;
  return Math.round(score * 100) / 100;
}

function isTrendingRequest(query = {}) {
  return ['true', '1', 'yes', 'trending'].includes(String(query.trending || query.feed || '').toLowerCase());
}

function normalizedCategory(value = '') {
  return sanitizeString(value, 80)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productSearchText(product = {}) {
  const details = product.marketplaceDetails || {};
  return [
    product.title,
    product.description,
    product.shortDescription,
    product.category,
    product.collection,
    details.brand,
    details.badge,
    ...(product.tags || []),
    ...(product.features || []),
    ...(details.about || []),
    ...(details.specs || []).flatMap((spec) => [spec.name, spec.value])
  ].filter(Boolean).join(' ').toLowerCase();
}

function isSmartphoneCategory(category = '') {
  return [
    'smartphones',
    'smartphone',
    'smart phones',
    'smart phone',
    'mobile phones',
    'mobile phone',
    'cell phones',
    'cell phone',
    'phones',
    'phone'
  ].includes(normalizedCategory(category));
}

function isSmartphoneProduct(product = {}) {
  const titleText = [
    product.title,
    product.shortDescription,
    product.category,
    product.collection,
    ...(product.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
  const fullText = productSearchText(product);
  const accessoryPattern = /\b(?:case|cover|protector|charger|charging|cable|usb|flash\s*drive|thumb\s*drive|memory\s*card|sd\s*card|screen\s*protector|tempered\s*glass|lens\s*protector|holder|mount|strap|adapter|remote|gimbal|stabilizer|tripod|stand|dock|wallet|repair\s*part|lcd\s*screen|screen\s*assembly)\b/i;
  if (accessoryPattern.test(titleText)) return false;
  if (isSmartphoneCategory(product.category)) return true;
  return /\b(?:iphone|galaxy|pixel|smartphones?|smart\s*phones?|android\s*(?:smart\s*)?phones?|mobile\s*phones?|cell\s*phones?|unlocked\s*phones?|rugged\s*phones?|oneplus|xiaomi|redmi|vivo|oppo|honor|realme|motorola|moto\s*(?:g|razr)|nothing\s*phone|nokia\s*phone|mini\s*phone)\b/i.test(fullText);
}

function categoryMatchesProduct(category = '', product = {}) {
  const selected = normalizedCategory(category);
  if (!selected || selected === 'all') return true;
  if (isSmartphoneCategory(selected)) return isSmartphoneProduct(product);
  if (normalizedCategory(product.category) === selected) return true;
  return false;
}

function duplicateIndexFor(products, product) {
  return products.findIndex((existing) => {
    const sameSupplier = String(existing.supplierName || '').toLowerCase() === String(product.supplierName || '').toLowerCase();
    const sameSupplierCode = sameSupplier && product.supplierProductCode && existing.supplierProductCode === product.supplierProductCode;
    const sameSupplierUrl = product.supplierUrl && existing.supplierUrl === product.supplierUrl;
    const sameVisibleProduct = visibleProductKey(existing) === visibleProductKey(product);
    return sameSupplierCode || sameSupplierUrl || sameVisibleProduct;
  });
}

function normalizeMarketplaceDetails(value = {}, product = {}) {
  const details = value || {};
  return {
    brand: sanitizeString(details.brand || product.supplierName || '', 120),
    availability: sanitizeString(details.availability || (Number(product.stock || 0) > 0 ? 'In stock' : 'Stock pending'), 120),
    seller: sanitizeString(details.seller || product.supplierName || 'MAT STORE', 120),
    shipper: sanitizeString(details.shipper || details.seller || product.supplierName || 'MAT STORE', 120),
    returns: sanitizeString(details.returns || '30-day refund / replacement review', 180),
    payment: sanitizeString(details.payment || 'Secure transaction', 120),
    delivery: sanitizeString(details.delivery || 'Delivery calculated at checkout', 180),
    shipping: sanitizeString(details.shipping || 'Shipping and import charges calculated at checkout', 180),
    boughtInPastMonth: sanitizeString(details.boughtInPastMonth || '', 120),
    badge: sanitizeString(details.badge || '', 80),
    listPrice: Number.isFinite(Number(details.listPrice)) ? Number(details.listPrice) : null,
    savingsPercent: Number.isFinite(Number(details.savingsPercent)) ? Number(details.savingsPercent) : null,
    about: sanitizeList(details.about || product.features, 10, 220),
    specs: sanitizeSpecs(details.specs),
    buyingOptions: sanitizeList(details.buyingOptions, 8, 160),
    videos: {
      count: Math.max(0, Math.floor(Number(details.videos?.count || details.videoCount || 0))),
      label: sanitizeString(details.videos?.label || details.videoLabel || '', 120)
    },
    reviews: {
      rating: Number(details.reviews?.rating || product.rating || 4.8),
      count: Math.max(0, Math.floor(Number(details.reviews?.count || product.reviewsCount || 0))),
      summary: sanitizeString(details.reviews?.summary || '', 360)
    },
    sourceSections: sanitizeList(details.sourceSections, 8, 80)
  };
}

function normalizePricingPlan(value = {}, product = {}) {
  const grossProfit = Number.isFinite(Number(value.grossProfit))
    ? Number(value.grossProfit)
    : Number(product.price || 0) - Number(product.supplierPrice || 0);
  const marginPercent = Number.isFinite(Number(value.marginPercent))
    ? Number(value.marginPercent)
    : Number(product.price || 0) > 0
      ? (grossProfit / Number(product.price || 1)) * 100
      : 0;
  return {
    supplierPrice: Number(value.supplierPrice ?? product.supplierPrice ?? 0),
    price: Number(value.price ?? product.price ?? 0),
    minStorePrice: Number(value.minStorePrice ?? product.price ?? 0),
    requestedMarkupPercent: Number(value.requestedMarkupPercent ?? product.markupPercent ?? 40),
    appliedMarkupPercent: Number(value.appliedMarkupPercent ?? product.markupPercent ?? 40),
    grossProfit: Math.round(grossProfit * 100) / 100,
    marginPercent: Math.round(marginPercent * 10) / 10,
    paymentBuffer: Number(value.paymentBuffer ?? 0),
    riskBuffer: Number(value.riskBuffer ?? 0),
    fixedMargin: Number(value.fixedMargin ?? 0),
    strategy: sanitizeString(value.strategy || 'MAT AI smart pricing', 120),
    tier: sanitizeString(value.tier || '', 80),
    businessRule: sanitizeString(value.businessRule || '', 120),
    hardToFind: Boolean(value.hardToFind),
    scarcityScore: Number(value.scarcityScore ?? 0),
    scarcityReasons: sanitizeList(value.scarcityReasons, 4, 140),
    demandSignal: Number(value.demandSignal ?? 0),
    protected: value.protected !== false,
    manualPricePreserved: Boolean(value.manualPricePreserved),
    adjusted: Boolean(value.adjusted),
    notes: sanitizeList(value.notes, 5, 160)
  };
}

function productWithFallbackImage(product) {
  const imageMetadata = { ...product, title: cleanProductTitle(product.title || 'MAT STORE Product') };
  const primaryRealImage = primaryRealProductMedia(product);
  const representativeImage = mediaService.representativeProductImageUrl(imageMetadata);
  const fallbackImage = primaryRealImage || (product.fallbackImage && !mediaService.isGeneratedFallbackUrl(product.fallbackImage)
    ? product.fallbackImage
    : representativeImage || mediaService.fallbackImageUrl(imageMetadata));
  const sourceImages = Array.isArray(product.images) && product.images.length ? product.images : [primaryRealImage || representativeImage];
  const images = sourceImages
    .map((image) => (mediaService.isGeneratedFallbackUrl(image) ? representativeImage : highQualityDisplayImage(image)))
    .filter(Boolean);
  const supplierImageUrl = mediaService.highQualityImageUrl(product.supplierImageUrl || '') || product.supplierImageUrl || '';
  return {
    ...product,
    images: images.length ? images : [representativeImage || fallbackImage],
    supplierImageUrl,
    fallbackImage,
    marketplaceDetails: normalizeMarketplaceDetails(product.marketplaceDetails, product)
  };
}

function normalizeProduct(payload, existing = {}) {
  const title = sanitizeString(cleanProductTitle(payload.title || existing.title), 180);
  if (!title) throw new HttpError(400, 'Product title is required.');

  const supplierPrice = Number(payload.supplierPrice ?? existing.supplierPrice ?? payload.price ?? existing.price ?? 0);
  const price = Number(payload.price ?? existing.price ?? supplierPrice);
  const stock = Math.max(0, Math.floor(Number(payload.stock ?? existing.stock ?? 0)));
  const requestedStatus = sanitizeString(payload.status || existing.status || 'active', 40);
  const status = requestedStatus === 'active' && isQuestionableProduct({ ...existing, ...payload, title })
    ? 'draft'
    : requestedStatus;

  return {
    ...existing,
    id: existing.id || randomUUID(),
    sku: sanitizeString(payload.sku || existing.sku || `MAT-${Date.now().toString(36).toUpperCase()}`, 60),
    title,
    slug: slugify(payload.slug || title),
    description: sanitizeString(payload.description || existing.description || '', 5000),
    shortDescription: sanitizeString(payload.shortDescription || existing.shortDescription || '', 500),
    category: sanitizeString(payload.category || existing.category || 'trending products', 80).toLowerCase(),
    collection: sanitizeString(payload.collection || existing.collection || 'MAT Signature', 80),
    supplierUrl: sanitizeString(payload.supplierUrl || existing.supplierUrl || '', 2048),
    supplierName: sanitizeString(payload.supplierName || existing.supplierName || '', 120),
    supplierProductCode: sanitizeString(payload.supplierProductCode || existing.supplierProductCode || '', 80),
    supplierPrice,
    price,
    currency: 'USD',
    markupPercent: Number(payload.markupPercent ?? existing.markupPercent ?? 40),
    stock,
    lowStockThreshold: Math.max(1, Math.floor(Number(payload.lowStockThreshold ?? existing.lowStockThreshold ?? 6))),
    status,
    images: sanitizeImages(payload.images, existing.images || []),
    supplierImageUrl: sanitizeImageUrl(payload.supplierImageUrl || existing.supplierImageUrl || ''),
    fallbackImage: sanitizeImageUrl(payload.fallbackImage || existing.fallbackImage || ''),
    imageStatus: sanitizeString(payload.imageStatus || existing.imageStatus || '', 60),
    imageSource: sanitizeString(payload.imageSource || existing.imageSource || '', 160),
    mediaConfidence: sanitizeString(payload.mediaConfidence || existing.mediaConfidence || '', 40),
    imageCandidateCount: Math.max(0, Math.floor(Number(payload.imageCandidateCount ?? existing.imageCandidateCount ?? 0))),
    variants: Array.isArray(payload.variants) ? payload.variants.slice(0, 20) : existing.variants || [],
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => sanitizeString(tag, 40)).filter(Boolean).slice(0, 16) : existing.tags || [],
    features: Array.isArray(payload.features)
      ? payload.features.map((feature) => sanitizeString(feature, 160)).filter(Boolean).slice(0, 8)
      : existing.features || [],
    rating: Number(payload.rating ?? existing.rating ?? 4.8),
    reviewsCount: Math.max(0, Math.floor(Number(payload.reviewsCount ?? existing.reviewsCount ?? 0))),
    pricingPlan: normalizePricingPlan(payload.pricingPlan || existing.pricingPlan, {
      ...existing,
      ...payload,
      supplierPrice,
      price
    }),
    seo: {
      title: sanitizeString(payload.seo?.title || existing.seo?.title || `${title} | MAT STORE`, 160),
      description: sanitizeString(payload.seo?.description || existing.seo?.description || '', 220),
      keywords: Array.isArray(payload.seo?.keywords) ? payload.seo.keywords.slice(0, 12) : existing.seo?.keywords || []
    },
    marketplaceDetails: normalizeMarketplaceDetails(payload.marketplaceDetails || existing.marketplaceDetails, {
      ...existing,
      ...payload,
      title,
      supplierPrice,
      price,
      stock
    }),
    ai: {
      provider: payload.ai?.provider || existing.ai?.provider || 'manual',
      luxuryAngle: sanitizeString(payload.ai?.luxuryAngle || existing.ai?.luxuryAngle || '', 500),
      lastEnhancedAt: payload.ai?.lastEnhancedAt || existing.ai?.lastEnhancedAt || null
    },
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function productForCurrency(product, currency = 'USD') {
  const productWithImage = productWithFallbackImage(product);
  const convertedPrice = currencyService.convertFromUsd(product.price, currency);
  const convertedSupplierPrice = currencyService.convertFromUsd(product.supplierPrice, currency);
  return {
    ...productWithImage,
    title: cleanProductTitle(productWithImage.title),
    displayCurrency: currency,
    displayPrice: convertedPrice,
    displaySupplierPrice: convertedSupplierPrice,
    formattedPrice: currencyService.formatMoney(convertedPrice, currency)
  };
}

async function listProducts(query = {}) {
  const products = await store.read('products');
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(1200, Math.max(1, Number(query.limit || 24)));
  const currency = String(query.currency || 'USD').toUpperCase();
  const search = sanitizeString(query.q || '', 120).toLowerCase();
  const category = sanitizeString(query.category || '', 80).toLowerCase();
  const minPrice = query.minPrice ? Number(query.minPrice) : null;
  const maxPrice = query.maxPrice ? Number(query.maxPrice) : null;
  const minRating = query.minRating ? Number(query.minRating) : null;
  const inStock = ['true', '1', 'yes', 'on'].includes(String(query.inStock || '').toLowerCase());
  const brand = sanitizeString(query.brand || '', 120).toLowerCase();
  const trending = isTrendingRequest(query);
  const includeDrafts = ['true', '1', 'yes', 'on'].includes(String(query.includeDrafts || '').toLowerCase());

  let filtered = products.filter((product) => (
    includeDrafts
      ? product.status !== 'archived'
      : product.status === 'active' && hasRealProductMedia(product) && !isQuestionableProduct(product)
  ));
  let scoredSearchProducts = null;
  if (search) {
    scoredSearchProducts = filtered
      .map((product) => ({ product, search: searchMatch.scoreProduct(search, product) }))
      .filter((entry) => entry.search.relevant);
    filtered = scoredSearchProducts.map((entry) => entry.product);
  }
  if (category && category !== 'all' && !(trending && category === 'trending products')) filtered = filtered.filter((product) => categoryMatchesProduct(category, product));
  if (minPrice !== null) filtered = filtered.filter((product) => product.price >= minPrice);
  if (maxPrice !== null) filtered = filtered.filter((product) => product.price <= maxPrice);
  if (minRating !== null) filtered = filtered.filter((product) => Number(product.rating || 0) >= minRating);
  if (inStock) filtered = filtered.filter((product) => Number(product.stock || 0) > 0);
  if (brand) filtered = filtered.filter((product) => productSearchText(product).includes(brand));

  const sort = query.sort || 'featured';
  const compareProducts = (a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'rating') return b.rating - a.rating;
    return (b.reviewsCount + b.rating) - (a.reviewsCount + a.rating);
  };

  if (trending && sort === 'featured') {
    filtered = filtered.sort((a, b) => trendScore(b) - trendScore(a) || compareProducts(a, b));
  } else if (search && scoredSearchProducts) {
    const scoreById = new Map(scoredSearchProducts.map((entry) => [entry.product.id, entry.search.score]));
    filtered = filtered.sort((a, b) => (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0) || compareProducts(a, b));
  } else {
    filtered = filtered.sort(compareProducts);
  }

  filtered = dedupeVisibleProducts(filtered);

  const total = filtered.length;
  const items = filtered.slice((page - 1) * limit, page * limit).map((product) => productForCurrency(product, currency));
  const categories = [...new Set(products.map((product) => product.category))].sort();
  const brands = [...new Set(products
    .map((product) => product.marketplaceDetails?.brand || product.supplierName || '')
    .map((value) => sanitizeString(value, 120))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    categories,
    brands
  };
}

async function getProduct(idOrSlug, currency = 'USD') {
  const products = await store.read('products');
  const product = products.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
  if (!product) throw new HttpError(404, 'Product not found.');

  const related = products
    .filter((item) => item.status === 'active' && hasRealProductMedia(item) && item.id !== product.id && (item.category === product.category || item.collection === product.collection))
    .slice(0, 6)
    .map((item) => productForCurrency(item, currency));

  const reviews = await reviewService.listProductReviews(product.id, { limit: 12 });
  let reviewSummary = await reviewService.productReviewSummary(product.id);
  if (Number(product.reviewsCount || 0) > Number(reviewSummary.count || 0)) {
    reviewSummary = {
      ...reviewSummary,
      rating: Number(product.rating || product.marketplaceDetails?.reviews?.rating || 0),
      count: Math.max(0, Math.floor(Number(product.reviewsCount || product.marketplaceDetails?.reviews?.count || 0)))
    };
  }

  return {
    ...productForCurrency(product, currency),
    related,
    reviews,
    reviewSummary
  };
}

async function createProduct(payload) {
  const settings = await pricingService.getPricingSettings();
  const pricedPayload = pricingService.applySmartPricing(payload, settings, { preserveManualPrice: true });
  const product = normalizeProduct(pricedPayload);
  let saved = product;
  await store.update('products', (products) => {
    const duplicateIndex = duplicateIndexFor(products, product);
    if (duplicateIndex < 0) return [product, ...products];

    const duplicatePayload = pricingService.applySmartPricing(
      { ...products[duplicateIndex], ...payload },
      settings,
      { preserveManualPrice: true }
    );
    saved = normalizeProduct(duplicatePayload, products[duplicateIndex]);
    return products.map((existing, index) => (index === duplicateIndex ? saved : existing));
  });
  return saved;
}

async function createProducts(payloads = []) {
  const settings = await pricingService.getPricingSettings();
  const normalized = await Promise.all(
    payloads.map(async (payload) => {
      const pricedPayload = pricingService.applySmartPricing(payload, settings, { preserveManualPrice: true });
      return { payload: pricedPayload, product: normalizeProduct(pricedPayload) };
    })
  );
  const saved = [];
  await store.update('products', (products) => {
    let nextProducts = [...products];
    for (const item of normalized) {
      const duplicateIndex = duplicateIndexFor(nextProducts, item.product);
      if (duplicateIndex < 0) {
        nextProducts = [item.product, ...nextProducts];
        saved.push(item.product);
      } else {
        const duplicatePayload = pricingService.applySmartPricing(
          { ...nextProducts[duplicateIndex], ...item.payload },
          settings,
          { preserveManualPrice: true }
        );
        const updated = normalizeProduct(duplicatePayload, nextProducts[duplicateIndex]);
        nextProducts[duplicateIndex] = updated;
        saved.push(updated);
      }
    }
    return nextProducts;
  });
  return saved;
}

async function updateProduct(id, payload) {
  const settings = await pricingService.getPricingSettings();
  let updated;
  await store.update('products', (products) =>
    products.map((product) => {
      if (product.id !== id) return product;
      const pricedPayload = pricingService.applySmartPricing(
        { ...product, ...payload },
        settings,
        { preserveManualPrice: true }
      );
      updated = normalizeProduct(pricedPayload, product);
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'Product not found.');
  return updated;
}

async function deleteProduct(id) {
  let removed = false;
  await store.update('products', (products) => products.filter((product) => {
    if (product.id !== id) return true;
    removed = true;
    return false;
  }));
  if (!removed) throw new HttpError(404, 'Product not found.');
  return { success: true, deleted: true };
}

async function bulkMarkup(markupPercent) {
  let updatedProducts = [];
  await store.update('products', async (products) => {
    updatedProducts = (await pricingService.bulkMarkup(products, markupPercent)).map((product) => normalizeProduct(product, product));
    return updatedProducts;
  });
  return updatedProducts;
}

async function repairPricing(options = {}) {
  const settings = await pricingService.getPricingSettings();
  const markupPercent = Number.isFinite(Number(options.markupPercent)) ? Number(options.markupPercent) : undefined;
  let result = {
    total: 0,
    updated: 0,
    protected: 0,
    marginValueBefore: 0,
    marginValueAfter: 0,
    changedProducts: []
  };

  await store.update('products', (products) => {
    const nextProducts = products.map((product) => {
      const beforeProfit = Number(product.price || 0) - Number(product.supplierPrice || 0);
      const pricedPayload = pricingService.applySmartPricing(
        {
          ...product,
          ...(markupPercent ? { markupPercent } : {})
        },
        settings,
        { preserveManualPrice: false }
      );
      const nextProduct = normalizeProduct(pricedPayload, product);
      const changed = Math.abs(Number(nextProduct.price || 0) - Number(product.price || 0)) >= 0.01
        || Math.abs(Number(nextProduct.supplierPrice || 0) - Number(product.supplierPrice || 0)) >= 0.01;
      const afterProfit = Number(nextProduct.price || 0) - Number(nextProduct.supplierPrice || 0);
      result.marginValueBefore += beforeProfit * Number(product.stock || 0);
      result.marginValueAfter += afterProfit * Number(nextProduct.stock || 0);
      if (nextProduct.pricingPlan?.protected) result.protected += 1;
      if (changed) {
        result.updated += 1;
        if (result.changedProducts.length < 30) {
          result.changedProducts.push({
            id: nextProduct.id,
            title: cleanProductTitle(nextProduct.title),
            supplierName: nextProduct.supplierName,
            oldPrice: Number(product.price || 0),
            newPrice: nextProduct.price,
            supplierPrice: nextProduct.supplierPrice,
            grossProfit: nextProduct.pricingPlan?.grossProfit || afterProfit,
            strategy: nextProduct.pricingPlan?.strategy || 'MAT AI smart pricing'
          });
        }
      }
      return nextProduct;
    });
    result.total = products.length;
    result.marginValueBefore = Math.round(result.marginValueBefore * 100) / 100;
    result.marginValueAfter = Math.round(result.marginValueAfter * 100) / 100;
    return nextProducts;
  });

  return result;
}

async function repairImages(options = {}) {
  const limit = Math.min(250, Math.max(1, Math.floor(Number(options.limit || 80))));
  let result = {
    total: 0,
    checked: 0,
    repaired: 0,
    removed: 0,
    unresolved: 0,
    repairedProducts: [],
    removedProducts: []
  };

  await store.update('products', async (products) => {
    result.total = products.length;
    const nextProducts = [];
    for (const product of products) {
      if (isGeneratedCategoryProduct(product)) {
        result.removed += 1;
        if (result.removedProducts.length < 50) {
          result.removedProducts.push({
            id: product.id,
            title: cleanProductTitle(product.title),
            supplierName: product.supplierName,
            imageStatus: product.imageStatus
          });
        }
        continue;
      }

      if (!isWeakProductImage(product) || result.checked >= limit) {
        nextProducts.push(product);
        continue;
      }

      result.checked += 1;
      const media = await mediaService.resolveBestProductImage('', {
        ...product,
        title: cleanProductTitle(product.title),
        category: product.category,
        collection: product.collection,
        tags: product.tags || [],
        features: product.features || []
      });

      if (media.image && media.imageStatus !== 'curated-photo-fallback') {
        const updated = normalizeProduct({
          ...product,
          ...media,
          images: [media.image],
          fallbackImage: media.fallbackImage,
          supplierImageUrl: media.supplierImageUrl || product.supplierImageUrl || ''
        }, product);
        result.repaired += 1;
        if (result.repairedProducts.length < 50) {
          result.repairedProducts.push({
            id: updated.id,
            title: cleanProductTitle(updated.title),
            imageStatus: updated.imageStatus
          });
        }
        nextProducts.push(updated);
      } else {
        result.unresolved += 1;
        nextProducts.push(product);
      }
    }
    return nextProducts;
  });

  return result;
}

async function adjustInventory(productId, delta) {
  let updated;
  await store.update('products', (products) =>
    products.map((product) => {
      if (product.id !== productId) return product;
      updated = {
        ...product,
        stock: Math.max(0, Number(product.stock || 0) + Number(delta || 0)),
        updatedAt: new Date().toISOString()
      };
      return updated;
    })
  );
  if (!updated) throw new HttpError(404, 'Product not found.');
  return updated;
}

async function lowStockProducts() {
  const products = await store.read('products');
  return products.filter((product) => product.status === 'active' && product.stock <= product.lowStockThreshold);
}

function summarizeProductGroup(products, labelKey, fallbackLabel) {
  const groups = new Map();
  for (const product of products) {
    const label = sanitizeString(product[labelKey] || fallbackLabel, 120) || fallbackLabel;
    const current = groups.get(label) || {
      label,
      count: 0,
      active: 0,
      stock: 0,
      retailValue: 0,
      inventoryValue: 0
    };
    const stock = Number(product.stock || 0);
    current.count += 1;
    current.active += product.status === 'active' ? 1 : 0;
    current.stock += stock;
    current.retailValue += Number(product.price || 0) * stock;
    current.inventoryValue += Number(product.supplierPrice || 0) * stock;
    groups.set(label, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.retailValue - a.retailValue);
}

function buildCatalogHealth(products = []) {
  const activeProducts = products.filter((product) => product.status === 'active');
  const archivedProducts = products.filter((product) => product.status === 'archived');
  const statusStats = products.reduce((stats, product) => {
    const status = sanitizeString(product.status || 'draft', 40);
    stats[status] = (stats[status] || 0) + 1;
    return stats;
  }, {});
  const seenDuplicateKeys = new Set();
  let duplicateCount = 0;
  let withImages = 0;
  let fallbackOnly = 0;
  let underpricedCount = 0;
  let protectedPricingCount = 0;
  let hardToFindPricedCount = 0;
  let missingSupplierCost = 0;

  for (const product of products) {
    const keys = duplicateKeysFor(product);
    if (keys.some((key) => seenDuplicateKeys.has(key))) duplicateCount += 1;
    keys.forEach((key) => seenDuplicateKeys.add(key));

    if (product.images?.[0] || product.supplierImageUrl) withImages += 1;
    else if (product.fallbackImage) fallbackOnly += 1;

    const supplierPrice = Number(product.supplierPrice || 0);
    const price = Number(product.price || 0);
    if (!supplierPrice) missingSupplierCost += 1;
    if (supplierPrice > 0 && price <= supplierPrice) underpricedCount += 1;
    if (product.pricingPlan?.protected) protectedPricingCount += 1;
    if (product.pricingPlan?.hardToFind) hardToFindPricedCount += 1;
  }

  const inventoryValue = products.reduce((sum, product) => sum + Number(product.supplierPrice || 0) * Number(product.stock || 0), 0);
  const retailValue = products.reduce((sum, product) => sum + Number(product.price || 0) * Number(product.stock || 0), 0);
  const recentProducts = [...products]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 8)
    .map((product) => ({
      id: product.id,
      title: cleanProductTitle(product.title),
      slug: product.slug,
      category: product.category,
      collection: product.collection,
      supplierName: product.supplierName,
      price: product.price,
      stock: product.stock,
      status: product.status,
      image: product.images?.[0] || product.supplierImageUrl || product.fallbackImage || mediaService.fallbackImageUrl(product)
    }));

  return {
    totalProducts: products.length,
    activeProducts: activeProducts.length,
    archivedProducts: archivedProducts.length,
    duplicateCount,
    inventoryValue,
    retailValue,
    marginValue: retailValue - inventoryValue,
    pricingHealth: {
      protected: protectedPricingCount,
      hardToFind: hardToFindPricedCount,
      underpriced: underpricedCount,
      missingSupplierCost,
      profitReady: Math.max(0, products.length - underpricedCount - missingSupplierCost)
    },
    imageHealth: {
      total: products.length,
      withImages,
      fallbackOnly,
      missingImages: Math.max(0, products.length - withImages - fallbackOnly)
    },
    statusStats,
    collectionStats: summarizeProductGroup(products, 'collection', 'MAT Signature'),
    marketplaceStats: summarizeProductGroup(products, 'supplierName', 'MAT STORE'),
    recentProducts
  };
}

async function catalogHealth(productsInput) {
  const products = Array.isArray(productsInput) ? productsInput : await store.read('products');
  return buildCatalogHealth(products);
}

async function cleanupDuplicates() {
  let result = { before: 0, after: 0, removed: 0, removedProducts: [] };
  await store.update('products', (products) => {
    const seenKeyToIndex = new Map();
    const unique = [];
    const removedProducts = [];
    for (const product of products) {
      const keys = duplicateKeysFor(product);
      const duplicateIndexes = [...new Set(keys.map((key) => seenKeyToIndex.get(key)).filter((index) => index !== undefined))];
      if (duplicateIndexes.length) {
        const keepIndex = duplicateIndexes[0];
        const kept = unique[keepIndex];
        const productIsBetter = productQualityScore(product) > productQualityScore(kept);
        const removed = productIsBetter ? kept : product;
        removedProducts.push({
          id: removed.id,
          title: cleanProductTitle(removed.title),
          supplierName: removed.supplierName,
          supplierProductCode: removed.supplierProductCode
        });
        if (productIsBetter) {
          unique[keepIndex] = product;
          keys.forEach((key) => seenKeyToIndex.set(key, keepIndex));
        }
        continue;
      }
      const nextIndex = unique.length;
      keys.forEach((key) => seenKeyToIndex.set(key, nextIndex));
      unique.push(product);
    }
    result = {
      before: products.length,
      after: unique.length,
      removed: removedProducts.length,
      removedProducts: removedProducts.slice(0, 50)
    };
    return unique;
  });
  return result;
}

async function searchSuggestions(q) {
  const products = await store.read('products');
  const search = sanitizeString(q, 80).toLowerCase();
  if (!search) return [];
  return products
    .map((product) => ({ product, search: searchMatch.scoreProduct(search, product) }))
    .filter((entry) => entry.product.status === 'active' && hasRealProductMedia(entry.product) && !isQuestionableProduct(entry.product) && entry.search.relevant)
    .sort((a, b) => b.search.score - a.search.score)
    .filter((entry, index, entries) => entries.findIndex((candidate) => visibleProductKey(candidate.product) === visibleProductKey(entry.product)) === index)
    .slice(0, 8)
    .map(({ product }) => ({
      id: product.id,
      title: cleanProductTitle(product.title),
      category: product.category,
      image: product.images?.[0] || product.fallbackImage || mediaService.fallbackImageUrl(product),
      price: product.price
    }));
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  createProducts,
  updateProduct,
  deleteProduct,
  bulkMarkup,
  repairPricing,
  repairImages,
  adjustInventory,
  lowStockProducts,
  catalogHealth,
  cleanupDuplicates,
  searchSuggestions,
  productForCurrency
};
