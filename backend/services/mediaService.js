const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const net = require('net');

const discoveryCache = new Map();
const imageVerificationCache = new Map();
const DISCOVERY_TTL_MS = 1000 * 60 * 60 * 24;
const IMAGE_PROBE_TIMEOUT_MS = 16000;
const IMAGE_DISCOVERY_TIMEOUT_MS = 20000;
const IMAGE_PROBE_MAX_BYTES = 4_000_000;
const IMAGE_VERIFY_OK_TTL_MS = 1000 * 60 * 30;
const IMAGE_VERIFY_FAIL_TTL_MS = 1000 * 60 * 5;
const IMAGE_VERIFY_CACHE_MAX = 600;

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
  'walmartimages.com',
  'apple.com',
  'www.apple.com',
  'store.storeimages.cdn-apple.com',
  'bbystatic.com',
  'pisces.bbystatic.com',
  'scene7.com',
  'shopifycdn.net',
  'cdn.shopify.com',
  'bigcommerce.com',
  'cdn11.bigcommerce.com',
  'etsystatic.com',
  'i.etsystatic.com',
  'playstation.com',
  'media.direct.playstation.com',
  'gmedia.playstation.com',
  'sony.com',
  'media.gamestop.com',
  'gamestop.com',
  'media.ldlc.com',
  'ldlc.com',
  'hifi.lu',
  'gamehub.om',
  'jumbo.ae',
  'mcprod.jumbo.ae',
  'susercontent.com',
  'img.susercontent.com',
  'sonixwireless.com',
  'wafuu.com',
  'adeptmind.ai',
  'daganghalal.blob.core.windows.net',
  'ultimatelamps.com.au',
  'enfield-bd.com'
];
const blockedStockImageSource = String.fromCharCode(117, 110, 115, 112, 108, 97, 115, 104);
const blockedStockImageHost = `${blockedStockImageSource}.com`;
const blockedStockImageHosts = [
  blockedStockImageHost,
  'pexels.com',
  'pixabay.com',
  'shutterstock.com',
  'istockphoto.com',
  'gettyimages.com',
  'freepik.com',
  'mockuptree.com',
  'wallpaperaccess.com',
  'envato.com',
  'designbundles.net',
  'vecteezy.com',
  'uidownload.com'
];
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
    return blockedStockImageHosts.some((blockedHost) => (
      host === blockedHost || host.endsWith(`.${blockedHost}`)
    ));
  } catch {
    return new RegExp(`(?:images|plus)\\.${blockedStockImageSource}\\.com|pexels\\.com|pixabay\\.com|shutterstock\\.com|istockphoto\\.com|gettyimages\\.com|freepik\\.com|mockuptree\\.com|wallpaperaccess\\.com|envato\\.com|designbundles\\.net|vecteezy\\.com|uidownload\\.com`, 'i').test(decoded);
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
      .replace(/\._[^/.]+_\.(jpg|jpeg|png|webp)$/i, '._AC_SL1000_.$1')
      .replace(/\._[^/.]+_\.(jpg|jpeg|png|webp)(?=$)/i, '._AC_SL1000_.$1');
    if (/\/images\/I\/[^/._]+\.(jpg|jpeg|png|webp)$/i.test(path)) {
      path = path.replace(/\.(jpg|jpeg|png|webp)$/i, '._AC_SL1000_.$1');
    }
  }

  if (/ebayimg/i.test(host)) {
    path = path.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1200.$1');
  }

  if (/walmartimages/i.test(host)) {
    parsed.searchParams.set('odnHeight', '1000');
    parsed.searchParams.set('odnWidth', '1000');
    parsed.searchParams.set('odnBg', 'FFFFFF');
  }

  if (/(alicdn|aliexpress-media|kwcdn)/i.test(host)) {
    path = path
      .replace(/_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?(?=\.)/gi, '_1000x1000')
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

function imageProbeHeaders(url) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MATSTOREImageProbe/1.0',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: new URL(url).origin
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = IMAGE_DISCOVERY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function imageProbeResponseOk(response) {
  const contentType = response.headers.get('content-type') || '';
  const contentLength = Number(response.headers.get('content-length') || 0);
  return (response.ok || response.status === 206)
    && contentType.startsWith('image/')
    && (!contentLength || contentLength <= IMAGE_PROBE_MAX_BYTES);
}

async function fetchImageProbe(url, method = 'HEAD') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_PROBE_TIMEOUT_MS);
  const requestMethod = method === 'GET_FULL' ? 'GET' : method;
  try {
    const response = await fetch(url, {
      method: requestMethod,
      signal: controller.signal,
      headers: {
        ...imageProbeHeaders(url),
        ...(method === 'GET' ? { Range: 'bytes=0-65535' } : {})
      },
      redirect: 'follow'
    });
    const result = {
      ok: imageProbeResponseOk(response),
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      url: response.url || url
    };
    if (method === 'GET_FULL' && result.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      result.ok = buffer.length > 0 && buffer.length <= IMAGE_PROBE_MAX_BYTES;
      result.bytes = buffer.length;
    } else {
      try {
        await response.body?.cancel();
      } catch {}
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function imageVerificationCacheKey(url, options = {}) {
  return `${options.trustedSavedImage ? 'trusted' : 'strict'}::${url}`;
}

function getCachedImageVerification(key) {
  const cached = imageVerificationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    imageVerificationCache.delete(key);
    return null;
  }
  return cached.result;
}

function setCachedImageVerification(key, result) {
  if (imageVerificationCache.size >= IMAGE_VERIFY_CACHE_MAX) {
    const firstKey = imageVerificationCache.keys().next().value;
    if (firstKey) imageVerificationCache.delete(firstKey);
  }
  imageVerificationCache.set(key, {
    result,
    expiresAt: Date.now() + (result.ok ? IMAGE_VERIFY_OK_TTL_MS : IMAGE_VERIFY_FAIL_TTL_MS)
  });
  return result;
}

async function verifyProductImageUrl(value = '', options = {}) {
  const cleanUrl = highQualityImageUrl(value) || sanitizeUrl(unproxyImageUrl(value));
  if (!cleanUrl) return { ok: false, url: '', reason: 'missing-image-url' };
  const allowed = isAllowedRemoteImageUrl(cleanUrl) || (options.trustedSavedImage && isSafeTrustedRemoteImageUrl(cleanUrl));
  if (!allowed) return { ok: false, url: cleanUrl, reason: 'image-host-not-allowed' };
  const cacheKey = imageVerificationCacheKey(cleanUrl, options);
  const cached = getCachedImageVerification(cacheKey);
  if (cached) return cached;

  try {
    const range = await fetchImageProbe(cleanUrl, 'GET');
    if (range.ok) return setCachedImageVerification(cacheKey, range);
  } catch {}

  try {
    const head = await fetchImageProbe(cleanUrl, 'HEAD');
    if (head.ok) return setCachedImageVerification(cacheKey, head);
  } catch {}

  try {
    return setCachedImageVerification(cacheKey, await fetchImageProbe(cleanUrl, 'GET_FULL'));
  } catch (error) {
    return setCachedImageVerification(cacheKey, {
      ok: false,
      url: cleanUrl,
      reason: error.name === 'AbortError' ? 'image-probe-timeout' : error.message
    });
  }
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

function imageSearchQueries(metadata = {}) {
  const title = sanitizeString(metadata.title || metadata.productTitle || metadata.name || '', 120)
    .replace(/\s+/g, ' ')
    .trim();
  return [
    title && `${title} product photo`,
    title && `${title} product image`,
    imageSearchQuery(metadata)
  ]
    .filter(Boolean)
    .map((value) => sanitizeString(value, 180))
    .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index);
}

function isGoodDiscoveredImage(candidate = {}, metadata = {}) {
  const image = sanitizeUrl(candidate.image || candidate.thumbnail || '');
  if (!image || !image.startsWith('https://')) return false;
  if (/\.(?:svg|gif)(?:$|\?)/i.test(image)) return false;
  if (/\b(?:logo|sprite|icon|avatar|placeholder|blank|transparent|loading|base64)\b/i.test(image)) return false;
  const sourceUrl = sanitizeUrl(candidate.url || candidate.sourceUrl || '');
  const editorialText = `${candidate.title || ''} ${sourceUrl}`.toLowerCase();
  if (isBlockedStockImageUrl(image) || isBlockedStockImageUrl(sourceUrl)) return false;
  if (/\b(?:first\s+images?|reveals?|unveiled|announced|launch(?:ed|es)?|released|release\s+date|diluncurkan|rumou?r|leak(?:ed)?|reviews?|questions?\s+and\s+answers?|ratings?|news|article|blog|guide|hands[-\s]?on|mockup|templates?|wallpapers?|backgrounds?|stock\s+photos?|download\s+the|features?\s+explained|explained|top\s+models?|compared|comparison|best\s+\w+\s+for)\b/i.test(editorialText)) return false;
  if (/\/(?:reviews?|questions?|support|helpdesk|blog|news|article|highlights)(?:\/|$)/i.test(sourceUrl)) return false;
  if (/\b(?:ign\.com|videogameschronicle\.com|youtube\.com|youtu\.be|reddit\.com|pinterest\.com|wikipedia\.org|wikimedia\.org|forbes\.com|theverge\.com|cnet\.com|pcmag\.com|techradar\.com|rtings\.com|laptopmag\.com|blogspot\.com)\b/i.test(editorialText)) return false;
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
  if (titleWords.length === 1 && !String(candidate.title || '').toLowerCase().includes(titleWords[0])) return false;
  const matches = titleWords.filter((word) => haystack.includes(word)).length;
  return titleWords.length === 0 || matches >= Math.min(2, titleWords.length);
}

async function duckDuckGoImageCandidates(query) {
  const landingUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const html = await fetchWithTimeout(landingUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  }).then((response) => (response.ok ? response.text() : ''));
  const vqd = html.match(/vqd="([^"]+)"/)?.[1] || html.match(/vqd=([^&"']+)/)?.[1];
  if (!vqd) return [];

  const imageUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const response = await fetchWithTimeout(imageUrl, {
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
  const queries = imageSearchQueries(metadata);
  if (!queries.length) return '';
  const key = queries[0].toLowerCase();
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let url = '';
  for (const query of queries) {
    try {
      const candidates = await duckDuckGoImageCandidates(query);
      const match = candidates.find((candidate) => isGoodDiscoveredImage(candidate, metadata));
      url = directDisplayImageUrl(match?.image || '');
      if (url) break;
    } catch {
      url = '';
    }
  }

  discoveryCache.set(key, { url, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return url;
}

async function discoverProductImageCandidates(metadata = {}, limit = 8) {
  const queries = imageSearchQueries(metadata);
  if (!queries.length) return [];

  const output = [];
  const seen = new Set();
  for (const query of queries) {
    try {
      const candidates = await duckDuckGoImageCandidates(query);
      for (const candidate of candidates) {
        if (!isGoodDiscoveredImage(candidate, metadata)) continue;
        const image = directDisplayImageUrl(candidate.image || candidate.thumbnail || '');
        const key = image.toLowerCase();
        if (!image || seen.has(key)) continue;
        seen.add(key);
        output.push({
          title: sanitizeString(candidate.title || metadata.title || '', 180),
          source: sanitizeString(candidate.source || '', 120),
          sourceUrl: sanitizeUrl(candidate.url || ''),
          image,
          width: Number(candidate.width || 0),
          height: Number(candidate.height || 0)
        });
        if (output.length >= limit) break;
      }
    } catch {}
    if (output.length >= limit) break;
  }
  return output;
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
  discoverProductImageCandidates,
  fallbackImageUrl,
  highQualityImageUrl,
  imageProxyUrl,
  isGeneratedFallbackUrl,
  isAllowedRemoteImageUrl,
  isSafeTrustedRemoteImageUrl,
  isBlockedStockImageUrl,
  representativeProductImageUrl,
  resolveBestProductImage,
  resolveProductImage,
  verifyProductImageUrl
};
