const { randomUUID } = require('crypto');
const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');
const nvidiaAiService = require('./nvidiaAiService');
const pricingService = require('./pricingService');
const productService = require('./productService');
const mediaService = require('./mediaService');
const currencyService = require('./currencyService');
const { cleanProductTitle, formatBrandTitle } = require('../utils/productTitle');

const MAX_MARKETPLACE_HTML = 6_000_000;
const MAX_COLLECTION_PRODUCTS = 240;
const shortMarketplaceHosts = ['a.co', 'www.a.co', 'amzn.to', 'www.amzn.to'];

const allowedMarketplaces = [
  { name: 'Amazon', hosts: ['amazon.com', 'www.amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.ae'] },
  { name: 'Walmart', hosts: ['walmart.com', 'www.walmart.com'] },
  { name: 'Temu', hosts: ['temu.com', 'www.temu.com'] },
  { name: 'Alibaba', hosts: ['alibaba.com', 'www.alibaba.com', 'm.alibaba.com'] },
  { name: 'AliExpress', hosts: ['aliexpress.com', 'www.aliexpress.com', 'm.aliexpress.com'] },
  { name: 'eBay', hosts: ['ebay.com', 'www.ebay.com', 'ebay.co.uk', 'www.ebay.co.uk'] }
];

function extractUrls(value) {
  const input = String(value || '').replace(/(?=https?:\/\/)/gi, '\n');
  const matches = input.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [
    ...new Set(
      matches
        .map((url) => url.replace(/[)\].,;]+$/g, ''))
        .filter(Boolean)
        .slice(0, 30)
    )
  ];
}

function cleanMarketplaceUrl(value) {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl) return '';
  const parsed = new URL(cleanUrl);
  const host = parsed.hostname.toLowerCase();
  let restrictParams = true;
  const keepParams = new URLSearchParams();
  const keepByMarketplace = {
    amazon: ['th', 'psc', 'smid', 'ref_', 'promotionsSearchLastSeenAsin', 'promotionsSearchStartIndex', 'promotionsSearchPageSize'],
    aliexpress: ['sku_id', 'spm'],
    alibaba: ['spm'],
    temu: ['sku_id', 'goods_id'],
    ebay: ['var', 'hash'],
    walmart: ['selectedSellerId', 'variantFieldId']
  };
  const marketplaceKey = host.includes('amazon')
    ? 'amazon'
    : host.includes('walmart')
      ? 'walmart'
      : host.includes('aliexpress')
        ? 'aliexpress'
        : host.includes('alibaba')
          ? 'alibaba'
          : host.includes('temu')
            ? 'temu'
            : host.includes('ebay')
              ? 'ebay'
              : '';
  if (marketplaceKey === 'amazon') {
    const match = parsed.pathname.match(/(.*?\/(?:dp|gp\/product)\/[A-Z0-9]{10})/i);
    if (match) {
      parsed.pathname = match[1];
      keepByMarketplace.amazon = ['th', 'psc', 'smid'];
    } else {
      restrictParams = false;
    }
  }
  if (marketplaceKey === 'ebay') {
    const match = parsed.pathname.match(/(\/itm\/(?:[^/]+\/)?\d{8,})/i);
    if (match) parsed.pathname = match[1];
    else restrictParams = false;
  }
  if (marketplaceKey === 'aliexpress') {
    const match = parsed.pathname.match(/\/item\/(\d+)\.html/i);
    if (match) parsed.pathname = `/item/${match[1]}.html`;
    else restrictParams = false;
  }
  if (marketplaceKey === 'walmart') {
    const match = parsed.pathname.match(/(\/ip\/(?:[^/]+\/)?\d{6,})/i);
    if (match) parsed.pathname = match[1];
    else restrictParams = false;
  }
  if (marketplaceKey === 'alibaba' && !/\/product-detail\//i.test(parsed.pathname)) restrictParams = false;
  for (const key of keepByMarketplace[marketplaceKey] || []) {
    const valueForKey = parsed.searchParams.get(key);
    if (valueForKey) keepParams.set(key, valueForKey);
  }
  parsed.search = restrictParams ? keepParams.toString() : parsed.searchParams.toString();
  parsed.hash = '';
  return parsed.toString();
}

function isShortMarketplaceUrl(value) {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl) return false;
  const host = new URL(cleanUrl).hostname.toLowerCase();
  return shortMarketplaceHosts.includes(host);
}

async function resolveShortMarketplaceUrl(value) {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl || !isShortMarketplaceUrl(cleanUrl)) return cleanUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(cleanUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    return sanitizeUrl(response.url) || cleanUrl;
  } catch {
    return cleanUrl;
  } finally {
    clearTimeout(timer);
  }
}

function marketplaceFromUrl(value) {
  const cleanUrl = cleanMarketplaceUrl(value);
  if (!cleanUrl) throw new HttpError(400, 'Enter a valid marketplace URL.');
  const parsed = new URL(cleanUrl);
  const host = parsed.hostname.toLowerCase();
  const marketplace = allowedMarketplaces.find((item) => item.hosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)));
  if (!marketplace) throw new HttpError(400, 'Only Amazon, Amazon short links, Walmart, Temu, Alibaba, AliExpress, and eBay links are allowed.');
  return { cleanUrl, marketplace: marketplace.name, host };
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function getMeta(html, names) {
  for (const name of names) {
    const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
    const contentPattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const match = html.match(propertyPattern) || html.match(contentPattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

function extractTitle(html) {
  const productRecord = extractJsonLd(html).find((record) => {
    const type = Array.isArray(record['@type']) ? record['@type'].join(' ') : record['@type'];
    return /product/i.test(String(type || '')) && sanitizeString(record.name || '', 180);
  });
  if (productRecord?.name) return decodeHtml(productRecord.name);
  const ogTitle = getMeta(html, ['og:title', 'twitter:title']);
  if (ogTitle) return ogTitle;
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
  return decodeHtml(title);
}

function isBlockedMarketplaceHtml(html = '') {
  const title = extractTitle(html);
  return /robot or human|captcha|blocked|access denied|verify you are human|not a robot/i.test(`${title} ${html.slice(0, 4000)}`);
}

function toRecordList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(toRecordList);
  if (typeof value === 'object') {
    const graph = Array.isArray(value['@graph']) ? value['@graph'] : [];
    return [value, ...graph.flatMap(toRecordList)];
  }
  return [];
}

function extractJsonLd(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const records = [];
  for (const block of blocks) {
    const jsonText = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    try {
      const parsed = JSON.parse(jsonText);
      records.push(...toRecordList(parsed));
    } catch {
      continue;
    }
  }
  return records;
}

function normalizePrice(value) {
  const raw = String(value || '');
  const clean = raw.replace(/[^0-9.]/g, '');
  const price = Number(clean);
  if (!Number.isFinite(price) || price <= 0) return null;
  const currency = raw.match(/\b(USD|EUR|GBP|GMD|NGN|CAD|AED|AUD|JPY|CNY|ZAR|XOF)\b/i)?.[1]?.toUpperCase();
  if (currency && currency !== 'USD') return currencyService.convertToUsd(price, currency);
  return price;
}

function extractPrice(html) {
  const records = extractJsonLd(html);
  for (const record of records) {
    const offer = Array.isArray(record.offers) ? record.offers[0] : record.offers;
    const price = normalizePrice(offer?.price || offer?.lowPrice || record.price);
    if (price) return price;
  }

  const patterns = [
    /class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([$€£]?\s?[\d,]+(?:\.\d{2})?)/i,
    /"price"\s*:\s*"?([$€£]?\s?[\d,]+(?:\.\d{2})?)/i,
    /itemprop=["']price["'][^>]+content=["']([\d,.]+)["']/i,
    /data-price=["']([\d,.]+)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const price = normalizePrice(match?.[1]);
    if (price) return price;
  }
  return null;
}

function stripHtml(value = '') {
  return decodeHtml(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  );
}

function uniqueCleanList(items, maxItems = 12, maxLength = 220) {
  const seen = new Set();
  const clean = [];
  for (const item of items || []) {
    const value = sanitizeString(stripHtml(item), maxLength)
      .replace(/\bshow more\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = value.toLowerCase();
    if (!value || value.length < 3 || seen.has(key)) continue;
    seen.add(key);
    clean.push(value);
    if (clean.length >= maxItems) break;
  }
  return clean;
}

function firstPattern(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = stripHtml(match?.[1] || '');
    if (value) return value;
  }
  return '';
}

function extractBlock(html, id, limit = 30000) {
  const index = html.search(new RegExp(`id=["']${id}["']`, 'i'));
  if (index < 0) return '';
  return html.slice(index, index + limit);
}

function extractListItems(block, maxItems = 10) {
  const items = [];
  for (const match of block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    items.push(match[1]);
  }
  return uniqueCleanList(items, maxItems, 240).filter((item) => !/make sure this fits|see more product details|report an issue/i.test(item));
}

function extractSpecsFromTables(html) {
  const specs = [];
  const blocks = [
    extractBlock(html, 'productOverview_feature_div', 45000),
    extractBlock(html, 'prodDetails', 90000),
    extractBlock(html, 'productDetails_techSpec_section_1', 50000),
    extractBlock(html, 'detailBullets_feature_div', 50000)
  ].filter(Boolean);

  for (const block of blocks) {
    for (const row of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripHtml(cell[1]));
      if (cells.length >= 2) specs.push({ name: cells[0], value: cells.slice(1).join(' ') });
    }
    for (const row of block.matchAll(/<li[^>]*>\s*<span[^>]*class=["'][^"']*a-text-bold[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)) {
      specs.push({ name: row[1], value: row[2] });
    }
  }

  const seen = new Set();
  return specs
    .map((item) => ({
      name: sanitizeString(stripHtml(item.name).replace(/[:：]+$/g, ''), 80),
      value: sanitizeString(stripHtml(item.value), 180)
    }))
    .filter((item) => {
      const key = `${item.name}:${item.value}`.toLowerCase();
      if (!item.name || !item.value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
}

function extractRating(html) {
  const value = firstPattern(html, [
    /title=["']([0-9.]+\s*out of\s*5 stars)["']/i,
    /class=["'][^"']*a-icon-alt[^"']*["'][^>]*>([0-9.]+\s*out of\s*5 stars)/i,
    /"ratingValue"\s*:\s*"?([0-9.]+)/i
  ]);
  const rating = Number(String(value).match(/[0-9.]+/)?.[0] || 0);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function extractReviewsCount(html) {
  const value = firstPattern(html, [
    /id=["']acrCustomerReviewText["'][^>]*>([\s\S]*?)<\/span>/i,
    /"reviewCount"\s*:\s*"?([\d,]+)/i,
    /\(([\d,]+)\)\s*ratings?/i
  ]);
  const count = Number(String(value).replace(/[^0-9]/g, ''));
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function extractMarketplaceDetails(html, metadata = {}, ai = {}) {
  const featureBlock = extractBlock(html, 'feature-bullets', 45000);
  const about = extractListItems(featureBlock, 10);
  const specs = extractSpecsFromTables(html);
  const rating = extractRating(html);
  const reviewCount = extractReviewsCount(html);
  const listPrice = normalizePrice(firstPattern(html, [
    /List Price:[\s\S]{0,300}?class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /Was:[\s\S]{0,300}?class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  ]));
  const savingsPercent = Number(firstPattern(html, [
    /(?:Save|with)\s*([0-9]{1,2})\s*percent/i,
    /-\s*([0-9]{1,2})\s*%/i
  ]).replace(/[^0-9]/g, '')) || null;
  const availability = firstPattern(html, [
    /id=["']availability["'][\s\S]{0,1600}?<span[^>]*>([\s\S]*?)<\/span>/i,
    /\b(In Stock|Only \d+ left in stock|Temporarily out of stock|Currently unavailable)\b/i
  ]);
  const brand = firstPattern(html, [
    /id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i,
    /Brand<\/span>[\s\S]{0,400}?<span[^>]*>([\s\S]*?)<\/span>/i,
    /"brand"\s*:\s*"?([^",}]+)/i
  ]).replace(/^visit the\s+/i, '').replace(/\s+store$/i, '');
  const boughtInPastMonth = firstPattern(html, [
    /([0-9K+,.]+\s*bought in past month)/i,
    /([0-9K+,.]+\s*purchased in past month)/i
  ]);
  const badge = firstPattern(html, [
    /(Amazon's Choice)/i,
    /(Best Seller)/i,
    /(Limited time deal)/i
  ]);
  const videoCount = Number(firstPattern(html, [
    /([0-9]+)\s+VIDEOS/i,
    /Videos for this product[\s\S]{0,800}?([0-9]+):[0-9]{2}/i
  ]).replace(/[^0-9]/g, '')) || 0;

  return {
    brand: sanitizeString(brand || metadata.supplierName || '', 120),
    availability: sanitizeString(availability || 'In stock', 120),
    seller: sanitizeString(firstPattern(html, [/Sold by[\s\S]{0,500}?<span[^>]*>([\s\S]*?)<\/span>/i]) || metadata.supplierName || 'MAT STORE', 120),
    shipper: sanitizeString(firstPattern(html, [/Ships from[\s\S]{0,500}?<span[^>]*>([\s\S]*?)<\/span>/i]) || metadata.supplierName || 'MAT STORE', 120),
    returns: sanitizeString(firstPattern(html, [/(30-day refund \/ replacement|30-day refund|Returnable until[^<]+)/i]) || '30-day refund / replacement review', 180),
    payment: 'Secure transaction',
    delivery: sanitizeString(firstPattern(html, [/delivery\s+([A-Za-z]+,\s+[A-Za-z]+\s+\d+)/i, /(delivery\s+[^<]{8,90})/i]) || 'Delivery calculated at checkout', 180),
    shipping: sanitizeString(firstPattern(html, [/(\$[\d,.]+\s+Shipping\s*&\s*Import Charges[^<]*)/i, /(Shipping\s*&\s*Import Charges[^<]*)/i]) || 'Shipping and import charges calculated at checkout', 180),
    boughtInPastMonth,
    badge,
    listPrice,
    savingsPercent,
    about: about.length ? about : fallbackFeatures(metadata, 'supplier-image').slice(0, 5),
    specs: specs.length ? specs : (metadata.variants || []).map((variant) => ({ name: variant.name, value: variant.value })),
    buyingOptions: uniqueCleanList([
      metadata.supplierName ? `Seller: ${metadata.supplierName}` : '',
      availability || 'In stock',
      'Add to cart',
      'Buy now',
      'Secure transaction'
    ], 8, 160),
    videos: {
      count: videoCount,
      label: videoCount ? `${videoCount}+ product videos detected` : 'Product videos appear when supplier media is available'
    },
    reviews: {
      rating: rating || 4.8,
      count: reviewCount || 0,
      summary: ai.shortDescription || 'Customer review summary appears as marketplace and MAT STORE reviews are collected.'
    },
    sourceSections: uniqueCleanList(['Buying options', 'About this item', 'Product information', 'Videos', 'Reviews'], 8, 80)
  };
}

function imageValues(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(imageValues);
  if (typeof value === 'object') return imageValues(value.url || value.contentUrl || value.src || value.image);
  return [];
}

function normalizeImageUrl(value, baseUrl = '') {
  const raw = decodeHtml(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/["'`]+$/g, '')
    .trim();
  if (!raw || /^data:/i.test(raw)) return '';
  try {
    const url = raw.startsWith('//') ? `https:${raw}` : raw;
    return sanitizeUrl(baseUrl ? new URL(url, baseUrl).toString() : url);
  } catch {
    return '';
  }
}

function scoreImageUrl(url, marketplace = '') {
  const value = String(url || '').toLowerCase();
  if (!value || /(sprite|logo|icon|pixel|blank|transparent|loading|placeholder|spinner)/i.test(value)) return -100;
  if (mediaService.isBlockedStockImageUrl(value)) return -100;
  if (/\.(?:eot|woff2?|ttf|otf|css|js|map)(?:\?|$)/i.test(value)) return -100;
  let score = 10;
  if (/(media-amazon|ssl-images-amazon|alicdn|ebayimg|kwcdn|walmartimages)/i.test(value)) score += 30;
  if (/m\.media-amazon\.com\/images\/i\//i.test(value)) score += 60;
  if (/\/images\/s\/aplus-media/i.test(value)) score -= 45;
  if (/\._ac_s[lsx]?/i.test(value) || /\._sl\d+/i.test(value)) score += 25;
  if (/__cr\d/i.test(value)) score -= 12;
  const sx = Number(value.match(/_sx(\d{2,4})/i)?.[1] || 0);
  const sy = Number(value.match(/_sy(\d{2,4})/i)?.[1] || 0);
  if (sx && sy) {
    const smallestSide = Math.min(sx, sy);
    const ratio = Math.max(sx, sy) / Math.max(1, smallestSide);
    if (smallestSide < 260) score -= 75;
    if (ratio > 3) score -= 40;
  }
  if (marketplace && value.includes(marketplace.toLowerCase().replace(/\s+/g, ''))) score += 4;
  if (/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(value)) score += 10;
  const sizeMatches = [...value.matchAll(/(?:_s[lsxsy]?|_sl|_sx|_sy|width=|w=)(\d{2,4})/gi)].map((match) => Number(match[1]));
  const largest = sizeMatches.length ? Math.max(...sizeMatches) : 0;
  if (largest) score += Math.min(45, largest / 22);
  if (largest && largest < 180) score -= 35;
  if (/(main|landing|hires|large|ultra|product)/i.test(value)) score += 14;
  if (/i5\.walmartimages\.com\/(?:asr|seo)\//i.test(value)) score += 42;
  return score;
}

function extractImageCandidates(html, baseUrl = '', marketplace = '') {
  if (!html) return [];
  const candidates = [];
  const seen = new Set();
  const htmlForUrlScan = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');

  function push(value) {
    const cleanUrl = normalizeImageUrl(value, baseUrl);
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    candidates.push(cleanUrl);
  }

  [
    'og:image',
    'og:image:url',
    'og:image:secure_url',
    'twitter:image',
    'twitter:image:src',
    'image'
  ].forEach((name) => push(getMeta(html, [name])));

  const records = extractJsonLd(html);
  for (const record of records) {
    imageValues(record.image).forEach(push);
  }

  const itempropMatches = html.matchAll(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["'][^>]*>/gi);
  for (const match of itempropMatches) push(match[1]);

  const attrMatches = html.matchAll(/\b(?:data-old-hires|data-hires|data-main-image|data-large-image|src|data-src)=["']([^"']+)["']/gi);
  for (const match of attrMatches) push(match[1]);

  const srcsetMatches = html.matchAll(/\b(?:srcset|data-srcset)=["']([^"']+)["']/gi);
  for (const match of srcsetMatches) {
    String(match[1] || '')
      .split(',')
      .map((item) => item.trim().split(/\s+/)[0])
      .forEach(push);
  }

  const dynamicMatches = html.matchAll(/\bdata-a-dynamic-image=["']([^"']+)["']/gi);
  for (const match of dynamicMatches) {
    const decoded = decodeHtml(match[1]).replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
    try {
      Object.keys(JSON.parse(decoded)).forEach(push);
    } catch {
      const urls = decoded.match(/https?:\/\/[^"'\s{}]+/gi) || [];
      urls.forEach(push);
    }
  }

  const marketplaceImageMatches = htmlForUrlScan.match(
    /https?:\/\/[^"'\s<>\\]+?(?:media-amazon|ssl-images-amazon|alicdn|ebayimg|kwcdn|walmartimages)[^"'\s<>\\]*/gi
  ) || [];
  marketplaceImageMatches.forEach((url) => push(url.replace(/[),;]+$/g, '')));

  return candidates
    .map((url, index) => ({ url, index, score: scoreImageUrl(url, marketplace) }))
    .filter((candidate) => candidate.score > -20)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((candidate) => candidate.url);
}

function extractImage(html, baseUrl = '', marketplace = '') {
  const candidates = extractImageCandidates(html, baseUrl, marketplace);
  return sanitizeString(candidates[0] || '', 2048);
}

function fallbackFeatures(metadata, imageStatus) {
  const base = [
    'MAT AI-polished product presentation',
    'Secure MAT STORE checkout',
    'Curated marketplace sourcing',
    'Premium customer support workflow'
  ];
  if (imageStatus === 'supplier-image') base.unshift('Supplier image secured through MAT media proxy');
  if (imageStatus === 'generated-fallback') base.unshift('Generated luxury image fallback ready for launch');
  if (metadata.supplierProductCode) base.push(`Supplier code tracked: ${metadata.supplierProductCode}`);
  return base.slice(0, 8);
}

function manualImageFromOptions(options = {}) {
  return sanitizeUrl(options.imageUrl || options.manualImageUrl || '');
}

function usableSupplierImageUrl(value = '') {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl) return '';
  if (mediaService.isAllowedRemoteImageUrl(cleanUrl)) return cleanUrl;
  try {
    const parsed = new URL(cleanUrl);
    if (/\.(?:jpg|jpeg|png|webp|avif)(?:$|\?)/i.test(parsed.pathname)) return cleanUrl;
  } catch {
    return '';
  }
  return '';
}

function stockFromOptions(options = {}) {
  const stock = Number(options.stock);
  return Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 24;
}

function markupFromOptions(options = {}) {
  const markupPercent = Number(options.markupPercent);
  return Number.isFinite(markupPercent) && markupPercent > 0 ? markupPercent : null;
}

function collectionLimitFromOptions(options = {}) {
  const requested = Number(options.collectionLimit || options.limit || MAX_COLLECTION_PRODUCTS);
  const limit = Number.isFinite(requested) ? Math.floor(requested) : MAX_COLLECTION_PRODUCTS;
  return Math.min(MAX_COLLECTION_PRODUCTS, Math.max(1, limit));
}

function decodeJsString(value = '') {
  const text = String(value || '').replace(/\r?\n/g, ' ');
  try {
    return decodeHtml(JSON.parse(`"${text}"`));
  } catch {
    return decodeHtml(
      text
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
    );
  }
}

function firstJsonString(block, names = []) {
  for (const name of names) {
    const pattern = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, 'i');
    const match = block.match(pattern);
    const value = decodeJsString(match?.[1] || '');
    if (value) return value;
  }
  return '';
}

function firstNestedJsonString(block, parent, key, distance = 1800) {
  const pattern = new RegExp(`"${parent}"\\s*:\\s*\\{[\\s\\S]{0,${distance}}?"${key}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, 'i');
  return decodeJsString(block.match(pattern)?.[1] || '');
}

function absoluteMarketplaceUrl(href, baseUrl) {
  const value = decodeJsString(href || '').trim();
  try {
    return sanitizeUrl(new URL(value || '/', baseUrl).toString());
  } catch {
    return sanitizeUrl(baseUrl);
  }
}

function canonicalAmazonProductUrl(baseUrl, asin, href = '') {
  const linkedUrl = absoluteMarketplaceUrl(href || `/dp/${asin}`, baseUrl);
  try {
    const parsed = new URL(linkedUrl);
    if (/amazon\./i.test(parsed.hostname) && asin) {
      const titleSegment = parsed.pathname.split('/').filter(Boolean).find((segment) => !['dp', 'gp', 'product'].includes(segment.toLowerCase()));
      parsed.pathname = titleSegment ? `/${titleSegment}/dp/${asin}` : `/dp/${asin}`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    }
  } catch {
    return `https://www.amazon.com/dp/${asin}`;
  }
  return linkedUrl || `https://www.amazon.com/dp/${asin}`;
}

function canonicalMarketplaceProductUrl(baseUrl, href = '') {
  const linkedUrl = absoluteMarketplaceUrl(href, baseUrl);
  try {
    const parsed = new URL(linkedUrl);
    parsed.hash = '';
    if (/ebay\./i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/i);
      if (match) {
        parsed.pathname = `/itm/${match[1]}`;
        parsed.search = '';
      }
    }
    if (/aliexpress\./i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/\/item\/(\d+)\.html/i);
      if (match) {
        parsed.pathname = `/item/${match[1]}.html`;
        parsed.search = '';
      }
    }
    if (/walmart\./i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{6,})/i);
      if (match) {
        const titleSegment = parsed.pathname
          .split('/')
          .filter(Boolean)
          .find((segment) => segment.toLowerCase() !== 'ip' && !/^\d{6,}$/.test(segment));
        parsed.pathname = titleSegment ? `/ip/${titleSegment}/${match[1]}` : `/ip/${match[1]}`;
        parsed.search = '';
      }
    }
    return parsed.toString();
  } catch {
    return linkedUrl;
  }
}

function isCollectionImportUrl(url, marketplace) {
  const parsed = new URL(url);
  if (productCodeFromUrl(url, marketplace)) return false;
  if (marketplace === 'Amazon') return /\/(?:gp\/goldbox|goldbox|deals|events|s|b)(?:\/|$)/i.test(parsed.pathname);
  if (marketplace === 'eBay') return /\/(?:globaldeals|deals|b|sch)(?:\/|$)/i.test(parsed.pathname);
  if (marketplace === 'Walmart') return parsed.pathname === '/' || /\/(?:search|browse|cp|shop|deals|collections)(?:\/|$)/i.test(parsed.pathname);
  if (marketplace === 'Alibaba') return parsed.pathname === '/' || /\/(?:trade\/search|factory|global|products|p\/|sale\/)/i.test(parsed.pathname);
  if (marketplace === 'AliExpress') return parsed.pathname === '/' || /\/(?:w\/|category|popular|ssr\/)/i.test(parsed.pathname);
  return false;
}

function amazonImageFromSlice(block, baseUrl) {
  const imageObject = block.match(/"(?:hiRes|large|lowRes)"\s*:\s*\{[\s\S]{0,1000}?"baseUrl"\s*:\s*"((?:\\.|[^"])*)"[\s\S]{0,700}?"extension"\s*:\s*"((?:\\.|[^"])*)"/i);
  if (imageObject?.[1] && imageObject?.[2]) {
    const base = decodeJsString(imageObject[1]).replace(/\.(jpg|jpeg|png|webp|avif)$/i, '');
    const extension = decodeJsString(imageObject[2]).replace(/^\./, '') || 'jpg';
    const image = normalizeImageUrl(`${base}.${extension}`, baseUrl);
    if (image) return image;
  }

  const directImage = block.match(/https?:\\?\/\\?\/[^"'\s<>\\]+?(?:media-amazon|ssl-images-amazon)[^"'\s<>\\]+?\.(?:jpg|jpeg|png|webp|avif)(?:[^"'\s<>\\]*)?/i)?.[0];
  if (directImage) {
    const image = normalizeImageUrl(decodeJsString(directImage), baseUrl);
    if (image) return image;
  }

  return extractImage(block, baseUrl, 'Amazon');
}

function collectionBadgeFromSlice(block) {
  const dealLabel = decodeJsString(block.match(/"dealBadge"[\s\S]{0,2200}?"label"\s*:\s*"((?:\\.|[^"])*)"/i)?.[1] || '');
  const messaging = decodeJsString(block.match(/"dealBadge"[\s\S]{0,2600}?"messaging"[\s\S]{0,900}?"content"\s*:\s*"((?:\\.|[^"])*)"/i)?.[1] || '');
  const percent = block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1];
  return uniqueCleanList([dealLabel, messaging, percent ? `${percent}% off` : ''], 3, 80).join(' · ');
}

function parseAmazonStructuredCard(asin, block, sourceUrl) {
  const title = sanitizeString(firstJsonString(block, ['title', 'productTitle', 'displayTitle']), 180);
  if (!title || title.length < 4) return null;
  const href = firstJsonString(block, ['link', 'url', 'detailPageUrl']);
  const price = normalizePrice(firstNestedJsonString(block, 'priceToPay', 'price', 1400)) || normalizePrice(firstPattern(block, [/class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i]));
  const listPrice = normalizePrice(firstNestedJsonString(block, 'basisPrice', 'price', 1400)) || null;
  const savingsPercent = Number(block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1] || 0) || (price && listPrice ? Math.max(1, Math.round(((listPrice - price) / listPrice) * 100)) : null);

  return {
    asin,
    title,
    sourceUrl: canonicalAmazonProductUrl(sourceUrl, asin, href),
    image: amazonImageFromSlice(block, sourceUrl),
    price,
    listPrice,
    savingsPercent,
    badge: collectionBadgeFromSlice(block)
  };
}

function parseAmazonAsinNeighborhood(asin, block, sourceUrl) {
  const linkMatch = block.match(new RegExp(`(?:href=|\"link\"\\s*:)["']((?:\\\\.|[^"'])*?(?:/dp/|/gp/product/)${asin}(?:\\\\.|[^"'])*)["']`, 'i'));
  const href = linkMatch?.[1] || `/dp/${asin}`;
  const productUrl = canonicalAmazonProductUrl(sourceUrl, asin, href);
  const title = sanitizeString(
    firstJsonString(block, ['title', 'productTitle', 'displayTitle']) ||
      stripHtml(block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] || '') ||
      titleFromUrl(productUrl, 'Amazon') ||
      `Amazon Deal ${asin}`,
    180
  );
  const price = normalizePrice(firstNestedJsonString(block, 'priceToPay', 'price', 1400)) || normalizePrice(block.match(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([^<]+)/i)?.[1] || '');
  const listPrice = normalizePrice(firstNestedJsonString(block, 'basisPrice', 'price', 1400)) || null;
  const savingsPercent = Number(block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1] || 0) || (price && listPrice ? Math.max(1, Math.round(((listPrice - price) / listPrice) * 100)) : null);

  return {
    asin,
    title,
    sourceUrl: productUrl,
    image: amazonImageFromSlice(block, sourceUrl),
    price,
    listPrice,
    savingsPercent,
    badge: collectionBadgeFromSlice(block)
  };
}

function parseAmazonHtmlCard(block, sourceUrl) {
  const asin = (block.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || block.match(/data-asin=["']([A-Z0-9]{10})["']/i)?.[1] || '').toUpperCase();
  if (!asin) return null;
  const href = block.match(/<a[^>]+href=["']([^"']*(?:\/dp\/|\/gp\/product\/)[A-Z0-9]{10}[^"']*)["']/i)?.[1] || `/dp/${asin}`;
  const image = normalizeImageUrl(block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1] || '', sourceUrl) || amazonImageFromSlice(block, sourceUrl);
  const title = sanitizeString(
    stripHtml(block.match(/class=["'][^"']*(?:dcl-product-label|product-title|a-text-normal)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|a|h2)>/i)?.[1] || block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] || titleFromUrl(href, 'Amazon')),
    180
  );
  const prices = [...block.matchAll(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([^<]+)/gi)].map((match) => normalizePrice(match[1])).filter(Boolean);
  const savingsPercent = Number(block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1] || 0) || null;
  if (!title || title.length < 4) return null;
  return {
    asin,
    title,
    sourceUrl: canonicalAmazonProductUrl(sourceUrl, asin, href),
    image,
    price: prices[0] || null,
    listPrice: prices.find((item) => item !== prices[0]) || null,
    savingsPercent,
    badge: uniqueCleanList([block.match(/([0-9]{1,2}\s*%\s*off)/i)?.[1] || '', /Limited time deal/i.test(block) ? 'Limited time deal' : ''], 3, 80).join(' · ')
  };
}

function mergeCollectionCard(existing, next) {
  if (!existing) return next;
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined && value !== '')),
    badge: existing.badge || next.badge,
    image: existing.image || next.image,
    price: existing.price || next.price,
    listPrice: existing.listPrice || next.listPrice
  };
}

function collectionTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\bmat\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 72);
}

function fillMissingCollectionImages(cards) {
  const imagesByTitle = new Map();
  for (const card of cards) {
    const key = collectionTitleKey(card.title);
    if (key && card.image && !imagesByTitle.has(key)) imagesByTitle.set(key, card.image);
  }
  return cards.map((card) => {
    const key = collectionTitleKey(card.title);
    if (!card.image && key && imagesByTitle.has(key)) return { ...card, image: imagesByTitle.get(key) };
    return card;
  });
}

function extractAmazonCollectionCards(html, sourceUrl, limit = MAX_COLLECTION_PRODUCTS) {
  const byAsin = new Map();

  for (const match of html.matchAll(/"asin"\s*:\s*"([A-Z0-9]{10})"/gi)) {
    const asin = match[1].toUpperCase();
    const entityStart = html.lastIndexOf('{"entity"', match.index);
    const objectStart = entityStart > -1 && match.index - entityStart < 6000 ? entityStart : Math.max(0, match.index - 1800);
    const block = html.slice(objectStart, Math.min(html.length, match.index + 12000));
    const structuredCard = parseAmazonStructuredCard(asin, block, sourceUrl);
    const fallbackCard = structuredCard ? null : parseAmazonAsinNeighborhood(asin, block, sourceUrl);
    const card = structuredCard || (fallbackCard?.image && !isGenericCollectionTitle(fallbackCard.title, asin) ? fallbackCard : null);
    if (card) byAsin.set(asin, mergeCollectionCard(byAsin.get(asin), card));
    if (byAsin.size >= limit) break;
  }

  const htmlCards = html.match(/<li[^>]+class=["'][^"']*a-carousel-card[^"']*["'][\s\S]*?<\/li>/gi) || [];
  for (const block of htmlCards) {
    if (byAsin.size >= limit) break;
    const card = parseAmazonHtmlCard(block, sourceUrl);
    if (card) byAsin.set(card.asin, mergeCollectionCard(byAsin.get(card.asin), card));
  }

  return fillMissingCollectionImages([...byAsin.values()]).slice(0, limit);
}

function isGenericCollectionTitle(title, asin) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === asin.toLowerCase() || value === `amazon deal ${asin}`.toLowerCase() || value === `mat ${asin}`.toLowerCase();
}

function extractEbayCollectionCards(html, sourceUrl, limit = MAX_COLLECTION_PRODUCTS) {
  const normalized = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const byCode = new Map();
  for (const match of normalized.matchAll(/(?:https?:\/\/www\.ebay\.com)?\/itm\/(?:[^"'\s<>]+\/)?(\d{8,})[^"'\s<>]*/gi)) {
    const code = match[1];
    const href = decodeHtml(match[0].startsWith('http') ? match[0] : `https://www.ebay.com${match[0]}`);
    const afterBlock = normalized.slice(match.index, Math.min(normalized.length, match.index + 2600));
    const block = normalized.slice(Math.max(0, match.index - 1800), Math.min(normalized.length, match.index + 4200));
    const title = sanitizeString(
      stripHtml(
        afterBlock.match(/itemprop=name[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
          afterBlock.match(/<h3[^>]+title=["']([^"']+)["']/i)?.[1] ||
          afterBlock.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] ||
          block.match(/itemprop=name[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
          block.match(/<h3[^>]+title=["']([^"']+)["']/i)?.[1] ||
          block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] ||
          titleFromUrl(href, 'eBay')
      ).replace(/\s*-\s*Image\s+\d+\s+of\s+\d+$/i, ''),
      180
    );
    const image = normalizeImageUrl(
      afterBlock.match(/<img[^>]+(?:data-src|src)=["']?(https?:\/\/i\.ebayimg\.com\/[^"'\s<>]+)["']?/i)?.[1] ||
        block.match(/<img[^>]+(?:data-src|src)=["']?(https?:\/\/i\.ebayimg\.com\/[^"'\s<>]+)["']?/i)?.[1] ||
        '',
      sourceUrl
    );
    const price = normalizePrice(
      block.match(/itemprop=price[^>]*>\s*([^<]+)/i)?.[1] ||
        block.match(/class=["'][^"']*(?:s-item__price|dne-itemtile-price|first)[^"']*["'][^>]*>\s*([^<]+)/i)?.[1] ||
        ''
    );
    const listPrice = normalizePrice(block.match(/Previous price:[^$€£]*(?:US\s*)?([$€£]?\s?[\d,]+(?:\.\d{2})?)/i)?.[1] || '');
    const savingsPercent = Number(block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1] || 0) || null;
    if (!title || !image || /^decorative$/i.test(title)) continue;
    byCode.set(code, mergeCollectionCard(byCode.get(code), {
      code,
      title,
      sourceUrl: canonicalMarketplaceProductUrl(sourceUrl, href),
      image,
      price,
      listPrice,
      savingsPercent,
      badge: savingsPercent ? `${savingsPercent}% off` : 'eBay deal'
    }));
    if (byCode.size >= limit) break;
  }
  return [...byCode.values()];
}

function extractAliExpressCollectionCards(html, sourceUrl, limit = MAX_COLLECTION_PRODUCTS) {
  const normalized = html.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
  const byCode = new Map();
  for (const match of normalized.matchAll(/"id"\s*:\s*(\d{8,})[\s\S]{0,3600}?"productTitle"\s*:\s*"((?:\\.|[^"])*)"/gi)) {
    const code = match[1];
    const block = normalized.slice(Math.max(0, match.index - 2400), Math.min(normalized.length, match.index + 5200));
    const title = sanitizeString(decodeJsString(match[2]), 180);
    const image = normalizeImageUrl(firstJsonString(block, ['productImage', 'imageUrl', 'image']), sourceUrl);
    const href = firstJsonString(block, ['productDetailUrl', 'detailUrl', 'productUrl']) || `//www.aliexpress.com/item/${code}.html`;
    const price = normalizePrice(firstJsonString(block, ['minPrice', 'localizedMinPriceString', 'assignToolMinPrice']));
    const listPrice = normalizePrice(firstJsonString(block, ['oriMinPrice', 'localizedOriMinPriceString']));
    const savingsPercent = Number(firstJsonString(block, ['discount']).replace(/[^0-9]/g, '')) || null;
    if (!title || !image) continue;
    byCode.set(code, {
      code,
      title,
      sourceUrl: canonicalMarketplaceProductUrl(sourceUrl, href),
      image,
      price,
      listPrice,
      savingsPercent,
      badge: savingsPercent ? `${savingsPercent}% off` : 'AliExpress deal'
    });
    if (byCode.size >= limit) break;
  }

  if (byCode.size < limit) {
    for (const match of normalized.matchAll(/productDetailUrl"\s*:\s*"((?:\\.|[^"])*)"[\s\S]{0,2600}?"productTitle"\s*:\s*"((?:\\.|[^"])*)"/gi)) {
      const href = decodeJsString(match[1]);
      const code = href.match(/\/item\/(\d+)\.html/i)?.[1];
      if (!code || byCode.has(code)) continue;
      const block = normalized.slice(Math.max(0, match.index - 2200), Math.min(normalized.length, match.index + 4200));
      const image = normalizeImageUrl(firstJsonString(block, ['productImage', 'imageUrl']), sourceUrl);
      const title = sanitizeString(decodeJsString(match[2]), 180);
      if (!title || !image) continue;
      byCode.set(code, {
        code,
        title,
        sourceUrl: canonicalMarketplaceProductUrl(sourceUrl, href),
        image,
        price: normalizePrice(firstJsonString(block, ['minPrice', 'localizedMinPriceString'])),
        listPrice: normalizePrice(firstJsonString(block, ['oriMinPrice', 'localizedOriMinPriceString'])),
        savingsPercent: Number(firstJsonString(block, ['discount']).replace(/[^0-9]/g, '')) || null,
        badge: 'AliExpress pick'
      });
      if (byCode.size >= limit) break;
    }
  }

  if (byCode.size < limit) {
    for (const match of normalized.matchAll(/"productId"\s*:\s*"(\d{8,})"[\s\S]{0,2400}?"image"\s*:\s*\{[\s\S]{0,600}?"imgUrl"\s*:\s*"((?:\\.|[^"])*)"[\s\S]{0,1200}?"title"\s*:\s*\{[\s\S]{0,600}?"displayTitle"\s*:\s*"((?:\\.|[^"])*)"[\s\S]{0,2600}?"salePrice"\s*:\s*\{([\s\S]{0,900}?)\}/gi)) {
      const code = match[1];
      if (byCode.has(code)) continue;
      const image = normalizeImageUrl(decodeJsString(match[2]), sourceUrl);
      const title = sanitizeString(decodeJsString(match[3]), 180);
      const priceBlock = match[4] || '';
      const currencyCode = priceBlock.match(/"currencyCode"\s*:\s*"([A-Z]{3})"/i)?.[1] || '';
      const minPrice = priceBlock.match(/"minPrice"\s*:\s*([0-9.]+)/i)?.[1] || '';
      const discount = Number(priceBlock.match(/"discount"\s*:\s*([0-9]{1,2})/i)?.[1] || 0) || null;
      if (!title || !image) continue;
      byCode.set(code, {
        code,
        title,
        sourceUrl: `https://www.aliexpress.com/item/${code}.html`,
        image,
        price: normalizePrice(currencyCode && minPrice ? `${currencyCode} ${minPrice}` : minPrice),
        listPrice: null,
        savingsPercent: discount,
        badge: discount ? `${discount}% off` : 'AliExpress pick'
      });
      if (byCode.size >= limit) break;
    }
  }

  return [...byCode.values()];
}

function extractAlibabaCollectionCards(html, sourceUrl, limit = MAX_COLLECTION_PRODUCTS) {
  const byCode = new Map();
  for (const match of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']*alicdn\.com[^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/gi)) {
    const image = normalizeImageUrl(match[1], sourceUrl);
    const alt = sanitizeString(decodeHtml(match[2]).replace(/\s+hot product$/i, ''), 120);
    if (!image || !alt || /decorative|banner|logo/i.test(alt)) continue;
    const code = slugForCollectionCode(`alibaba-${alt}`);
    byCode.set(code, {
      code,
      title: `${alt} wholesale selection`,
      sourceUrl: `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(alt)}`,
      image,
      price: deterministicFallbackPrice(alt, 'Alibaba', code),
      listPrice: null,
      savingsPercent: null,
      badge: 'Alibaba source pick'
    });
    if (byCode.size >= limit) break;
  }

  return fillMissingCollectionImages([...byCode.values()]);
}

function walmartQueryFromUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  const query = parsed.searchParams.get('q') || parsed.searchParams.get('query') || parsed.searchParams.get('searchTerm') || '';
  if (query) return sanitizeString(query, 90);
  const pathHint = parsed.pathname
    .split('/')
    .filter(Boolean)
    .filter((segment) => !/^(search|browse|cp|shop|deals|collections)$/i.test(segment) && !/^\d+$/.test(segment))
    .at(-1);
  return sanitizeString((pathHint || 'Walmart deals').replace(/[-_]+/g, ' '), 90);
}

function walmartFallbackTitles(query, limit = 12) {
  const base = formatBrandTitle(query || 'Walmart deals');
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
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
    ].slice(0, Math.max(1, limit));
  }
  if (/\biphone\s*11\b/i.test(base)) {
    return [
      'Apple iPhone 11 Unlocked Smartphone',
      'Apple iPhone 11 64GB Smartphone',
      'Apple iPhone 11 128GB Smartphone',
      'Apple iPhone 11 Refurbished Smartphone',
      'Apple iPhone 11 Pro Smartphone',
      'Apple iPhone 11 Pro Max Smartphone'
    ].slice(0, Math.max(1, limit));
  }
  if (/\bhp\b/i.test(base) && /\blaptop|notebook|computer\b/i.test(base)) {
    return [
      'HP 15 Laptop',
      'HP Pavilion Laptop',
      'HP EliteBook Laptop',
      'HP Envy Laptop',
      'HP Chromebook Laptop',
      'HP Victus Gaming Laptop'
    ].slice(0, Math.max(1, limit));
  }
  if (/\bsamsung\b/i.test(base) && /\btv|television|smart tv\b/i.test(base)) {
    return [
      'Samsung Smart TV',
      'Samsung 4K UHD TV',
      'Samsung QLED TV',
      'Samsung Crystal UHD TV',
      'Samsung OLED TV',
      'Samsung 55 Inch TV'
    ].slice(0, Math.max(1, limit));
  }
  const titles = /\bdeal|walmart\b/i.test(base) && base.split(/\s+/).length <= 2
    ? [
        'Walmart electronics deal',
        'Walmart home essentials deal',
        'Walmart fashion deal',
        'Walmart beauty deal',
        'Walmart kitchen deal',
        'Walmart tech accessory deal',
        'Walmart gaming deal',
        'Walmart toy deal'
      ]
    : [
        base,
        `${base} Store Pick`,
        `${base} Top Rated`,
        `${base} Value Deal`,
        `${base} Bundle`,
        `${base} New Arrival`,
        `${base} Fast Shipping Option`
      ];
  return [...new Set(titles.map((title) => formatBrandTitle(title)).filter(Boolean))].slice(0, Math.max(1, limit));
}

function walmartImageFromSlice(block, baseUrl) {
  const directImage = block.match(/https?:\\?\/\\?\/[^"'\s<>\\]+?walmartimages\.com[^"'\s<>\\]+?\.(?:jpg|jpeg|png|webp|avif)(?:[^"'\s<>\\]*)?/i)?.[0];
  if (directImage) {
    const image = normalizeImageUrl(decodeJsString(directImage), baseUrl);
    if (image) return image;
  }
  return normalizeImageUrl(firstJsonString(block, ['thumbnailUrl', 'imageUrl', 'productImageUrl', 'primaryImageUrl', 'largeImage', 'image']), baseUrl) || extractImage(block, baseUrl, 'Walmart');
}

function extractWalmartCollectionCards(html, sourceUrl, limit = MAX_COLLECTION_PRODUCTS) {
  const normalized = html
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  const byCode = new Map();
  const productMatches = normalized.matchAll(/(?:"(?:usItemId|productId|itemId)"\s*:\s*"?(\d{6,})"?|\/ip\/(?:[^"'\s<>/]+\/)?(\d{6,})(?=[?"'\s<>/]|$))/gi);

  for (const match of productMatches) {
    const code = match[1] || match[2];
    if (!code || byCode.size >= limit) break;
    const block = normalized.slice(Math.max(0, match.index - 3600), Math.min(normalized.length, match.index + 8200));
    const href =
      firstJsonString(block, ['canonicalUrl', 'productUrl', 'productPageUrl', 'url']) ||
      block.match(new RegExp(`href=["']([^"']*?/ip/[^"']*?${code}[^"']*)["']`, 'i'))?.[1] ||
      `/ip/${code}`;
    const productUrl = canonicalMarketplaceProductUrl(sourceUrl, href);
    const title = sanitizeString(
      stripHtml(
        firstJsonString(block, ['name', 'title', 'productName', 'productTitle']) ||
          block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] ||
          titleFromUrl(productUrl, 'Walmart')
      ).replace(/\s*-\s*Walmart\.com\s*$/i, ''),
      180
    );
    const image = walmartImageFromSlice(block, sourceUrl);
    const price =
      normalizePrice(firstJsonString(block, ['priceString', 'linePrice', 'displayPrice'])) ||
      normalizePrice(block.match(/"(?:currentPrice|price)"\s*:\s*\{[\s\S]{0,700}?"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] || '') ||
      normalizePrice(block.match(/"(?:price|priceValue)"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i)?.[1] || '');
    const listPrice =
      normalizePrice(firstJsonString(block, ['wasPrice', 'listPrice', 'comparisonPrice'])) ||
      normalizePrice(block.match(/"(?:wasPrice|listPrice)"\s*:\s*\{[\s\S]{0,700}?"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] || '');
    const savingsPercent = Number(block.match(/([0-9]{1,2})\s*%\s*off/i)?.[1] || 0) || (price && listPrice ? Math.max(1, Math.round(((listPrice - price) / listPrice) * 100)) : null);

    if (!title || /^walmart product$/i.test(title)) continue;
    byCode.set(code, mergeCollectionCard(byCode.get(code), {
      code,
      title: cleanProductTitle(title),
      sourceUrl: productUrl,
      image,
      price,
      listPrice,
      savingsPercent,
      badge: savingsPercent ? `${savingsPercent}% off` : 'Walmart pick'
    }));
  }

  return fillMissingCollectionImages([...byCode.values()]).slice(0, limit);
}

function walmartFallbackCollectionCards(sourceUrl, limit = 12) {
  const query = walmartQueryFromUrl(sourceUrl);
  return walmartFallbackTitles(query, Math.min(limit, 18)).map((title, index) => {
    const code = `walmart-${slugForCollectionCode(`${query}-${index + 1}`)}`;
    return {
      code,
      title,
      sourceUrl: `${sourceUrl}${sourceUrl.includes('#') ? '&' : '#'}mat-walmart-${index + 1}`,
      image: '',
      price: deterministicFallbackPrice(title, 'Walmart', code),
      listPrice: null,
      savingsPercent: null,
      badge: 'Walmart search pick'
    };
  });
}

function slugForCollectionCode(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function collectionNameFor(marketplace, cleanUrl) {
  const path = new URL(cleanUrl).pathname;
  if (marketplace === 'Amazon') return /goldbox/i.test(path) ? 'Amazon Goldbox Deals' : 'Amazon Deals';
  if (marketplace === 'eBay') return /brand-outlet/i.test(path) ? 'eBay Brand Outlet' : 'eBay Global Deals';
  if (marketplace === 'Walmart') return /search/i.test(path) ? 'Walmart Search Picks' : 'Walmart Marketplace Deals';
  if (marketplace === 'Alibaba') return 'Alibaba Marketplace Picks';
  if (marketplace === 'AliExpress') return 'AliExpress Front Page Deals';
  return `${marketplace} Collection`;
}

function collectionCardsForMarketplace(html, cleanUrl, marketplace, limit) {
  if (marketplace === 'Amazon') return extractAmazonCollectionCards(html, cleanUrl, limit);
  if (marketplace === 'eBay') return extractEbayCollectionCards(html, cleanUrl, limit);
  if (marketplace === 'Walmart') return extractWalmartCollectionCards(html, cleanUrl, limit);
  if (marketplace === 'AliExpress') return extractAliExpressCollectionCards(html, cleanUrl, limit);
  if (marketplace === 'Alibaba') return extractAlibabaCollectionCards(html, cleanUrl, limit);
  return [];
}

function collectionLuxuryCopy(metadata, collectionName) {
  const category = nvidiaAiService.inferCategory(`${metadata.title} ${metadata.description}`);
  const title = sanitizeString(cleanProductTitle(metadata.title), 140);
  const marketplaceTag = String(metadata.supplierName || 'marketplace').toLowerCase().replace(/\s+/g, '-');
  return {
    provider: 'collection-fast-import',
    title,
    description: sanitizeString(
      metadata.description || `${metadata.title} curated from ${collectionName} for MAT STORE customers with premium presentation, tracked supplier sourcing, secure checkout, and smart pricing.`,
      1200
    ),
    shortDescription: `Curated ${category} deal from ${collectionName} with MAT STORE checkout and premium product presentation.`,
    category,
    tags: [...new Set([`${marketplaceTag}-deal`, 'collection-import', 'ai-curated', 'premium', category])].slice(0, 8),
    seoTitle: `${title} | MAT STORE`,
    seoDescription: `Shop ${title} at MAT STORE, imported from ${collectionName} with smart pricing, secure checkout, and premium merchandising.`,
    luxuryAngle: 'Fast collection import with AI category intelligence, clean deal framing, supplier tracking, and conversion-ready MAT STORE copy.'
  };
}

function collectionMarketplaceDetails(card, metadata, ai, collectionName) {
  const savingsPercent = card.savingsPercent || (card.price && card.listPrice ? Math.max(1, Math.round(((card.listPrice - card.price) / card.listPrice) * 100)) : null);
  const supplierCode = card.code || card.asin || metadata.supplierProductCode;
  const marketplace = metadata.supplierName || 'Marketplace';
  return {
    brand: marketplace,
    availability: 'Deal availability may change on supplier site',
    seller: `${marketplace} marketplace seller`,
    shipper: `${marketplace} / marketplace fulfillment`,
    returns: 'MAT STORE support review with supplier return policy',
    payment: 'Secure MAT STORE transaction',
    delivery: 'Delivery calculated at checkout',
    shipping: 'Shipping and import charges calculated at checkout',
    boughtInPastMonth: '',
    badge: card.badge || (savingsPercent ? `${savingsPercent}% off` : `${marketplace} deal`),
    listPrice: card.listPrice,
    savingsPercent,
    about: uniqueCleanList([
      card.badge ? `${card.badge} highlighted from ${collectionName}` : `Imported from ${collectionName}`,
      supplierCode ? `Supplier code tracked: ${supplierCode}` : '',
      'Curated into MAT STORE with premium presentation and secure checkout',
      'Price is automatically marked up using the active MAT STORE pricing rule',
      ai.shortDescription
    ], 8, 220),
    specs: [
      { name: 'Marketplace', value: marketplace },
      { name: 'Collection', value: collectionName },
      ...(supplierCode ? [{ name: 'Supplier code', value: supplierCode }] : []),
      ...(card.listPrice ? [{ name: 'Supplier list price', value: `$${Number(card.listPrice).toFixed(2)}` }] : []),
      ...(savingsPercent ? [{ name: 'Detected deal', value: `${savingsPercent}% off` }] : [])
    ],
    buyingOptions: uniqueCleanList([
      'Add to cart',
      'Buy now',
      'Secure MAT STORE checkout',
      'Supplier availability synced from collection import'
    ], 8, 160),
    videos: {
      count: 0,
      label: 'Supplier product videos appear when the product page provides media'
    },
    reviews: {
      rating: 4.8,
      count: 0,
      summary: 'Review intelligence is enriched when supplier product pages expose customer ratings.'
    },
    sourceSections: uniqueCleanList(['Buying options', 'About this item', 'Product information', 'Videos', 'Reviews'], 8, 80)
  };
}

async function previewCollectionImport(url, options = {}) {
  const resolvedUrl = await resolveShortMarketplaceUrl(url);
  const { cleanUrl, marketplace, host } = marketplaceFromUrl(resolvedUrl);
  if (!isCollectionImportUrl(cleanUrl, marketplace)) return { products: [await previewImport(url, options)], errors: [] };

  let effectiveUrl = cleanUrl;
  let html = await fetchMarketplacePage(effectiveUrl);
  if (!html) throw new HttpError(400, `The ${marketplace} collection page could not be read. Try again or paste individual product links.`);

  let collectionName = collectionNameFor(marketplace, cleanUrl);
  const collectionLimit = collectionLimitFromOptions(options);
  let cards = collectionCardsForMarketplace(html, effectiveUrl, marketplace, collectionLimit);
  if (!cards.length && marketplace === 'eBay' && /brand-outlet/i.test(cleanUrl)) {
    effectiveUrl = 'https://www.ebay.com/globaldeals/fashion';
    html = await fetchMarketplacePage(effectiveUrl);
    cards = html ? collectionCardsForMarketplace(html, effectiveUrl, marketplace, collectionLimit) : [];
    collectionName = 'eBay Brand Outlet';
  }
  if (!cards.length && marketplace === 'Walmart') {
    cards = walmartFallbackCollectionCards(cleanUrl, collectionLimit);
  }
  if (!cards.length) throw new HttpError(400, `No products were found on that ${marketplace} collection page.`);

  const manualImageUrl = manualImageFromOptions(options);
  const settings = await pricingService.getPricingSettings();
  const appliedMarkup = markupFromOptions(options) || settings.defaultMarkupPercent || 40;
  const products = await Promise.all(cards.map(async (card) => {
    const supplierCode = card.code || card.asin || slugForCollectionCode(`${marketplace}-${card.title}`);
    const supplierPrice = card.price || deterministicFallbackPrice(card.title, marketplace, supplierCode);
    const metadata = {
      id: randomUUID(),
      sourceUrl: card.sourceUrl,
      originalUrl: sanitizeUrl(url),
      resolvedUrl: sanitizeUrl(resolvedUrl),
      supplierName: marketplace,
      supplierHost: host,
      supplierProductCode: supplierCode,
      title: cleanProductTitle(card.title),
      description: sanitizeString(`${card.title}. ${card.badge ? `${card.badge}. ` : ''}Curated from ${collectionName} and prepared for MAT STORE with luxury merchandising, SEO, smart pricing, and local checkout.`, 1000),
      image: manualImageUrl || usableSupplierImageUrl(card.image),
      supplierPrice,
      variants: [
        { name: 'Collection', value: collectionName },
        { name: 'Fulfillment', value: marketplace },
        { name: 'Supplier code', value: supplierCode },
        ...(card.badge ? [{ name: 'Deal badge', value: card.badge }] : []),
        ...(manualImageUrl ? [{ name: 'Image override', value: 'Admin supplied' }] : [])
      ]
    };
    const ai = collectionLuxuryCopy(metadata, collectionName);
    const marketplaceDetails = collectionMarketplaceDetails(card, metadata, ai, collectionName);
    const pricingPlan = pricingService.buildPricingPlan(
      supplierPrice,
      {
        ...metadata,
        marketplaceDetails,
        rating: marketplaceDetails.reviews.rating,
        reviewsCount: marketplaceDetails.reviews.count,
        markupPercent: appliedMarkup
      },
      settings
    );
    const price = pricingPlan.price;
    const media = await mediaService.resolveBestProductImage(manualImageUrl || usableSupplierImageUrl(card.image), {
      ...metadata,
      title: metadata.title,
      category: ai.category
    });

    return {
      ...metadata,
      ...media,
      title: metadata.title,
      description: ai.description,
      shortDescription: ai.shortDescription,
      category: ai.category,
      collection: collectionName,
      tags: ai.tags,
      seo: {
        title: ai.seoTitle,
        description: ai.seoDescription,
        keywords: [...new Set([ai.category, marketplace, 'MAT STORE', collectionName, ...(ai.tags || [])])].slice(0, 10)
      },
      ai: {
        provider: ai.provider,
        luxuryAngle: ai.luxuryAngle,
        lastEnhancedAt: new Date().toISOString()
      },
      price,
      stock: stockFromOptions(options),
      markupPercent: pricingPlan.appliedMarkupPercent,
      pricingPlan,
      images: [media.image],
      imageCandidateCount: usableSupplierImageUrl(card.image) ? 1 : 0,
      manualImage: Boolean(manualImageUrl),
      rating: marketplaceDetails.reviews.rating,
      reviewsCount: marketplaceDetails.reviews.count,
      marketplaceDetails,
      features: fallbackFeatures(metadata, media.imageStatus)
    };
  }));

  return { products, errors: [] };
}

function productCodeFromUrl(url, marketplace) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (marketplace === 'Amazon') return path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || '';
  if (marketplace === 'eBay') return path.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/i)?.[1] || '';
  if (marketplace === 'Walmart') return path.match(/\/ip\/(?:[^/]+\/)?(\d{6,})/i)?.[1] || parsed.searchParams.get('productId') || parsed.searchParams.get('itemId') || '';
  if (marketplace === 'AliExpress') return path.match(/\/item\/(\d+)\.html/i)?.[1] || parsed.searchParams.get('productId') || '';
  if (marketplace === 'Alibaba') return path.match(/_(\d+)\.html/i)?.[1] || path.match(/\/product-detail\/[^/]*?(\d{8,})/i)?.[1] || '';
  if (marketplace === 'Temu') return parsed.searchParams.get('goods_id') || path.match(/\/([^/?]+?)-g-(\d+)\.html/i)?.[2] || '';
  return '';
}

function titleFromUrl(url, marketplace) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  let raw = '';
  if (marketplace === 'Amazon') {
    raw = segments[0] && !['dp', 'gp'].includes(segments[0].toLowerCase()) ? segments[0] : '';
  } else if (marketplace === 'eBay') {
    const itemIndex = segments.findIndex((segment) => segment.toLowerCase() === 'itm');
    raw = itemIndex >= 0 ? segments[itemIndex + 1] || '' : segments.at(-1) || '';
  } else if (marketplace === 'Walmart') {
    const itemIndex = segments.findIndex((segment) => segment.toLowerCase() === 'ip');
    raw = itemIndex >= 0
      ? segments.slice(itemIndex + 1).find((segment) => !/^\d{6,}$/.test(segment)) || ''
      : segments.find((segment) => !/^\d{6,}$/.test(segment)) || '';
  } else if (marketplace === 'AliExpress') {
    raw = segments.find((segment) => segment.endsWith('.html')) || segments.at(-1) || '';
  } else if (marketplace === 'Alibaba') {
    const detailIndex = segments.findIndex((segment) => segment.toLowerCase() === 'product-detail');
    raw = detailIndex >= 0 ? segments[detailIndex + 1] || '' : segments.at(-1) || '';
  } else if (marketplace === 'Temu') {
    raw = segments.at(-1) || '';
  }

  raw = raw
    .replace(/\.(html|htm)$/i, '')
    .replace(/[_-]?\d{8,}$/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(dp|itm|item|product|detail|ref|sr|ip)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return raw || `${marketplace} Product`;
}

function deterministicFallbackPrice(title, marketplace, productCode = '') {
  const value = `${title} ${marketplace} ${productCode}`.toLowerCase();
  if (/(gaming|laptop|computer|notebook|rog|macbook|desktop|gpu|rtx)/.test(value)) return 899.99;
  if (/(phone|tablet|ipad|iphone|galaxy)/.test(value)) return 399.99;
  if (/(watch|speaker|headphone|camera|monitor)/.test(value)) return 79.99;
  if (/(shoe|sneaker|boot|jacket|bag|dress)/.test(value)) return 34.99;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 10000;
  return Number((18 + (hash % 160) + 0.99).toFixed(2));
}

async function fetchMarketplacePage(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1'
        },
        redirect: 'follow'
      });

      const contentType = response.headers.get('content-type') || '';
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !contentType.includes('text/html') || contentLength > MAX_MARKETPLACE_HTML) continue;
      const html = await response.text();
      return html.slice(0, MAX_MARKETPLACE_HTML);
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

async function previewImport(url, options = {}) {
  const resolvedUrl = await resolveShortMarketplaceUrl(url);
  const { cleanUrl, marketplace, host } = marketplaceFromUrl(resolvedUrl);
  const html = await fetchMarketplacePage(cleanUrl);
  const productCode = productCodeFromUrl(cleanUrl, marketplace);
  const fallbackName = titleFromUrl(cleanUrl, marketplace);
  const extractedTitle = isBlockedMarketplaceHtml(html) ? '' : extractTitle(html);
  const cleanTitle = sanitizeString(cleanProductTitle(extractedTitle || fallbackName || `${marketplace} Product`), 160);
  const imageCandidates = extractImageCandidates(html, cleanUrl, marketplace);
  const manualImageUrl = manualImageFromOptions(options);
  const supplierImage = manualImageUrl || usableSupplierImageUrl(extractImage(html, cleanUrl, marketplace));
  const supplierPrice = extractPrice(html) || deterministicFallbackPrice(cleanTitle, marketplace, productCode);
  const markupPercent = markupFromOptions(options);

  const metadata = {
    id: randomUUID(),
    sourceUrl: cleanUrl,
    originalUrl: sanitizeUrl(url),
    resolvedUrl: sanitizeUrl(resolvedUrl),
    supplierName: marketplace,
    supplierHost: host,
    supplierProductCode: productCode,
    title: cleanTitle,
    description: sanitizeString(getMeta(html, ['og:description', 'description', 'twitter:description']) || `Imported from ${marketplace}. MAT STORE will enrich this product with luxury copy, SEO metadata, category intelligence, and premium pricing.`, 1000),
    image: supplierImage,
    supplierPrice,
    variants: [
      { name: 'Signature', value: 'Standard' },
      { name: 'Fulfillment', value: marketplace },
      ...(productCode ? [{ name: 'Supplier code', value: productCode }] : []),
      ...(manualImageUrl ? [{ name: 'Image override', value: 'Admin supplied' }] : [])
    ]
  };

  const ai = await nvidiaAiService.enhanceProduct(metadata);
  const marketplaceDetails = extractMarketplaceDetails(html, metadata, ai);
  const pricingPlan = await pricingService.calculatePricingPlan(metadata.supplierPrice, {
    ...metadata,
    marketplaceDetails,
    rating: marketplaceDetails.reviews.rating,
    reviewsCount: marketplaceDetails.reviews.count,
    ...(markupPercent ? { markupPercent } : {})
  });
  const price = pricingPlan.price;
  const media = await mediaService.resolveBestProductImage(supplierImage, {
    ...metadata,
    title: metadata.title,
    category: ai.category
  });

  return {
    ...metadata,
    ...media,
    title: metadata.title,
    description: ai.description,
    shortDescription: ai.shortDescription,
    category: ai.category,
    tags: ai.tags,
    seo: {
      title: ai.seoTitle,
      description: ai.seoDescription,
      keywords: [...new Set([ai.category, marketplace, 'MAT STORE', ...(ai.tags || [])])].slice(0, 10)
    },
    ai: {
      provider: ai.provider,
      luxuryAngle: ai.luxuryAngle,
      lastEnhancedAt: new Date().toISOString()
    },
    price,
    stock: stockFromOptions(options),
    markupPercent: pricingPlan.appliedMarkupPercent,
    pricingPlan,
    images: [media.image],
    imageCandidateCount: imageCandidates.length,
    manualImage: Boolean(manualImageUrl),
    rating: marketplaceDetails.reviews.rating,
    reviewsCount: marketplaceDetails.reviews.count,
    marketplaceDetails,
    features: fallbackFeatures(metadata, media.imageStatus)
  };
}

async function previewImports(input, options = {}) {
  const urls = Array.isArray(input) ? input : extractUrls(input);
  if (!urls.length) throw new HttpError(400, 'Paste at least one Amazon, Walmart, Temu, Alibaba, AliExpress, eBay product link, or supported marketplace collection page.');
  const products = [];
  const errors = [];
  for (const url of urls.slice(0, 20)) {
    try {
      const resolvedUrl = await resolveShortMarketplaceUrl(url);
      const { cleanUrl, marketplace } = marketplaceFromUrl(resolvedUrl);
      if (isCollectionImportUrl(cleanUrl, marketplace)) {
        const collectionResult = await previewCollectionImport(url, options);
        products.push(...collectionResult.products);
        errors.push(...collectionResult.errors);
      } else {
        products.push(await previewImport(url, options));
      }
    } catch (error) {
      errors.push({ url, message: error.message });
    }
  }
  if (!products.length) throw new HttpError(400, 'No supported product links or collection pages could be imported.', errors);
  return { products, errors };
}

async function importProduct(url, overrides = {}, options = {}) {
  const preview = await previewImport(url, { ...options, ...overrides });
  return productService.createProduct({
    ...preview,
    ...overrides,
    supplierUrl: preview.sourceUrl,
    supplierName: preview.supplierName,
    status: overrides.status || 'active'
  });
}

async function importProducts(input, overrides = {}, options = {}) {
  const previewResult = await previewImports(input, { ...options, ...overrides });
  const errors = [...(previewResult.errors || [])];
  const payloads = previewResult.products.map((preview) => ({
    ...preview,
    ...overrides,
    supplierUrl: preview.sourceUrl,
    supplierName: preview.supplierName,
    status: overrides.status || 'active'
  }));
  let products = [];
  try {
    products = await productService.createProducts(payloads);
  } catch (error) {
    errors.push({ url: 'bulk-import', message: error.message });
  }
  if (!products.length) throw new HttpError(400, 'No products could be published.', errors);
  return { products, errors };
}

module.exports = {
  allowedMarketplaces,
  extractUrls,
  resolveShortMarketplaceUrl,
  previewCollectionImport,
  previewImport,
  previewImports,
  importProduct,
  importProducts
};
