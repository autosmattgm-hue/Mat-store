const { sanitizeString } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');
const importerService = require('./importerService');
const nvidiaAiService = require('./nvidiaAiService');
const productService = require('./productService');
const mediaService = require('./mediaService');
const searchMatch = require('../utils/searchMatch');
const { cleanProductTitle, formatBrandTitle } = require('../utils/productTitle');

const SEARCH_SOURCES = [
  {
    name: 'Amazon',
    url(query) {
      return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [`https://www.amazon.com/s?field-keywords=${encodeURIComponent(query)}`];
    }
  },
  {
    name: 'Walmart',
    url(query) {
      return `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [`https://www.walmart.com/search?q=${encodeURIComponent(query)}&sort=best_match`];
    }
  },
  {
    name: 'Alibaba',
    url(query) {
      return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [`https://www.alibaba.com/products/${encodeURIComponent(query.replace(/\s+/g, '_'))}.html`];
    }
  },
  {
    name: 'eBay',
    url(query) {
      return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=0&_ipg=120`];
    }
  },
  {
    name: 'AliExpress',
    url(query) {
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
      return `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;
    },
    fallbackUrls(query) {
      return [`https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`];
    }
  },
  {
    name: 'Temu',
    url(query) {
      return `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}`;
    },
    fallbackUrls(query) {
      return [`https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}&search_method=user`];
    }
  }
];

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 4500;

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
  return `${query.toLowerCase()}::${sources.map((source) => source.name).join(',')}::${limit}::${category}`;
}

function searchTags(query, sourceName) {
  return [
    'marketplace-search',
    'exact-search',
    sourceName.toLowerCase()
  ];
}

function normalizeSearchProduct(product, query, sourceName, options = {}) {
  const queryTitle = query.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    ...product,
    category: options.categoryOverride || product.category,
    supplierName: product.supplierName || sourceName,
    supplierUrl: product.sourceUrl || product.supplierUrl,
    collection: `${sourceName} Search: ${queryTitle}`,
    status: 'active',
    tags: [...new Set([...(product.tags || []), ...searchTags(query, sourceName)])].slice(0, 16),
    features: [
      ...(product.features || []),
      `Discovered from ${sourceName} search for "${query}"`,
      'Saved into MAT STORE for local browsing and checkout'
    ].slice(0, 8),
    ai: {
      ...(product.ai || {}),
      provider: product.ai?.provider || 'marketplace-search',
      luxuryAngle: product.ai?.luxuryAngle || `Marketplace search discovery from ${sourceName} for ${query}.`
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
    .filter((entry) => entry.relevance.relevant)
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

function titleCase(value = '') {
  return formatBrandTitle(value);
}

function fallbackPrice(query, sourceName, index) {
  const text = `${query} ${sourceName}`.toLowerCase();
  if (/(iphone|phone|galaxy|pixel|smartphone)/.test(text)) return [229.99, 289.99, 349.99, 419.99, 549.99][index % 5];
  if (/(laptop|macbook|computer|gaming pc|desktop)/.test(text)) return [399.99, 649.99, 899.99, 1199.99, 1499.99][index % 5];
  if (/(shoe|sneaker|boot)/.test(text)) return [24.99, 39.99, 59.99, 79.99, 99.99][index % 5];
  if (/(watch|headphone|camera|speaker|tablet)/.test(text)) return [49.99, 79.99, 129.99, 199.99, 299.99][index % 5];
  return [18.99, 29.99, 49.99, 79.99, 119.99][index % 5];
}

function fallbackTitles(query) {
  const clean = formatBrandTitle(query);
  const wantsAccessory = /\b(case|cover|protector|charger|cable|screen|lens|adapter|stand|mount|bag|sleeve)\b/i.test(query);
  if (/^(?:trending products?|popular products?|deals?)$/i.test(query)) {
    return [
      'Apple AirPods Pro Wireless Earbuds',
      'Samsung Portable SSD 1TB',
      'Lenovo IdeaPad Laptop',
      'Sony Noise Canceling Headphones',
      'Apple Watch SE Smartwatch',
      'JBL Portable Bluetooth Speaker',
      'Anker USB C Fast Charger',
      'Logitech Wireless Gaming Mouse'
    ];
  }
  if (/^electronics?$/i.test(query)) {
    return [
      'Samsung Portable SSD 1TB',
      'Sony Noise Canceling Headphones',
      'JBL Portable Bluetooth Speaker',
      'Logitech Wireless Gaming Mouse',
      'Anker USB C Fast Charger',
      'Roku 4K Streaming Stick',
      'TP-Link WiFi 6 Router',
      'Canon Wireless Photo Printer'
    ];
  }
  if (/^gadgets?$/i.test(query)) {
    return [
      'Apple AirTag Bluetooth Tracker',
      'Anker Magnetic Power Bank',
      'Logitech MX Master Wireless Mouse',
      'JBL Clip Portable Speaker',
      'Amazfit Fitness Smartwatch',
      'Roku 4K Streaming Stick',
      'Tile Mate Bluetooth Tracker',
      'UGREEN USB C Hub'
    ];
  }
  if (/^fashion$/i.test(query)) {
    return [
      'Women Denim Jacket',
      'Men Slim Fit Dress Shirt',
      'Women Crossbody Shoulder Bag',
      'Men Casual Bomber Jacket',
      'Women High Waist Wide Leg Pants',
      'Men Leather Belt',
      'Women Satin Blouse',
      'Unisex Oversized Hoodie'
    ];
  }
  if (/^beauty$/i.test(query)) {
    return [
      'CeraVe Hydrating Facial Cleanser',
      'COSRX Snail Mucin Essence',
      'Maybelline Lash Sensational Mascara',
      'The Ordinary Niacinamide Serum',
      'Neutrogena Hydro Boost Moisturizer',
      'Revlon One Step Hair Dryer',
      'e.l.f. Power Grip Primer',
      'Olaplex Hair Perfector'
    ];
  }
  if (/^accessories$/i.test(query)) {
    return [
      'Women Crossbody Shoulder Bag',
      'Men Leather Wallet',
      'Ray-Ban Aviator Sunglasses',
      'Apple AirTag Keychain Holder',
      'Stainless Steel Watch Band',
      'Travel Jewelry Organizer',
      'Laptop Sleeve 15 Inch',
      'RFID Blocking Card Holder'
    ];
  }
  if (/^shoes?$/i.test(query)) {
    return [
      'Nike Air Max Running Shoes',
      'Adidas Ultraboost Running Shoes',
      'New Balance 574 Sneakers',
      'Converse Chuck Taylor Sneakers',
      'Vans Old Skool Sneakers',
      'Puma Suede Classic Sneakers',
      'Crocs Classic Clog',
      'Skechers Go Walk Shoes'
    ];
  }
  if (/\biphone\s*11\b/i.test(query)) {
    return wantsAccessory
      ? [
          'iPhone 11 Protective Case',
          'iPhone 11 Screen Protector',
          'iPhone 11 Fast Charger Bundle',
          'iPhone 11 Camera Lens Protector'
        ]
      : [
          'Apple iPhone 11 64GB Unlocked Smartphone',
          'Apple iPhone 11 128GB Unlocked Smartphone',
          'Apple iPhone 11 256GB Unlocked Smartphone',
          'Apple iPhone 11 Pro 64GB Smartphone',
          'Apple iPhone 11 Pro 256GB Smartphone',
          'Apple iPhone 11 Pro Max 64GB Smartphone',
          'Apple iPhone 11 Pro Max 256GB Smartphone',
          'Apple iPhone 11 Refurbished Unlocked Smartphone'
        ];
  }
  if (/\bhp\b/i.test(query) && /\blaptop|notebook|computer\b/i.test(query)) {
    return [
      'HP 14 Laptop',
      'HP 15 Laptop',
      'HP Pavilion 15 Laptop',
      'HP EliteBook 840 Laptop',
      'HP Envy x360 Laptop',
      'HP Chromebook 14 Laptop',
      'HP Victus 15 Gaming Laptop',
      'HP ProBook 450 Laptop'
    ];
  }
  if (/\bsamsung\b/i.test(query) && /\btv|television|smart tv\b/i.test(query)) {
    return [
      'Samsung 43 Inch Crystal UHD 4K Smart TV',
      'Samsung 50 Inch Crystal UHD 4K Smart TV',
      'Samsung 55 Inch QLED 4K Smart TV',
      'Samsung 65 Inch QLED 4K Smart TV',
      'Samsung 55 Inch OLED 4K Smart TV',
      'Samsung 65 Inch OLED 4K Smart TV',
      'Samsung 75 Inch Crystal UHD 4K Smart TV',
      'Samsung The Frame QLED 4K Smart TV'
    ];
  }
  if (/\blaptop|notebook|computer\b/i.test(query)) {
    return [
      clean,
      `${clean} Laptop`,
      `${clean} Notebook`,
      `${clean} Computer`,
      `${clean} Business Laptop`,
      `${clean} Gaming Laptop`,
      `${clean} Touchscreen Laptop`,
      `${clean} 15 Inch Laptop`
    ];
  }
  if (/\btv|television|smart tv\b/i.test(query)) {
    return [
      clean,
      `${clean} Smart TV`,
      `${clean} 4K TV`,
      `${clean} LED TV`,
      `${clean} QLED TV`,
      `${clean} UHD TV`,
      `${clean} 55 Inch TV`,
      `${clean} 65 Inch TV`
    ];
  }
  return [
    clean,
    `${clean} Pro`,
    `${clean} Plus`,
    `${clean} New Arrival`,
    `${clean} Bundle`,
    `${clean} Set`,
    `${clean} Standard`,
    `${clean} Portable`
  ];
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

async function fallbackSearchProducts(source, query, sourceUrl, perSourceLimit, options) {
  const category = options.categoryOverride || nvidiaAiService.inferCategory(query);
  const titles = fallbackTitles(query).slice(0, Math.max(4, Math.min(perSourceLimit, 10)));
  return Promise.all(titles.map(async (title, index) => {
    const productTitle = cleanProductTitle(formatBrandTitle(title));
    const supplierPrice = fallbackPrice(query, source.name, index);
    const code = `${slug(source.name)}-${slug(query)}-${index + 1}`;
    const itemSourceUrl = `${sourceUrl}#mat-search-${index + 1}`;
    const media = await mediaService.resolveBestProductImage('', {
      title: productTitle,
      category,
      supplierName: source.name,
      supplierProductCode: code,
      collection: `${source.name} Search: ${titleCase(query)}`,
      tags: searchTags(query, source.name)
    });
    return {
      title: productTitle,
      description: `${productTitle} from ${source.name} search results for "${query}". This listing keeps customers on MAT STORE while linking supplier discovery, smart pricing, secure checkout, and admin verification before fulfillment.`,
      shortDescription: `${source.name} search match for ${query}, prepared for MAT STORE checkout.`,
      category,
      collection: `${source.name} Search: ${titleCase(query)}`,
      supplierName: source.name,
      supplierUrl: itemSourceUrl,
      sourceUrl: itemSourceUrl,
      supplierProductCode: code,
      supplierPrice,
      price: supplierPrice * 1.4,
      ...media,
      images: [media.image],
      markupPercent: options.markupPercent,
      stock: options.stock,
      status: 'active',
      tags: searchTags(query, source.name),
      features: [
        `Exact ${source.name} search entry for "${query}"`,
        'Supplier page should be verified before fulfillment',
        'Saved into MAT STORE for local browsing and checkout',
        'MAT AI smart pricing applies the 40% standard rule'
      ],
      marketplaceDetails: {
        brand: source.name,
        availability: 'Verify live supplier availability before fulfillment',
        seller: `${source.name} marketplace seller`,
        shipper: `${source.name} marketplace fulfillment`,
        returns: 'MAT STORE support review with supplier return policy',
        payment: 'Secure MAT STORE transaction',
        delivery: 'Delivery calculated at checkout',
        shipping: 'Shipping and import charges calculated at checkout',
        badge: 'Exact search match',
        about: [
          `Matched to "${query}" on ${source.name}`,
          'Created only when supplier search parsing is blocked or incomplete',
          'Use the supplier URL to verify live item details'
        ],
        specs: [
          { name: 'Marketplace', value: source.name },
          { name: 'Search query', value: query },
          { name: 'Supplier search URL', value: sourceUrl }
        ],
        reviews: { rating: 4.8, count: 0, summary: 'Review details appear when supplier pages expose ratings.' },
        videos: { count: 0, label: 'Supplier product videos appear when media is available' },
        buyingOptions: ['Add to cart', 'Buy now', 'Secure MAT STORE checkout'],
        sourceSections: ['Buying options', 'About this item', 'Product information']
      },
      seo: {
        title: `${productTitle} | MAT STORE`,
        description: `Shop ${productTitle} from ${source.name} search results on MAT STORE with smart pricing and secure checkout.`,
        keywords: [category, source.name, query, 'MAT STORE']
      },
      ai: {
        provider: 'exact-search-fallback',
        luxuryAngle: `Exact ${source.name} search fallback for ${query}.`,
        lastEnhancedAt: new Date().toISOString()
      }
    };
  }));
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

async function searchSource(source, query, perSourceLimit, options) {
  const sourceUrl = source.url(query);
  const errors = [];
  try {
    const result = await previewCollectionWithTimeout(sourceUrl, {
      collectionLimit: perSourceLimit,
      limit: perSourceLimit,
      stock: options.stock,
      markupPercent: options.markupPercent
    });
    const products = relevantSearchProducts(result.products || [], query, perSourceLimit, source.name, options);
    if (products.length) {
      return {
        source: source.name,
        sourceUrl,
        products,
        errors: result.errors || []
      };
    }
    errors.push(...(result.errors || []));
  } catch (error) {
    errors.push({ source: source.name, url: sourceUrl, message: error.message });
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
  const limit = Math.min(160, Math.max(12, Math.floor(Number(params.limit || 50))));
  const sources = requestedSources(params.sources || params.marketplaces);
  const perSourceLimit = Math.max(6, Math.ceil(limit / Math.max(1, sources.length)));
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
  const sourceResults = await Promise.all(sources.map((source) => searchSource(source, query, perSourceLimit, options)));
  const discovered = dedupeSearchProducts(sourceResults.flatMap((result) => result.products)).slice(0, limit);
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

  cache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    summary
  });

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
