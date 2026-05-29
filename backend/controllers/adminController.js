const analyticsService = require('../services/analyticsService');
const userService = require('../services/userService');
const pricingService = require('../services/pricingService');
const productService = require('../services/productService');
const notificationService = require('../services/notificationService');
const store = require('../database/jsonStore');

async function dashboard(req, res, next) {
  try {
    const analytics = await analyticsService.dashboard();
    res.json({ analytics });
  } catch (error) {
    next(error);
  }
}

async function customers(req, res, next) {
  try {
    const items = await userService.listCustomers();
    res.json({ customers: items });
  } catch (error) {
    next(error);
  }
}

async function notifications(req, res, next) {
  try {
    const items = await notificationService.listNotifications(req.query);
    res.json({ notifications: items });
  } catch (error) {
    next(error);
  }
}

async function settings(req, res, next) {
  try {
    const settingsData = await store.read('settings');
    res.json({ settings: settingsData });
  } catch (error) {
    next(error);
  }
}

async function updatePricing(req, res, next) {
  try {
    const pricing = await pricingService.updatePricingSettings(req.body);
    res.json({ pricing });
  } catch (error) {
    next(error);
  }
}

async function inventorySync(req, res, next) {
  try {
    const lowStock = await productService.lowStockProducts();
    res.json({
      status: 'synced',
      lowStock,
      message: `${lowStock.length} products need supplier review.`
    });
  } catch (error) {
    next(error);
  }
}

async function seoAudit(req, res, next) {
  try {
    const products = await store.read('products');
    const items = products.map((product) => ({
      id: product.id,
      title: product.title,
      slug: product.slug,
      score: [
        product.seo?.title,
        product.seo?.description,
        product.images?.length,
        product.description?.length > 120,
        product.tags?.length > 2
      ].filter(Boolean).length * 20,
      missing: [
        !product.seo?.title && 'SEO title',
        !product.seo?.description && 'SEO description',
        !product.images?.length && 'image',
        !(product.description?.length > 120) && 'long description',
        !(product.tags?.length > 2) && 'tags'
      ].filter(Boolean)
    }));
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

async function imageAudit(req, res, next) {
  try {
    const products = await store.read('products');
    const items = products.map((product) => ({
      id: product.id,
      title: product.title,
      images: product.images?.length || 0,
      primaryImage: product.images?.[0] || '',
      optimized: Boolean(product.images?.[0]?.includes('auto=format') || product.images?.[0]?.includes('q_auto')),
      action: product.images?.length ? 'ready' : 'upload-required'
    }));
    res.json({ items });
  } catch (error) {
    next(error);
  }
}

async function cleanupDuplicates(req, res, next) {
  try {
    const result = await productService.cleanupDuplicates();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function repairPricing(req, res, next) {
  try {
    const result = await productService.repairPricing(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function repairImages(req, res, next) {
  try {
    const result = await productService.repairImages(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  dashboard,
  customers,
  notifications,
  settings,
  updatePricing,
  inventorySync,
  seoAudit,
  imageAudit,
  cleanupDuplicates,
  repairPricing,
  repairImages
};
