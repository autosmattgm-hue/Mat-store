const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');
const mediaService = require('../services/mediaService');
const store = require('../database/jsonStore');

const MAX_IMAGE_BYTES = 8_000_000;

function xmlEscape(value) {
  return sanitizeString(value, 120)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function initials(value) {
  return sanitizeString(value, 80)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || 'MAT';
}

function wrapText(value, max = 28) {
  const words = sanitizeString(value, 100).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

async function sendRemoteImage(requestedUrl, res, options = {}) {
  const url = mediaService.highQualityImageUrl(requestedUrl) || sanitizeUrl(requestedUrl);
  const allowed = mediaService.isAllowedRemoteImageUrl(url) || (options.trustedSavedImage && mediaService.isSafeTrustedRemoteImageUrl(url));
  if (!url || !allowed) {
    throw new HttpError(400, 'Product image is not allowed.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MATSTOREImageProxy/1.0',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: new URL(url).origin
    },
    redirect: 'follow'
  }).finally(() => clearTimeout(timer));

  const contentType = response.headers.get('content-type') || '';
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (!response.ok || !contentType.startsWith('image/') || contentLength > MAX_IMAGE_BYTES) {
    throw new HttpError(502, 'Product image could not be loaded.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'Product image is too large.');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.send(buffer);
}

function productFallbackPath(product = {}) {
  const params = new URLSearchParams({
    title: sanitizeString(product.title || 'MAT STORE Product', 90),
    marketplace: 'MAT STORE',
    code: '',
    category: sanitizeString(product.category || 'premium pick', 40)
  });
  return `/api/media/fallback?${params.toString()}`;
}

async function proxyImage(req, res, next) {
  try {
    await sendRemoteImage(req.query.url, res);
  } catch (error) {
    next(error.status ? error : new HttpError(502, 'Product image could not be loaded.'));
  }
}

async function productImage(req, res, next) {
  try {
    const idOrSlug = sanitizeString(req.params.idOrSlug || '', 160);
    const index = Math.max(0, Math.floor(Number(req.params.index || 0)));
    const products = await store.read('products');
    const product = products.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    if (!product) throw new HttpError(404, 'Product image was not found.');

    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const candidates = [
      images[index],
      product.supplierImageUrl,
      product.image,
      ...images,
      product.fallbackImage
    ].filter(Boolean);
    const seen = new Set();
    let lastError = null;

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (String(candidate).startsWith('/api/media/fallback')) return res.redirect(candidate);
      const remoteUrl = mediaService.highQualityImageUrl(candidate) || sanitizeUrl(candidate);
      if (!remoteUrl) continue;
      try {
        await sendRemoteImage(remoteUrl, res, { trustedSavedImage: true });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) return res.redirect(productFallbackPath(product));
    return res.redirect(productFallbackPath(product));
  } catch (error) {
    next(error.status ? error : new HttpError(502, 'Product image could not be loaded.'));
  }
}

function fallbackImage(req, res) {
  const title = sanitizeString(req.query.title || 'MAT STORE Product', 90);
  const marketplace = sanitizeString(req.query.marketplace || 'MAT STORE', 40);
  const category = sanitizeString(req.query.category || 'premium pick', 40);
  const code = sanitizeString(req.query.code || '', 40);
  const lines = wrapText(title);
  const textLines = lines
    .map((line, index) => `<text x="70" y="${455 + index * 44}" class="title">${xmlEscape(line)}</text>`)
    .join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" role="img" aria-label="${xmlEscape(title)}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff7ea"/>
      <stop offset="0.44" stop-color="#d7b67d"/>
      <stop offset="1" stop-color="#17130f"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="0.52" stop-color="#f4d59e" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#8f6d34" stop-opacity="0.94"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="34" stdDeviation="32" flood-color="#0c0906" flood-opacity="0.32"/>
    </filter>
    <style>
      .eyebrow{font:700 28px Arial,sans-serif;letter-spacing:6px;fill:#211a12;text-transform:uppercase}
      .title{font:700 40px Georgia,serif;fill:#18130f}
      .meta{font:700 24px Arial,sans-serif;letter-spacing:2px;fill:#5c4729;text-transform:uppercase}
      .mark{font:900 124px Arial,sans-serif;letter-spacing:-3px;fill:#16110c}
    </style>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <path d="M0 760 C260 650 390 820 620 690 C850 560 980 610 1200 520 L1200 900 L0 900 Z" fill="#fff9ee" opacity="0.52"/>
  <circle cx="932" cy="188" r="214" fill="#fff7df" opacity="0.34"/>
  <rect x="92" y="92" width="1016" height="716" rx="38" fill="#fffaf0" opacity="0.68" filter="url(#shadow)"/>
  <rect x="130" y="132" width="940" height="640" rx="24" fill="#fff8ea" opacity="0.72"/>
  <g transform="translate(690 178)" filter="url(#shadow)">
    <rect x="0" y="38" width="284" height="392" rx="46" fill="url(#metal)"/>
    <rect x="42" y="0" width="204" height="86" rx="38" fill="#fff3d1" opacity="0.9"/>
    <circle cx="142" cy="238" r="96" fill="#17130f" opacity="0.88"/>
    <text x="142" y="263" text-anchor="middle" class="mark" fill="#f4d59e">${xmlEscape(initials(title))}</text>
  </g>
  <text x="70" y="188" class="eyebrow">${xmlEscape(marketplace)} IMPORT</text>
  <text x="70" y="248" class="meta">${xmlEscape(category)}</text>
  ${textLines}
  <text x="70" y="656" class="meta">${xmlEscape(code || 'AI SOURCED')}</text>
  <text x="70" y="716" class="eyebrow">MAT STORE</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.send(svg);
}

module.exports = {
  fallbackImage,
  productImage,
  proxyImage
};
