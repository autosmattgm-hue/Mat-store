const productService = require('../services/productService');
const reviewService = require('../services/reviewService');
const { publicCatalogResult, publicProduct, publicSuggestion } = require('../utils/publicCatalog');
const { hasRealProductMedia, isGeneratedSearchProduct, isQuestionableProduct, isUntrustedDiscoveredImageProduct } = require('../utils/catalogQuality');
const HttpError = require('../utils/httpError');

function isAdminRequest(req) {
  return req.user?.role === 'admin';
}

async function list(req, res, next) {
  try {
    const result = await productService.listProducts({ ...req.query, includeDrafts: isAdminRequest(req) });
    res.json(isAdminRequest(req) ? result : publicCatalogResult(result));
  } catch (error) {
    next(error);
  }
}

async function get(req, res, next) {
  try {
    const product = await productService.getProduct(req.params.idOrSlug, req.query.currency);
    if (!isAdminRequest(req) && (
      product.status !== 'active'
      || !hasRealProductMedia(product)
      || isQuestionableProduct(product)
      || isGeneratedSearchProduct(product)
      || isUntrustedDiscoveredImageProduct(product)
    )) {
      throw new HttpError(404, 'Product not found.');
    }
    res.json({ product: isAdminRequest(req) ? product : publicProduct(product) });
  } catch (error) {
    next(error);
  }
}

async function suggestions(req, res, next) {
  try {
    const items = await productService.searchSuggestions(req.query.q);
    res.json({ items: isAdminRequest(req) ? items : items.map(publicSuggestion) });
  } catch (error) {
    next(error);
  }
}

async function reviews(req, res, next) {
  try {
    const items = await reviewService.listProductReviews(req.params.id, req.query);
    const summary = await reviewService.productReviewSummary(req.params.id);
    res.json({ reviews: items, summary });
  } catch (error) {
    next(error);
  }
}

async function createReview(req, res, next) {
  try {
    const result = await reviewService.createReview(req.params.id, req.body, req.user || null);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const product = await productService.createProduct(req.body);
    res.status(201).json({ product });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const product = await productService.updateProduct(req.params.id, req.body);
    res.json({ product });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const result = await productService.deleteProduct(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function bulkMarkup(req, res, next) {
  try {
    const products = await productService.bulkMarkup(req.body.markupPercent);
    res.json({ products });
  } catch (error) {
    next(error);
  }
}

async function lowStock(req, res, next) {
  try {
    const products = await productService.lowStockProducts();
    res.json({ products });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  get,
  suggestions,
  reviews,
  createReview,
  create,
  update,
  remove,
  bulkMarkup,
  lowStock
};
