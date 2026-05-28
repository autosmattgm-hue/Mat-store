const store = require('../database/jsonStore');
const productService = require('./productService');
const cartService = require('./cartService');

async function dashboard() {
  const [orders, users, products, abandonedCarts, lowStock] = await Promise.all([
    store.read('orders'),
    store.read('users'),
    store.read('products'),
    cartService.listAbandonedCarts(),
    productService.lowStockProducts()
  ]);

  const revenue = orders.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0);
  const pendingOrders = orders.filter((order) => order.fulfillmentStatus !== 'delivered' && order.fulfillmentStatus !== 'cancelled').length;
  const activeProducts = products.filter((product) => product.status === 'active').length;
  const averageOrderValue = orders.length ? revenue / orders.length : 0;
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const ordersToday = orders.filter((order) => String(order.createdAt || '').slice(0, 10) === todayKey);
  const recentOrders = orders.filter((order) => new Date(order.createdAt || 0) >= thirtyDaysAgo);
  const revenueToday = ordersToday.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0);
  const revenue30Days = recentOrders.reduce((sum, order) => sum + Number(order.totals?.total || 0), 0);
  const customerCount = users.filter((user) => user.role === 'user').length;
  const catalog = await productService.catalogHealth(products);
  const categoryRevenue = {};

  for (const order of orders) {
    for (const item of order.items || []) {
      const product = products.find((entry) => entry.id === item.productId);
      const category = product?.category || 'uncategorized';
      categoryRevenue[category] = (categoryRevenue[category] || 0) + item.lineTotal;
    }
  }

  return {
    revenue,
    revenueToday,
    revenue30Days,
    orders: orders.length,
    ordersToday: ordersToday.length,
    pendingOrders,
    customers: customerCount,
    activeProducts,
    totalProducts: catalog.totalProducts,
    averageOrderValue,
    conversionSignal: customerCount ? Number(((orders.length / customerCount) * 100).toFixed(1)) : 0,
    abandonedCarts: abandonedCarts.length,
    lowStock,
    duplicateCount: catalog.duplicateCount,
    inventoryValue: catalog.inventoryValue,
    retailValue: catalog.retailValue,
    marginValue: catalog.marginValue,
    pricingHealth: catalog.pricingHealth,
    imageHealth: catalog.imageHealth,
    collectionStats: catalog.collectionStats,
    marketplaceStats: catalog.marketplaceStats,
    statusStats: catalog.statusStats,
    recentProducts: catalog.recentProducts,
    categoryRevenue: Object.entries(categoryRevenue)
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value)
  };
}

module.exports = {
  dashboard
};
