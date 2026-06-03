const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');
const mediaService = require('../services/mediaService');
const store = require('../database/jsonStore');

const MAX_IMAGE_BYTES = 8_000_000;

async function sendRemoteImage(requestedUrl, res, options = {}) {
  const url = mediaService.highQualityImageUrl(requestedUrl) || sanitizeUrl(requestedUrl);
  const allowed = mediaService.isAllowedRemoteImageUrl(url) || (options.trustedSavedImage && mediaService.isSafeTrustedRemoteImageUrl(url));
  if (!url || !allowed) {
    throw new HttpError(400, 'Product image is not allowed.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
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
  if (options.imageRole) res.setHeader('X-MAT-Image-Role', options.imageRole);
  res.send(buffer);
}

function productFallbackPath(product = {}) {
  return mediaService.representativeProductImageUrl(product);
}

async function sendProductFallback(product, res) {
  await sendRemoteImage(productFallbackPath(product), res, { trustedSavedImage: true, imageRole: 'fallback' });
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
    const indexParam = sanitizeString(req.params.index || '0', 20);
    const fallbackOnly = indexParam === 'fallback';
    const index = fallbackOnly ? 0 : Math.max(0, Math.floor(Number(indexParam || 0)));
    const products = await store.read('products');
    const product = products.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    if (!product) throw new HttpError(404, 'Product image was not found.');

    if (fallbackOnly) {
      await sendProductFallback(product, res);
      return;
    }

    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const candidates = [
      images[index],
      product.supplierImageUrl,
      product.image,
      ...images
    ].filter(Boolean);
    const seen = new Set();
    let lastError = null;

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (mediaService.isBlockedStockImageUrl(candidate)) continue;
      if (mediaService.isGeneratedFallbackUrl(candidate)) continue;
      const remoteUrl = mediaService.highQualityImageUrl(candidate) || sanitizeUrl(candidate);
      if (!remoteUrl) continue;
      try {
        await sendRemoteImage(remoteUrl, res, { trustedSavedImage: true, imageRole: 'product' });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new HttpError(404, 'Product image was not found.');
  } catch (error) {
    next(error.status ? error : new HttpError(502, 'Product image could not be loaded.'));
  }
}

async function catalogImage(req, res, next) {
  return productImage(req, res, next);
}

function fallbackImage(req, res) {
  const title = sanitizeString(req.query.title || 'MAT STORE Product', 90);
  const category = sanitizeString(req.query.category || 'premium pick', 40);
  const image = mediaService.representativeProductImageUrl({ title, category });
  return res.redirect(image);
}

module.exports = {
  catalogImage,
  fallbackImage,
  productImage,
  proxyImage
};
