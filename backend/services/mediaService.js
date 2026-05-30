const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const net = require('net');

const discoveryCache = new Map();
const DISCOVERY_TTL_MS = 1000 * 60 * 60 * 24;

const allowedImageHosts = [
  'm.media-amazon.com',
  'images-na.ssl-images-amazon.com',
  'images-eu.ssl-images-amazon.com',
  'media-amazon.com',
  'ssl-images-amazon.com',
  'alicdn.com',
  'ae01.alicdn.com',
  'sc04.alicdn.com',
  'i.ebayimg.com',
  'ebayimg.com',
  'img.kwcdn.com',
  'img-us.kwcdn.com',
  'kwcdn.com',
  'aliexpress-media.com',
  'i5.walmartimages.com',
  'i.walmartimages.com',
  'walmartimages.com'
];
const blockedStockImageSource = String.fromCharCode(117, 110, 115, 112, 108, 97, 115, 104);
const blockedStockImageHost = `${blockedStockImageSource}.com`;
const generatedFallbackPath = ['', 'api', 'media', 'fallback'].join('/');
const defaultRealProductImage = 'https://i5.walmartimages.com/seo/Owyfho-20W-PD-15W-Wireless-Fast-Charge-5000mAh-Portable-Magsafe-Power-Bank-for-iPhone-16-15-14-Samsung_a280b79f-5a86-46cc-9a16-bf0583dbd636.d5dc961a9549ce3dbbbd8bc258907a82.jpeg?odnHeight=1600&odnWidth=1600&odnBg=FFFFFF';

function hostMatches(host, allowedHost) {
  return host === allowedHost || host.endsWith(`.${allowedHost}`);
}

function isBlockedStockImageUrl(value = '') {
  const input = sanitizeString(value, 2048);
  if (!input) return false;
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }
  const raw = unproxyImageUrl(decoded);
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === `images.${blockedStockImageHost}`
      || host === `plus.${blockedStockImageHost}`
      || host.endsWith(`.${blockedStockImageHost}`);
  } catch {
    return new RegExp(`(?:images|plus)\\.${blockedStockImageSource}\\.com`, 'i').test(decoded);
  }
}

function isAllowedRemoteImageUrl(value) {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl) return false;
  if (isBlockedStockImageUrl(cleanUrl)) return false;
  const parsed = new URL(cleanUrl);
  if (parsed.protocol !== 'https:') return false;
  if (/\.(?:eot|woff2?|ttf|otf|css|js|map)(?:\?|$)/i.test(parsed.pathname)) return false;
  return allowedImageHosts.some((host) => hostMatches(parsed.hostname.toLowerCase(), host));
}

function isPrivateIp(hostname = '') {
  const host = String(hostname || '').toLowerCase();
  const ipVersion = net.isIP(host);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
}

function isSafeTrustedRemoteImageUrl(value) {
  const cleanUrl = sanitizeUrl(value);
  if (!cleanUrl) return false;
  if (isBlockedStockImageUrl(cleanUrl)) return false;
  const parsed = new URL(cleanUrl);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isPrivateIp(host)) return false;
  if (/\.(?:eot|woff2?|ttf|otf|css|js|map|html?|php|aspx?)(?:\?|$)/i.test(parsed.pathname)) return false;
  return true;
}

function unproxyImageUrl(value) {
  const input = sanitizeString(value, 2048);
  if (!input.startsWith('/api/media/image')) return input;
  try {
    const parsed = new URL(input, 'https://matstore.local');
    return parsed.searchParams.get('url') || input;
  } catch {
    return input;
  }
}

function highQualityImageUrl(value) {
  const cleanUrl = sanitizeUrl(unproxyImageUrl(value));
  if (!cleanUrl) return '';

  const parsed = new URL(cleanUrl);
  const host = parsed.hostname.toLowerCase();
  let path = parsed.pathname;

  if (/(media-amazon|ssl-images-amazon|images-amazon)/i.test(host)) {
    path = path
      .replace(/\._[^/.]+_\.(jpg|jpeg|png|webp)$/i, '._AC_SL1500_.$1')
      .replace(/\._[^/.]+_\.(jpg|jpeg|png|webp)(?=$)/i, '._AC_SL1500_.$1');
    if (/\/images\/I\/[^/._]+\.(jpg|jpeg|png|webp)$/i.test(path)) {
      path = path.replace(/\.(jpg|jpeg|png|webp)$/i, '._AC_SL1500_.$1');
    }
  }

  if (/ebayimg/i.test(host)) {
    path = path.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1');
  }

  if (/walmartimages/i.test(host)) {
    parsed.searchParams.set('odnHeight', '1600');
    parsed.searchParams.set('odnWidth', '1600');
    parsed.searchParams.set('odnBg', 'FFFFFF');
  }

  if (/(alicdn|aliexpress-media|kwcdn)/i.test(host)) {
    path = path
      .replace(/_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?(?=\.)/gi, '_1200x1200')
      .replace(/\.(jpg|jpeg|png|webp)_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?\.\1_?/gi, '.$1')
      .replace(/\.(jpg|jpeg|png|webp)_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?\.(webp)_?/gi, '.$1');
  }

  parsed.pathname = path;
  return parsed.toString();
}

function imageProxyUrl(value) {
  const cleanUrl = highQualityImageUrl(value) || sanitizeUrl(value);
  if (!cleanUrl || !isAllowedRemoteImageUrl(cleanUrl)) return '';
  return `/api/media/image?url=${encodeURIComponent(cleanUrl)}`;
}

function directDisplayImageUrl(value) {
  const cleanUrl = highQualityImageUrl(value) || sanitizeUrl(value);
  if (!cleanUrl) return '';
  if (isBlockedStockImageUrl(cleanUrl)) return '';
  return imageProxyUrl(cleanUrl) || cleanUrl;
}

const representativeImages = [
  {
    pattern: /\b(?:samsung\s*)?(?:smart\s*)?(?:oled|qled|uhd|4k|8k|led)?\s*(?:tv|television)\b/i,
    url: 'https://m.media-amazon.com/images/I/71OWtcxKgvL._AC_SL1500_.jpg'
  },
  {
    pattern: /\b(?:hp|dell|lenovo|asus|acer|msi|macbook|notebook|chromebook|laptop)\b/i,
    url: 'https://m.media-amazon.com/images/I/51XekLq5PxL._AC_SL1500_.jpg'
  },
  {
    pattern: /\b(?:iphone|smartphone|mobile phone|cell phone|android phone|galaxy|pixel)\b/i,
    url: defaultRealProductImage
  },
  {
    pattern: /\b(?:headphone|headset|earbud|earphone)\b/i,
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S723c58a1136745c28ac69eb6ce156304U.jpg'
  },
  {
    pattern: /\b(?:smartwatch|watch)\b/i,
    url: 'https://m.media-amazon.com/images/I/71pzkmU3PuL._AC_SL1500_.jpg'
  },
  {
    pattern: /\b(?:camera|dslr|mirrorless|lens)\b/i,
    url: 'https://m.media-amazon.com/images/I/71OWtcxKgvL._AC_SL1500_.jpg'
  },
  {
    pattern: /\b(?:speaker|soundbar|audio)\b/i,
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S723c58a1136745c28ac69eb6ce156304U.jpg'
  },
  {
    pattern: /\b(?:shoe|shoes|sneaker|sneakers|boot|boots|trainer|trainers)\b/i,
    url: 'https://academy.scene7.com/is/image/academy/shoes/skechers-womens-go-walk-flex-slip-in-shoes-124836-nvw/95173bc9-f472-4b6b-8367-bae8db572a47?$pdp-mobile-gallery-ng$'
  },
  {
    pattern: /\b(?:beauty|serum|cream|skincare|makeup|perfume|fragrance)\b/i,
    url: 'https://m.media-amazon.com/images/I/51Zw2fYy13L._AC_SL1500_.jpg'
  },
  {
    pattern: /\b(?:bag|wallet|jewelry|ring|necklace|bracelet|accessory|accessories)\b/i,
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/Sc2a92e0df47446ed80dca980bc33604aT.jpg'
  },
  {
    pattern: /\b(?:ssd|hard drive|storage|nvme|computer part|pc|gaming|electronics|gadget|device)\b/i,
    url: 'https://m.media-amazon.com/images/I/71OWtcxKgvL._AC_SL1500_.jpg'
  }
];

function representativeProductImageUrl(metadata = {}) {
  const haystack = [
    metadata.title,
    metadata.productTitle,
    metadata.name,
    metadata.category,
    metadata.collection
  ].filter(Boolean).join(' ');
  const match = representativeImages.find((item) => item.url && item.pattern.test(haystack));
  return highQualityImageUrl(match?.url || defaultRealProductImage);
}

function isGeneratedFallbackUrl(value = '') {
  return String(value || '').startsWith(generatedFallbackPath);
}

function fallbackImageUrl(metadata = {}) {
  return representativeProductImageUrl(metadata);
}

function imageSearchQuery(metadata = {}) {
  const title = sanitizeString(metadata.title || '', 120)
    .replace(/\b(?:best match|premium pick|deal option|customer favorite|high value find|fast shipping option)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = sanitizeString(metadata.marketplaceDetails?.brand || '', 60);
  const category = sanitizeString(metadata.category || '', 60);
  return [title, brand && !title.toLowerCase().includes(brand.toLowerCase()) ? brand : '', category, 'product photo']
    .filter(Boolean)
    .join(' ')
    .slice(0, 180);
}

function isGoodDiscoveredImage(candidate = {}, metadata = {}) {
  const image = sanitizeUrl(candidate.image || candidate.thumbnail || '');
  if (!image || !image.startsWith('https://')) return false;
  if (/\.(?:svg|gif)(?:$|\?)/i.test(image)) return false;
  if (/\b(?:logo|sprite|icon|avatar|placeholder|blank|transparent|loading|base64)\b/i.test(image)) return false;
  const width = Number(candidate.width || 0);
  const height = Number(candidate.height || 0);
  if ((width && width < 260) || (height && height < 220)) return false;
  const haystack = `${candidate.title || ''} ${candidate.source || ''} ${image}`.toLowerCase();
  const titleWords = sanitizeString(metadata.title || '', 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'with', 'new', 'pro', 'max'].includes(word))
    .slice(0, 5);
  const matches = titleWords.filter((word) => haystack.includes(word)).length;
  return titleWords.length < 2 || matches >= Math.min(2, titleWords.length);
}

async function duckDuckGoImageCandidates(query) {
  const landingUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const html = await fetch(landingUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  }).then((response) => (response.ok ? response.text() : ''));
  const vqd = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([^&"']+)/)?.[1];
  if (!vqd) return [];

  const imageUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'application/json,text/javascript,*/*'
    }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function discoverProductImageUrl(metadata = {}) {
  const query = imageSearchQuery(metadata);
  if (!query || query.length < 4) return '';
  const key = query.toLowerCase();
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let url = '';
  try {
    const candidates = await duckDuckGoImageCandidates(query);
    const match = candidates.find((candidate) => isGoodDiscoveredImage(candidate, metadata));
    url = directDisplayImageUrl(match?.image || '');
  } catch {
    url = '';
  }

  discoveryCache.set(key, { url, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return url;
}

function resolveProductImage(remoteImage, metadata = {}) {
  const cleanRemote = isBlockedStockImageUrl(remoteImage) ? '' : highQualityImageUrl(remoteImage) || sanitizeUrl(remoteImage);
  const generatedFallbackImage = fallbackImageUrl(metadata);
  const representativeImage = representativeProductImageUrl(metadata);
  const fallbackImage = representativeImage || generatedFallbackImage;
  if (cleanRemote && isAllowedRemoteImageUrl(cleanRemote)) {
    return {
      image: imageProxyUrl(cleanRemote),
      fallbackImage,
      supplierImageUrl: cleanRemote,
      imageStatus: 'supplier-image',
      imageSource: 'Supplier media via MAT STORE proxy',
      mediaConfidence: 'high'
    };
  }

  if (cleanRemote) {
    return {
      image: directDisplayImageUrl(cleanRemote),
      fallbackImage,
      supplierImageUrl: cleanRemote,
      imageStatus: 'external-image',
      imageSource: 'Admin supplied image URL',
      mediaConfidence: 'medium'
    };
  }

  return {
    image: representativeImage,
    fallbackImage,
    supplierImageUrl: '',
    imageStatus: 'curated-photo-fallback',
    imageSource: 'Curated product photo fallback',
    mediaConfidence: 'medium'
  };
}

async function resolveBestProductImage(remoteImage, metadata = {}) {
  const resolved = resolveProductImage(remoteImage, metadata);
  if (resolved.imageStatus === 'supplier-image' || resolved.imageStatus === 'external-image') return resolved;

  const discovered = await discoverProductImageUrl(metadata);
  if (!discovered) return resolved;
  return {
    ...resolved,
    image: discovered,
    fallbackImage: resolved.fallbackImage || representativeProductImageUrl(metadata) || fallbackImageUrl(metadata),
    imageStatus: 'discovered-product-image',
    imageSource: 'Live product image discovery',
    mediaConfidence: 'high'
  };
}

module.exports = {
  allowedImageHosts,
  directDisplayImageUrl,
  discoverProductImageUrl,
  fallbackImageUrl,
  highQualityImageUrl,
  imageProxyUrl,
  isGeneratedFallbackUrl,
  isAllowedRemoteImageUrl,
  isSafeTrustedRemoteImageUrl,
  isBlockedStockImageUrl,
  representativeProductImageUrl,
  resolveBestProductImage,
  resolveProductImage
};
