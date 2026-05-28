const importerService = require('../services/importerService');

async function preview(req, res, next) {
  try {
    const input = req.body.urls || req.body.links || req.body.url;
    const options = {
      ...(req.body.options || {}),
      imageUrl: req.body.imageUrl || req.body.manualImageUrl || req.body.options?.imageUrl,
      stock: req.body.stock ?? req.body.options?.stock,
      markupPercent: req.body.markupPercent ?? req.body.options?.markupPercent
    };
    const result = await importerService.previewImports(input, options);
    res.json({
      ...result,
      product: result.products[0]
    });
  } catch (error) {
    next(error);
  }
}

async function importProduct(req, res, next) {
  try {
    const input = req.body.urls || req.body.links || req.body.url;
    const options = {
      ...(req.body.options || {}),
      imageUrl: req.body.imageUrl || req.body.manualImageUrl || req.body.options?.imageUrl,
      stock: req.body.stock ?? req.body.options?.stock,
      markupPercent: req.body.markupPercent ?? req.body.options?.markupPercent
    };
    const result = await importerService.importProducts(input, req.body.overrides || {}, options);
    res.status(201).json({
      ...result,
      product: result.products[0]
    });
  } catch (error) {
    next(error);
  }
}

function marketplaces(req, res) {
  res.json({ marketplaces: importerService.allowedMarketplaces });
}

module.exports = {
  preview,
  importProduct,
  marketplaces
};
