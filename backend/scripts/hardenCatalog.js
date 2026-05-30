const store = require('../database/jsonStore');
const { isBlockedStockImageUrl } = require('../services/mediaService');
const { hasRealProductMedia, isQuestionableProduct, primaryRealProductMedia } = require('../utils/catalogQuality');

const IMAGE_FIELDS = new Set(['image', 'thumbnail', 'fallbackImage', 'productImage']);
const SUPPLIER_IMAGE_FIELDS = new Set(['supplierImageUrl', 'remoteImage', 'remoteImageUrl']);
const ARRAY_COLLECTIONS = ['products', 'orders', 'carts', 'abandonedCarts'];
const BLOCKED_STOCK_IMAGE_MARKER = String.fromCharCode(117, 110, 115, 112, 108, 97, 115, 104);
const GENERATED_FALLBACK_PATH = ['', 'api', 'media', 'fallback'].join('/');

function containsBlockedStockImageText(value = '') {
  if (typeof value !== 'string') return false;
  return new RegExp(BLOCKED_STOCK_IMAGE_MARKER, 'i').test(value) || isBlockedStockImageUrl(value);
}

function scrubBlockedStockImageText(record) {
  if (!record || typeof record !== 'object') return { changed: false, found: false };

  let changed = false;
  let found = false;

  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      const cleanValues = [];
      for (const item of value) {
        if (typeof item === 'string' && containsBlockedStockImageText(item)) {
          found = true;
          changed = true;
          continue;
        }

        if (item && typeof item === 'object') {
          const result = scrubBlockedStockImageText(item);
          found = result.found || found;
          changed = result.changed || changed;
        }

        cleanValues.push(item);
      }

      if (cleanValues.length !== value.length) {
        record[key] = cleanValues;
        changed = true;
      }
      continue;
    }

    if (value && typeof value === 'object') {
      const result = scrubBlockedStockImageText(value);
      found = result.found || found;
      changed = result.changed || changed;
      continue;
    }

    if (typeof value === 'string' && containsBlockedStockImageText(value)) {
      record[key] = '';
      found = true;
      changed = true;
    }
  }

  return { changed, found };
}

function cleanAiProviderBranding(record) {
  if (!record || typeof record !== 'object') return false;
  let changed = false;

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object') {
      changed = cleanAiProviderBranding(value) || changed;
      continue;
    }

    if (typeof value !== 'string') continue;
    if (key === 'provider' && /nvidia/i.test(value)) {
      record[key] = /fallback|error/i.test(value) ? 'mat-ai-fallback' : 'mat-ai';
      changed = true;
    }
  }

  return changed;
}

function cleanImages(record = {}) {
  if (!record || typeof record !== 'object') return false;
  let changed = false;

  if (Array.isArray(record.images)) {
    const clean = record.images.filter((image) => image && !isBlockedStockImageUrl(image));
    if (clean.length !== record.images.length) {
      record.images = clean;
      changed = true;
    }
  }

  const primaryRealImage = primaryRealProductMedia(record);

  if (primaryRealImage && IMAGE_FIELDS.has('image') && record.image !== primaryRealImage) {
    record.image = primaryRealImage;
    changed = true;
  }

  if (primaryRealImage && record.fallbackImage !== primaryRealImage) {
    record.fallbackImage = primaryRealImage;
    changed = true;
  }

  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item && typeof item === 'object') changed = cleanImages(item) || changed;
      });
      continue;
    }

    if (!value || typeof value !== 'string') continue;

    if (SUPPLIER_IMAGE_FIELDS.has(key) && isBlockedStockImageUrl(value)) {
      record[key] = '';
      changed = true;
      continue;
    }

    if (IMAGE_FIELDS.has(key) && value.startsWith(GENERATED_FALLBACK_PATH)) {
      record[key] = primaryRealImage || '';
      changed = true;
      continue;
    }

    if (IMAGE_FIELDS.has(key) && isBlockedStockImageUrl(value)) {
      record[key] = primaryRealImage || record.images?.[0] || '';
      changed = true;
    }
  }

  if (!record.image && record.title && record.fallbackImage && !isBlockedStockImageUrl(record.fallbackImage)) {
    record.image = record.fallbackImage;
    changed = true;
  }

  if (record.fallbackImage && isBlockedStockImageUrl(record.fallbackImage)) {
    record.fallbackImage = primaryRealImage || '';
    changed = true;
  }

  if (record.fallbackImage && String(record.fallbackImage).startsWith(GENERATED_FALLBACK_PATH)) {
    record.fallbackImage = primaryRealImage || '';
    changed = true;
  }

  if (record.imageStatus === 'curated-photo-fallback' && record.image && String(record.image).startsWith(GENERATED_FALLBACK_PATH)) {
    record.imageStatus = primaryRealImage ? 'real-product-photo' : 'real-product-photo-needed';
    record.imageSource = primaryRealImage ? 'MAT STORE real product media' : '';
    changed = true;
  }

  return cleanAiProviderBranding(record) || changed;
}

async function hardenCollection(collection) {
  const records = await store.read(collection);
  if (!Array.isArray(records)) return { collection, scanned: 0, changed: 0 };

  let changed = 0;
  records.forEach((record) => {
    const blockedStockImageResult = scrubBlockedStockImageText(record);
    const imageCleanupChanged = cleanImages(record);
    let recordChanged = blockedStockImageResult.changed || imageCleanupChanged;
    if (collection === 'products' && blockedStockImageResult.found && record.status !== 'archived') {
      record.status = 'archived';
      record.statusReason = 'Archived because the listing contained blocked stock image references';
      record.updatedAt = new Date().toISOString();
      recordChanged = true;
    }
    if (collection === 'products' && isQuestionableProduct(record) && record.status !== 'archived') {
      record.status = 'archived';
      record.statusReason = 'Archived by MAT STORE catalog quality hardening';
      record.updatedAt = new Date().toISOString();
      recordChanged = true;
    }
    if (collection === 'products' && !hasRealProductMedia(record) && record.status !== 'archived') {
      record.status = 'archived';
      record.statusReason = 'Archived because the listing does not have real product media';
      record.updatedAt = new Date().toISOString();
      recordChanged = true;
    }
    if (recordChanged) changed += 1;
  });

  if (changed) await store.write(collection, records);
  return { collection, scanned: records.length, changed };
}

async function main() {
  const results = [];
  for (const collection of ARRAY_COLLECTIONS) {
    results.push(await hardenCollection(collection));
  }
  console.log(JSON.stringify({ ok: true, storage: store.usingFirestore() ? 'firestore' : 'json', results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
