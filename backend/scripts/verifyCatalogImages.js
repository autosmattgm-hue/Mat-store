const productService = require('../services/productService');
const store = require('../database/jsonStore');
const {
  hasRealProductMedia,
  isUnverifiedSearchImageProduct,
  isUntrustedDiscoveredImageProduct
} = require('../utils/catalogQuality');

const batchLimit = Math.min(250, Math.max(1, Number(process.env.CATALOG_VERIFY_BATCH || process.argv[2] || 80)));
const maxBatches = Math.min(100, Math.max(1, Number(process.env.CATALOG_VERIFY_BATCHES || process.argv[3] || 20)));

async function catalogStats() {
  const products = await store.read('products');
  return products.reduce((stats, product) => {
    stats.total += 1;
    if (product.status === 'active') stats.active += 1;
    if (hasRealProductMedia(product)) stats.withRealMedia += 1;
    if (product.imageVerification === 'live-product-download' && product.imageVerifiedAt) stats.liveVerified += 1;
    if (isUnverifiedSearchImageProduct(product)) stats.unverifiedSearch += 1;
    if (isUntrustedDiscoveredImageProduct(product)) stats.untrustedDiscovered += 1;
    return stats;
  }, {
    total: 0,
    active: 0,
    withRealMedia: 0,
    liveVerified: 0,
    unverifiedSearch: 0,
    untrustedDiscovered: 0
  });
}

async function main() {
  const before = await catalogStats();
  const batches = [];

  for (let index = 0; index < maxBatches; index += 1) {
    const result = await productService.repairImages({
      limit: batchLimit,
      verifyLive: true
    });
    batches.push(result);
    if (!result.checked) break;
  }

  const after = await catalogStats();
  const summary = batches.reduce((totals, batch) => ({
    checked: totals.checked + Number(batch.checked || 0),
    repaired: totals.repaired + Number(batch.repaired || 0),
    drafted: totals.drafted + Number(batch.drafted || 0),
    removed: totals.removed + Number(batch.removed || 0),
    unresolved: totals.unresolved + Number(batch.unresolved || 0)
  }), { checked: 0, repaired: 0, drafted: 0, removed: 0, unresolved: 0 });

  console.log(JSON.stringify({
    ok: true,
    storage: store.usingFirestore() ? 'firestore' : 'json',
    batchLimit,
    maxBatches,
    before,
    summary,
    after
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
