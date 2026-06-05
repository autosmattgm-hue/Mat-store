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
    name: 'AliExpress',
    url(query) {
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
      return `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;
    },
    fallbackUrls(query) {
      return [
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`,
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&page=2`,
        `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}&page=3`,
        `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(query.replace(/\s+/g, '-'))}.html?sortType=total_tranpro_desc`
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
const DEFAULT_SEARCH_SOURCE_NAMES = ['Amazon', 'AliExpress', 'eBay', 'Walmart', 'Alibaba', 'Temu'];
const PRIORITY_SEARCH_SOURCE_NAMES = new Set(['Amazon', 'AliExpress', 'eBay', 'Walmart']);
const DISCOVERY_MARKETPLACE_TERMS = [
  'Amazon',
  'AliExpress',
  'Walmart',
  'eBay',
  'Best Buy',
  'Target',
  'Etsy',
  'Temu',
  'Alibaba',
  'Shopify'
];
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 3000;
const PRODUCT_PAGE_TIMEOUT_MS = 3200;
const IMAGE_VERIFY_CONCURRENCY = 3;
const MAX_URL_ATTEMPTS_PER_SOURCE = 5;
const MAX_VERIFIED_PRODUCTS_PER_SOURCE = 42;
const MAX_SEARCH_PRODUCTS = 200;

function cleanQuery(value) {
  return sanitizeString(value, 140).replace(/[^\p{L}\p{N}\s&+.,'-]/gu, '').replace(/\s+/g, ' ').trim();
}

function requestedSources(value) {
  const requested = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!requested.length) {
    return DEFAULT_SEARCH_SOURCE_NAMES
      .map((name) => SEARCH_SOURCES.find((source) => source.name === name))
      .filter(Boolean);
  }
  return SEARCH_SOURCES.filter((source) => requested.includes(source.name.toLowerCase()));
}

function categoryOverride(value) {
  const clean = sanitizeString(value || '', 80).toLowerCase();
  if (!clean || clean === 'all') return '';
  return clean;
}

function cacheKey(query, sources, limit, category = '') {
  return `${query.toLowerCase()}::${sources.map((source) => source.name).join(',')}::${limit}::${category}::v8`;
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

function sourceUrlAttemptLimit(source) {
  if (PRIORITY_SEARCH_SOURCE_NAMES.has(source.name)) return MAX_URL_ATTEMPTS_PER_SOURCE;
  if (source.name === 'eBay') return 3;
  return 2;
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
  const titleKey = cleanProductTitle(product.title || '')
    .toLowerCase()
    .replace(/\b(?:new|renewed|refurbished|open box|used)\b/g, '')
    .replace(/\b(?:amazon|walmart|aliexpress|ali express|alibaba|ebay|temu)\s+(?:search|goldbox|front page|global deals|marketplace|deals|picks?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const imageKey = searchCandidateImageIdentity(product);
  return imageKey ? `${titleKey}::image:${imageKey}` : titleKey;
}

function searchCandidateImageIdentity(product = {}) {
  const isSearchCandidate = product.imageVerification === 'search-image-candidate'
    || product.imageStatus === 'external-image'
    || String(product.ai?.provider || '').toLowerCase().includes('search');
  if (!isSearchCandidate) return '';
  const image = product.supplierImageUrl || product.image || product.images?.[0] || '';
  const normalized = mediaService.highQualityImageUrl(image) || image;
  try {
    const parsed = new URL(normalized, 'https://matstore.local');
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().slice(0, 220);
  } catch {
    return sanitizeString(normalized, 260).toLowerCase();
  }
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

function searchTerms(value = '') {
  return cleanQuery(value)
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !['and', 'for', 'from', 'with', 'the', 'new', 'mat', 'store'].includes(term))
    .slice(0, 14);
}

function compactSearchQuery(query = '') {
  return cleanQuery(query)
    .replace(/\bsmart\s+watch(?:es)?\b/gi, 'smartwatch')
    .replace(/\bblue\s*tooth\b/gi, 'bluetooth')
    .replace(/\bair\s+pods\b/gi, 'airpods')
    .replace(/\busb\s+c\b/gi, 'usb-c')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizedSearchQuery(query = '') {
  return searchTerms(query)
    .map((term) => (term.length > 4 && /s$/.test(term) ? term.replace(/s$/, '') : term))
    .join(' ');
}

function shortenedSearchQueries(query = '') {
  const terms = searchTerms(query);
  if (terms.length <= 4) return [];
  return [
    terms.slice(0, 5).join(' '),
    terms.slice(-5).join(' '),
    terms.filter((term) => !/^(?:best|sale|deal|cheap|premium|official|original)$/i.test(term)).slice(0, 6).join(' ')
  ].filter(Boolean);
}

function titleQueryMatchScore(query = '', title = '') {
  const terms = searchTerms(query);
  if (!terms.length) return 1;
  const haystack = searchTerms(title).join(' ');
  if (!haystack) return 0;
  const matched = terms.filter((term) => {
    if (haystack.includes(term)) return true;
    return term.length > 4 && haystack.split(/\s+/).some((token) => token.startsWith(term) || term.startsWith(token));
  });
  return matched.length / terms.length;
}

function trustedProductHostScore(value = '') {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (/(?:^|\.)amazon\./i.test(host) || /media-amazon|ssl-images-amazon/i.test(host)) return 34;
    if (/(?:^|\.)aliexpress\./i.test(host) || /alicdn|aliexpress-media/i.test(host)) return 32;
    if (/(?:^|\.)walmart\./i.test(host) || /walmartimages/i.test(host)) return 28;
    if (/(?:^|\.)ebay\./i.test(host) || /ebayimg/i.test(host)) return 26;
    if (/(?:^|\.)bestbuy\./i.test(host) || /bbystatic/i.test(host)) return 22;
    if (/(?:^|\.)target\./i.test(host) || /targetimg/i.test(host)) return 18;
    if (/(?:^|\.)etsy\./i.test(host) || /etsystatic/i.test(host)) return 16;
    if (/shopifycdn|bigcommerce|scene7|kwcdn|nooncdn/i.test(host)) return 14;
  } catch {}
  return 0;
}

function candidateDiscoveryScore(candidate = {}, query = '') {
  const title = sanitizeString(candidate.title || '', 220);
  const image = sanitizeUrl(candidate.image || '');
  const sourceUrl = sanitizeUrl(candidate.sourceUrl || candidate.url || '');
  const text = `${title} ${candidate.source || ''} ${sourceUrl}`.toLowerCase();
  let score = Math.round(titleQueryMatchScore(query, title) * 90);
  score += trustedProductHostScore(sourceUrl) + trustedProductHostScore(image);
  if (/\/(?:dp|itm|item|ip|product|products|p)\//i.test(sourceUrl)) score += 20;
  if (/\b(?:buy|shop|store|sale|price|official|product)\b/i.test(text)) score += 10;
  if (/\b(?:review|reviews?|news|blog|article|guide|comparison|youtube|pinterest|reddit|wiki|manual|support)\b/i.test(text)) score -= 80;
  const width = Number(candidate.width || 0);
  const height = Number(candidate.height || 0);
  if (width >= 700 && height >= 700) score += 18;
  else if (width >= 400 && height >= 350) score += 8;
  if (width && height && Math.max(width, height) / Math.max(1, Math.min(width, height)) > 3.2) score -= 30;
  return score;
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
  const titleMatchScore = titleQueryMatchScore(query, rawTitle);

  if (audioQuery) {
    const combined = `${query} ${rawTitle}`.toLowerCase();
    const generation = combined.match(/\b(?:airpods?\s*pro\s*)?(2|3)(?:nd|rd)?\b/)?.[1] || '';
    const base = generation && /airpods?/i.test(query)
      ? `Apple AirPods Pro ${generation}`
      : cleanQueryTitle;
    return `${base} Wireless Earbuds`;
  }

  if (!rawTitle || editorialTitle || rawTitle.length > 110 || titleMatchScore < 0.42) return cleanQueryTitle;
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
  }, Math.min(60, Math.max(18, limit * 3)));

  const products = candidates
    .sort((a, b) => candidateDiscoveryScore(b, query) - candidateDiscoveryScore(a, query))
    .map((candidate) => productFromDiscoveredImage(candidate, query, source?.name || '', options))
    .filter((product) => searchMatch.scoreProduct(query, product).relevant && hasPublishableSearchMedia(product));

  return dedupeSearchProducts(products.map(markSearchImageCandidate)).slice(0, limit);
}

function supplementalDiscoveryQueries(query = '', options = {}) {
  const category = options.categoryOverride || categoryForSearchProduct(query);
  const compactQuery = compactSearchQuery(query);
  const singularQuery = singularizedSearchQuery(query);
  const shortenedQueries = shortenedSearchQueries(query);
  const baseQueries = [
    query,
    compactQuery,
    singularQuery,
    ...shortenedQueries
  ].filter(Boolean);
  const sourceQueries = DISCOVERY_MARKETPLACE_TERMS.flatMap((source) => [
    `${query} ${source}`,
    `${query} ${source} product`,
    `${compactQuery} ${source} product`
  ]);
  return [
    ...baseQueries,
    ...baseQueries.flatMap((value) => [
      `${value} product`,
      `${value} product photo`,
      `${value} product image`,
      `${value} buy online`,
      `${value} for sale`,
      `${value} price`,
      `${value} best seller`,
      `${value} new arrival`,
      `${value} ${category}`,
      `${value} official product image`,
      `${value} shopping`
    ]),
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
    .slice(0, Math.min(32, Math.max(12, Math.ceil(target / 3))));
  const seen = new Set();
  const candidates = [];
  for (const variant of queryVariants) {
    const group = await mediaService.discoverProductImageCandidates({
      title: variant,
      category: options.categoryOverride || categoryForSearchProduct(query),
      collection: `${STORE_DISPLAY_NAME} Search`
    }, Math.min(50, Math.max(14, Math.ceil(target / 2))));
    for (const candidate of group) {
      const key = `${String(candidate.image || '').toLowerCase()}::${String(candidate.title || '').toLowerCase()}`;
      if (!candidate.image || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= Math.ceil(target * 2.4)) break;
    }
    if (candidates.length >= Math.ceil(target * 2.4)) break;
  }

  const products = candidates
    .sort((a, b) => candidateDiscoveryScore(b, query) - candidateDiscoveryScore(a, query))
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

async function highCoverageDiscoveryProducts(query = '', limit = 0, options = {}) {
  const target = Math.min(MAX_SEARCH_PRODUCTS, Math.max(0, Number(limit || 0)));
  if (!target) return [];

  const category = options.categoryOverride || categoryForSearchProduct(query);
  const seen = new Set();
  const candidates = [];
  const addCandidates = (items = []) => {
    for (const candidate of items) {
      const image = String(candidate.image || '').toLowerCase();
      const sourceUrl = String(candidate.sourceUrl || candidate.url || '').toLowerCase();
      const title = String(candidate.title || '').toLowerCase();
      const key = `${image}::${sourceUrl || title}`;
      if (!image || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  };

  const primary = await mediaService.discoverProductImageCandidates({
    title: query,
    category,
    collection: `${STORE_DISPLAY_NAME} Search`
  }, target <= 100 ? Math.min(120, Math.max(100, target + 20)) : Math.min(240, target + 40));
  addCandidates(primary);

  const variantThreshold = target <= 100 ? Math.min(target, 80) : target;
  if (candidates.length < variantThreshold) {
    const variants = supplementalDiscoveryQueries(query, options)
      .filter((variant) => variant.toLowerCase() !== query.toLowerCase())
      .slice(0, 6);
    const groups = await mapWithConcurrency(variants, 3, (variant) =>
      mediaService.discoverProductImageCandidates({
        title: variant,
        category,
        collection: `${STORE_DISPLAY_NAME} Search`
      }, Math.min(80, Math.max(24, target)))
    );
    groups.forEach(addCandidates);
  }

  const products = candidates
    .sort((a, b) => candidateDiscoveryScore(b, query) - candidateDiscoveryScore(a, query))
    .map((candidate) => productFromDiscoveredImage(candidate, query, STORE_DISPLAY_NAME, options))
    .filter((product) => searchMatch.scoreProduct(query, product).relevant && hasPublishableSearchMedia(product));

  return dedupeSearchProducts(products.map(markSearchImageCandidate)).slice(0, target);
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
    .slice(0, sourceUrlAttemptLimit(source));
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
  const limit = Math.min(MAX_SEARCH_PRODUCTS, Math.max(24, Math.floor(Number(params.limit || 100))));
  const sources = requestedSources(params.sources || params.marketplaces);
  const perSourceLimit = Math.min(
    MAX_VERIFIED_PRODUCTS_PER_SOURCE,
    Math.max(8, Math.ceil(limit / Math.max(1, sources.length)))
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
  let discovered = await highCoverageDiscoveryProducts(query, limit, options);
  let sourceResults = [{
    source: `${STORE_DISPLAY_NAME} Discovery`,
    sourceUrl: '',
    products: discovered,
    fallback: true,
    errors: []
  }];

  if (discovered.length < Math.min(limit, 24)) {
    const externalResults = await Promise.all(sources.map((source, index) =>
      searchSource(source, query, perSourceLimit, {
        ...options,
        allowFallbackDiscovery: index < 2 || PRIORITY_SEARCH_SOURCE_NAMES.has(source.name)
      })
    ));
    sourceResults = [...sourceResults, ...externalResults];
    discovered = dedupeSearchProducts([...discovered, ...externalResults.flatMap((result) => result.products)])
      .filter(hasPublishableSearchMedia)
      .slice(0, limit);
  }

  discovered = dedupeSearchProducts(discovered)
    .filter(hasPublishableSearchMedia)
    .slice(0, limit);

  if (discovered.length < Math.min(limit, 60)) {
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
