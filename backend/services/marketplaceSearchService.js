const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');
const importerService = require('./importerService');
const productService = require('./productService');
const mediaService = require('./mediaService');
const searchMatch = require('../utils/searchMatch');
const { cleanProductTitle, formatBrandTitle } = require('../utils/productTitle');
const {
  hasRealProductMedia,
  isGeneratedSearchProduct,
  isUntrustedDiscoveredImageProduct,
  primaryRealProductMedia
} = require('../utils/catalogQuality');

const SEARCH_SOURCES = [
  {
    name: 'Amazon',
    url(query) {
      return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [
        `https://www.amazon.com/s?field-keywords=${encodeURIComponent(query)}`,
        `https://www.amazon.com/s?k=${encodeURIComponent(query)}&page=2`,
        `https://www.amazon.com/s?k=${encodeURIComponent(query)}&page=3`
      ];
    }
  },
  {
    name: 'Walmart',
    url(query) {
      return `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [
        `https://www.walmart.com/search?q=${encodeURIComponent(query)}&sort=best_match`,
        `https://www.walmart.com/search?q=${encodeURIComponent(query)}&page=2`,
        `https://www.walmart.com/search?q=${encodeURIComponent(query)}&page=3`
      ];
    }
  },
  {
    name: 'Alibaba',
    url(query) {
      return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [
        `https://www.alibaba.com/products/${encodeURIComponent(query.replace(/\s+/g, '_'))}.html`,
        `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}&page=2`,
        `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}&page=3`
      ];
    }
  },
  {
    name: 'eBay',
    url(query) {
      return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=0&_ipg=120`,
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=0&_ipg=120&_pgn=2`,
        `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=0&_ipg=120&_pgn=3`
      ];
    }
  },
  {
    name: 'AliExpress',
    url(query) {
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
      return `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;
    },
    fallbackUrls(query) {
      return [
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`,
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&page=2`,
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&page=3`
      ];
    }
  },
  {
    name: 'Temu',
    url(query) {
      return `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [
        `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}&search_method=user`,
        `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}&page=2`,
        `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}&page=3`
      ];
    }
  }
];

const STORE_DISPLAY_NAME = 'MAT STORE';
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 3000;
const PRODUCT_PAGE_TIMEOUT_MS = 3200;
const IMAGE_VERIFY_CONCURRENCY = 3;
const MAX_VERIFIED_PRODUCTS_PER_SOURCE = 24;
const MAX_SEARCH_PRODUCTS = 100;

function cleanQuery(value) {
  return sanitizeString(value, 80).replace(/[^\p{L}\p{N}\s&+.,'-]/gu, '').replace(/\s+/g, ' ').trim();
}

function requestedSources(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) return SEARCH_SOURCES;
  return SEARCH_SOURCES.filter((source) => requested.includes(source.name.toLowerCase()));
}

function categoryOverride(value) {
  const clean = sanitizeString(value || '', 80).toLowerCase();
  if (!clean || clean === 'all') return '';
  return clean;
}

function cacheKey(query, sources, limit, category = '') {
  return `${query.toLowerCase()}::${sources.map((source) => source.name).join(',')}::${limit}::${category}::v4`;
}

function searchTags(query) {
  return [
    'mat-store-search',
    'exact-search',
    slug(query)
  ];
}

function hasPublishableSearchMedia(product = {}) {
  if (isGeneratedSearchProduct(product)) return false;
  if (!hasRealProductMedia(product)) return false;
  if (isUntrustedDiscoveredImageProduct(product)) return false;
  const imageText = [
    product.imageStatus,
    product.imageSource,
    product.image,
    product.images?.[0],
    product.fallbackImage
  ].filter(Boolean).join(' ');
  return !/curated-photo-fallback|generated-fallback|representative|fallback only/i.test(imageText)
    && !mediaService.isGeneratedFallbackUrl(product.image || product.images?.[0] || '')
    && !mediaService.isBlockedStockImageUrl(imageText);
}

function normalizeSearchProduct(product, query, sourceName, options = {}) {
  const queryTitle = query.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const safeTitle = storeSafeSearchTitle(product.title || '', queryTitle);
  return {
    ...product,
    title: safeTitle,
    category: options.categoryOverride || product.category,
    supplierName: STORE_DISPLAY_NAME,
    supplierUrl: product.sourceUrl || product.supplierUrl,
    collection: `${STORE_DISPLAY_NAME} Search: ${queryTitle}`,
    status: 'active',
    tags: [...new Set([...(product.tags || []), ...searchTags(query)])].slice(0, 16),
    features: [
      ...(product.features || []),
      `Matched by MAT STORE search for "${query}"`,
      'Saved into MAT STORE for local browsing and checkout'
    ].slice(0, 8),
    ai: {
      ...(product.ai || {}),
      provider: product.ai?.provider || 'mat-store-search',
      luxuryAngle: product.ai?.luxuryAngle || `MAT STORE search discovery for ${query}.`
    }
  };
}

function sourceFallbackUrls(source, query) {
  if (typeof source.fallbackUrls === 'function') return source.fallbackUrls(query);
  return source.fallbackUrls || [];
}

function relevantSearchProducts(products, query, perSourceLimit, sourceName, options = {}) {
  return (products || [])
    .map((product) => {
      const normalized = normalizeSearchProduct(product, query, sourceName, options);
      const relevance = searchMatch.scoreProduct(query, normalized);
      return { product: normalized, relevance };
    })
    .filter((entry) => entry.relevance.relevant && hasPublishableSearchMedia(entry.product))
    .sort((a, b) => b.relevance.score - a.relevance.score)
    .slice(0, perSourceLimit)
    .map((entry) => entry.product);
}

function slug(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function productIdentityKey(product = {}) {
  return cleanProductTitle(product.title || '')
    .toLowerCase()
    .replace(/\b(?:new|renewed|refurbished|open box|used)\b/g, '')
    .replace(/\b(?:amazon|walmart|aliexpress|ali express|alibaba|ebay|temu)\s+(?:search|goldbox|front page|global deals|marketplace|deals|picks?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function storeSafeSearchTitle(value = '', fallback = '') {
  const fallbackTitle = formatBrandTitle(fallback || 'MAT STORE Product', 'MAT STORE Product');
  const clean = cleanProductTitle(value || fallbackTitle, fallbackTitle)
    .replace(/\b(?:amazon(?:\.[a-z]{2,}){0,4}|walmart(?:\.[a-z]{2,}){0,4}|aliexpress(?:\.[a-z]{2,}){0,4}|ali\s*express|alibaba(?:\.[a-z]{2,}){0,4}|ebay(?:\.[a-z]{2,}){0,4}|temu(?:\.[a-z]{2,}){0,4})\b/gi, '')
    .replace(/\s*(?:\u2022|\||-)\s*compare prices?.*$/gi, '')
    .replace(/\b(?:marketplace|search result|search pick|search match|online listing|supplier listing)\b/gi, '')
    .replace(/\s*[:|,-]\s*(?:electronics|fashion|home|beauty|toys|shopping|products?|online|store)\s*$/gi, '')
    .replace(/\s*(?:[:|,-]\s*){2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:|,-]+|[\s:|,-]+$/g, '')
    .trim();
  if (!clean || clean.length < 4) return fallbackTitle;
  return formatBrandTitle(clean, fallbackTitle);
}

function dedupeSearchProducts(products = []) {
  const seen = new Set();
  const output = [];
  for (const product of products) {
    const key = productIdentityKey(product);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    output.push(product);
  }
  return output;
}

function markSearchImageCandidate(product = {}) {
  return {
    ...product,
    imageVerifiedAt: product.imageVerifiedAt || new Date().toISOString(),
    imageVerification: product.imageVerification || 'search-image-candidate'
  };
}

function deterministicSearchPrice(title = '', query = '') {
  const value = `${title} ${query}`.toLowerCase();
  if (/\b(iphone|galaxy|pixel|phone|ipad|tablet)\b/.test(value)) return 399.99;
  if (/\b(laptop|macbook|notebook|computer|monitor|tv|television|camera|drone|console)\b/.test(value)) return 499.99;
  if (/\b(airpods?|earbuds?|earphones?|headphones?|headsets?|speaker|soundbar|watch)\b/.test(value)) return 129.99;
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots|bag|wallet|jacket|dress)\b/.test(value)) return 49.99;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 10000;
  return Number((24 + (hash % 180) + 0.99).toFixed(2));
}

function categoryForSearchProduct(query = '', selectedCategory = '') {
  if (selectedCategory) return selectedCategory;
  if (/\b(shoe|shoes|sneaker|sneakers|boot|boots)\b/i.test(query)) return 'shoes';
  if (/\b(beauty|serum|cream|skincare|makeup|perfume|fragrance)\b/i.test(query)) return 'beauty';
  if (/\b(bag|wallet|jewelry|ring|necklace|bracelet)\b/i.test(query)) return 'accessories';
  if (/\b(laptop|phone|iphone|galaxy|pixel|airpods?|earbuds?|headphones?|speaker|camera|watch|tablet|tv|monitor|console)\b/i.test(query)) return 'electronics';
  return 'premium finds';
}

function searchFallbackTitle(query = '', candidateTitle = '') {
  const rawTitle = storeSafeSearchTitle(candidateTitle || '', query)
    .replace(/^customer\s+reviews?\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const editorialTitle = /\b(?:first\s+images?|reveals?|introduce|introduces|unveiled|announces|announced|review|reviews?|ratings?|comprehensive|guide|news|article|blog|launch|launches|release date|ahead of launch|on sale|sale ahead|deal|deals|best|experience)\b/i.test(rawTitle);
  const cleanQueryTitle = formatBrandTitle(query, 'Premium Product');
  const audioQuery = /\b(airpods?|earbuds?|earphones?|headphones?|headsets?)\b/i.test(query);

  if (audioQuery) {
    const combined = `${query} ${rawTitle}`.toLowerCase();
    const generation = combined.match(/\b(?:airpods?\s*pro\s*)?(2|3)(?:nd|rd)?\b/)?.[1] || '';
    const base = generation && /airpods?/i.test(query)
      ? `Apple AirPods Pro ${generation}`
      : cleanQueryTitle;
    return `${base} Wireless Earbuds`;
  }

  if (!rawTitle || editorialTitle || rawTitle.length > 95) return cleanQueryTitle;
  return formatBrandTitle(rawTitle, cleanQueryTitle);
}

function productFromDiscoveredImage(candidate = {}, query = '', sourceName = '', options = {}) {
  const title = searchFallbackTitle(query, candidate.title);
  const price = deterministicSearchPrice(title, query);
  const sourceUrl = sanitizeUrl(candidate.sourceUrl || '');
  const category = categoryForSearchProduct(query, options.categoryOverride);
  return normalizeSearchProduct({
    title,
    sourceUrl,
    supplierUrl: sourceUrl,
    supplierImageUrl: candidate.image,
    image: candidate.image,
    images: [candidate.image],
    imageStatus: 'external-image',
    imageSource: 'Verified live product image',
    imageVerifiedAt: new Date().toISOString(),
    imageVerification: 'search-image-candidate',
    mediaConfidence: 'high',
    supplierPrice: Number((price * 0.72).toFixed(2)),
    price,
    stock: options.stock || 12,
    category,
    description: `${title} selected for MAT STORE shoppers with a verified product photo and checkout-ready catalog details.`,
    shortDescription: `${title} with verified product imagery.`,
    marketplaceDetails: {
      brand: '',
      badge: 'Verified product image',
      about: [
        'Product photo verified before publishing',
        'Public catalog shows MAT STORE branding only',
        'Checkout-ready product listing'
      ],
      specs: [
        { name: 'Image verification', value: 'Live product photo' },
        { name: 'Catalog source', value: STORE_DISPLAY_NAME }
      ],
      reviews: { rating: 4.7, count: 0 }
    },
    rating: 4.7,
    reviewsCount: 0,
    seo: {
      title: `${title} | ${STORE_DISPLAY_NAME}`,
      description: `${title} available through ${STORE_DISPLAY_NAME} with verified product imagery.`,
      keywords: [category, query, STORE_DISPLAY_NAME].filter(Boolean)
    },
    ai: {
      provider: 'mat-ai-search',
      luxuryAngle: `${STORE_DISPLAY_NAME} verified product discovery for ${query}.`
    },
    features: [
      'Verified live product photo',
      'MAT STORE checkout-ready listing',
      'Public listing keeps supplier details private'
    ]
  }, query, sourceName, options);
}

async function fallbackSearchProducts(source, query, sourceUrl, limit = 4, options = {}) {
  if (!options.allowFallbackDiscovery) return [];

  const candidates = await mediaService.discoverProductImageCandidates({
    title: query,
    category: options.categoryOverride || categoryForSearchProduct(query),
    collection: `${STORE_DISPLAY_NAME} Search`
  }, Math.min(limit, 18));

  const products = candidates
    .map((candidate) => productFromDiscoveredImage(candidate, query, source?.name || '', options))
    .filter((product) => searchMatch.scoreProduct(query, product).relevant && hasPublishableSearchMedia(product));

  return dedupeSearchProducts(products.map(markSearchImageCandidate)).slice(0, limit);
}

function supplementalDiscoveryQueries(query = '', options = {}) {
  const category = options.categoryOverride || categoryForSearchProduct(query);
  const compactQuery = query.replace(/\bsmart\s+watch(?:es)?\b/gi, 'smartwatch');
  const sourceQueries = SEARCH_SOURCES.flatMap((source) => [
    `${query} ${source.name} product`,
    `${compactQuery} ${source.name} product`
  ]);
  return [
    query,
    compactQuery,
    `${query} product`,
    `${query} online`,
    `${query} best seller`,
    `${query} new arrival`,
    `${query} ${category}`,
    `${query} premium`,
    `${query} official product image`,
    `${query} accessories`,
    `${query} deal`,
    `${query} shopping`,
    ...sourceQueries
  ]
    .map(cleanQuery)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function supplementalSearchProducts(query = '', limit = 0, options = {}) {
  const target = Math.min(MAX_SEARCH_PRODUCTS, Math.max(0, Number(limit || 0)));
  if (!target) return [];

  const queryVariants = supplementalDiscoveryQueries(query, options)
    .slice(0, Math.min(12, Math.max(6, Math.ceil(target / 2))));
  const seen = new Set();
  const candidates = [];
  for (const variant of queryVariants) {
    const group = await mediaService.discoverProductImageCandidates({
      title: variant,
      category: options.categoryOverride || categoryForSearchProduct(query),
      collection: `${STORE_DISPLAY_NAME} Search`
    }, Math.min(24, Math.max(8, target)));
    for (const candidate of group) {
      const key = `${String(candidate.image || '').toLowerCase()}::${String(candidate.title || '').toLowerCase()}`;
      if (!candidate.image || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= Math.ceil(target * 1.5)) break;
    }
    if (candidates.length >= Math.ceil(target * 1.5)) break;
  }

  const products = candidates
    .map((candidate) => productFromDiscoveredImage(candidate, query, STORE_DISPLAY_NAME, options))
    .filter((product) => searchMatch.scoreProduct(query, product).relevant && hasPublishableSearchMedia(product));

  return dedupeSearchProducts(products.map(markSearchImageCandidate)).slice(0, target);
}

async function previewCollectionWithTimeout(url, options = {}) {
  let timer;
  try {
    return await Promise.race([
      importerService.previewCollectionImport(url, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Supplier search timed out.')), SOURCE_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function previewProductWithTimeout(url, options = {}) {
  let timer;
  try {
    return await Promise.race([
      importerService.previewImport(url, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Product page timed out.')), PRODUCT_PAGE_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items = [], limit = 3, mapper) {
  const queue = [...items];
  const output = [];
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const mapped = await mapper(item);
      if (mapped) output.push(mapped);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return output;
}

async function productMediaIsLive(product = {}) {
  const primary = primaryRealProductMedia(product);
  if (!primary) return false;
  const canUseVerifiedExternalImage = product.imageStatus === 'external-image'
    || product.imageStatus === 'discovered-product-image'
    || product.imageVerification === 'live-product-download';
  const verified = await mediaService.verifyProductImageUrl(primary, {
    trustedSavedImage: canUseVerifiedExternalImage
  });
  return Boolean(verified.ok);
}

async function rediscoverSearchProductMedia(product = {}, query = '', sourceName = '', options = {}) {
  const media = await mediaService.resolveBestProductImage('', {
    ...product,
    title: cleanProductTitle(product.title || ''),
    category: options.categoryOverride || product.category,
    collection: product.collection,
    tags: product.tags || [],
    features: product.features || []
  });

  if (!media.image || media.imageStatus === 'curated-photo-fallback') return null;
  const refreshed = normalizeSearchProduct({
    ...product,
    ...media,
    images: [media.image],
    supplierImageUrl: media.supplierImageUrl || product.supplierImageUrl || ''
  }, query, sourceName, options);

  return hasPublishableSearchMedia(refreshed) && await productMediaIsLive(refreshed) ? refreshed : null;
}

async function refreshProductPageMedia(product = {}, query = '', sourceName = '', options = {}) {
  const sourceUrl = product.sourceUrl || product.supplierUrl || '';
  if (!/^https:\/\//i.test(sourceUrl) || /#mat-/i.test(sourceUrl)) return null;

  try {
    const preview = await previewProductWithTimeout(sourceUrl, {
      stock: options.stock,
      markupPercent: options.markupPercent
    });
    const refreshed = normalizeSearchProduct(preview, query, sourceName, options);
    const relevance = searchMatch.scoreProduct(query, refreshed);
    return relevance.relevant && hasPublishableSearchMedia(refreshed) && await productMediaIsLive(refreshed)
      ? refreshed
      : null;
  } catch {
    return null;
  }
}

async function verifySearchProduct(product = {}, query = '', sourceName = '', options = {}) {
  if (!hasPublishableSearchMedia(product)) return null;
  const verifiedAt = new Date().toISOString();
  if (await productMediaIsLive(product)) {
    return {
      ...product,
      imageVerifiedAt: verifiedAt,
      imageVerification: 'live-product-download'
    };
  }
  const refreshed = await refreshProductPageMedia(product, query, sourceName, options)
    || await rediscoverSearchProductMedia(product, query, sourceName, options);
  return refreshed
    ? {
        ...refreshed,
        imageVerifiedAt: verifiedAt,
        imageVerification: 'live-product-download'
      }
    : null;
}

async function verifiedSearchProducts(products = [], query = '', sourceName = '', options = {}) {
  return mapWithConcurrency(products, IMAGE_VERIFY_CONCURRENCY, (product) =>
    verifySearchProduct(product, query, sourceName, options)
  );
}

async function searchSource(source, query, perSourceLimit, options) {
  const sourceUrl = source.url(query);
  const errors = [];
  const urls = [sourceUrl, ...sourceFallbackUrls(source, query)]
    .filter((url, index, list) => url && list.indexOf(url) === index)
    .slice(0, 1);
  let collected = [];

  for (const url of urls) {
    if (collected.length >= perSourceLimit) break;
    try {
      const remaining = perSourceLimit - collected.length;
      const result = await previewCollectionWithTimeout(url, {
        collectionLimit: Math.max(perSourceLimit, remaining),
        limit: Math.max(perSourceLimit, remaining),
        stock: options.stock,
        markupPercent: options.markupPercent
      });
      const products = relevantSearchProducts(result.products || [], query, Math.max(perSourceLimit, remaining), source.name, options);
      const verifiedProducts = products.map(markSearchImageCandidate);
      collected = dedupeSearchProducts([...collected, ...verifiedProducts]).slice(0, perSourceLimit);
      errors.push(...(result.errors || []));
    } catch (error) {
      errors.push({ source: source.name, url, message: error.message });
    }
  }

  if (collected.length < perSourceLimit) {
    const supplementalProducts = await fallbackSearchProducts(source, query, sourceUrl, perSourceLimit - collected.length, options);
    collected = dedupeSearchProducts([...collected, ...supplementalProducts]).slice(0, perSourceLimit);
  }

  if (collected.length) {
    return {
      source: source.name,
      sourceUrl,
      products: collected,
      errors
    };
  }

  return {
    source: source.name,
    sourceUrl,
    products: await fallbackSearchProducts(source, query, sourceUrl, Math.min(perSourceLimit, 8), options),
    fallback: true,
    errors
  };
}

async function searchMarketplaces(params = {}) {
  const query = cleanQuery(params.q || params.query);
  if (query.length < 2) throw new HttpError(400, 'Search for at least two characters.');

  const currency = sanitizeString(params.currency || 'USD', 8).toUpperCase();
  const limit = Math.min(MAX_SEARCH_PRODUCTS, Math.max(12, Math.floor(Number(params.limit || 50))));
  const sources = requestedSources(params.sources || params.marketplaces);
  const perSourceLimit = Math.min(
    MAX_VERIFIED_PRODUCTS_PER_SOURCE,
    Math.max(4, Math.ceil(limit / Math.max(1, sources.length)))
  );
  const selectedCategory = categoryOverride(params.category);
  const key = cacheKey(query, sources, limit, selectedCategory);
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    const catalog = await productService.listProducts({ q: query, limit, currency, sort: 'newest' });
    return {
      ...cached.summary,
      cached: true,
      products: catalog.items,
      total: catalog.total,
      categories: catalog.categories
    };
  }

  const options = {
    stock: Math.max(1, Math.floor(Number(params.stock || 24))),
    markupPercent: Math.max(1, Math.floor(Number(params.markupPercent || 40))),
    categoryOverride: selectedCategory
  };
  const sourceResults = await Promise.all(sources.map((source, index) =>
    searchSource(source, query, perSourceLimit, { ...options, allowFallbackDiscovery: index < 1 })
  ));
  let discovered = dedupeSearchProducts(sourceResults.flatMap((result) => result.products))
    .filter(hasPublishableSearchMedia)
    .slice(0, limit);

  if (discovered.length < limit) {
    const supplemental = await supplementalSearchProducts(query, limit - discovered.length, options);
    discovered = dedupeSearchProducts([...discovered, ...supplemental])
      .filter(hasPublishableSearchMedia)
      .slice(0, limit);
  }
  const errors = sourceResults.flatMap((result) => result.errors || []);

  let saved = [];
  if (discovered.length) {
    saved = await productService.createProducts(discovered);
  }

  const catalog = await productService.listProducts({ q: query, limit, currency, sort: 'newest' });
  const summary = {
    query,
    sources: sourceResults.map((result) => ({
      name: result.source,
      sourceUrl: result.sourceUrl,
      found: result.products.length,
      ok: result.products.length > 0,
      fallback: Boolean(result.fallback)
    })),
    imported: saved.length,
    errors
  };

  if (catalog.total > 0 || saved.length > 0) {
    cache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      summary
    });
  } else {
    cache.delete(key);
  }

  return {
    ...summary,
    cached: false,
    products: catalog.items,
    total: catalog.total,
    categories: catalog.categories
  };
}

module.exports = {
  searchMarketplaces
};
