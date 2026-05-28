const marketplaceSearchService = require('../services/marketplaceSearchService');
const { publicMarketplaceSearchResult } = require('../utils/publicCatalog');

async function search(req, res, next) {
  try {
    const result = await marketplaceSearchService.searchMarketplaces(req.query);
    res.json(req.user?.role === 'admin' ? result : publicMarketplaceSearchResult(result));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  search
};
