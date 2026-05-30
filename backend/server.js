const path = require('path');
const express = require('express');
const config = require('./config');
const securityMiddleware = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const userService = require('./services/userService');
const currencyService = require('./services/currencyService');
const store = require('./database/jsonStore');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const importerRoutes = require('./routes/importerRoutes');
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const aiAgentRoutes = require('./routes/aiAgentRoutes');
const orderController = require('./controllers/orderController');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1);
app.set('etag', 'strong');
securityMiddleware(app);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    name: 'MAT STORE API',
    storage: store.usingFirestore() ? 'firestore' : 'json',
    time: new Date().toISOString()
  });
});

app.get('/api/currencies', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    supported: currencyService.supportedCurrencies(),
    rates: currencyService.ratesToUsd,
    symbols: currencyService.currencySymbols
  });
});

app.get('/api/settings/public', async (req, res, next) => {
  try {
    const settings = await store.read('settings');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      settings: {
        currencies: settings.currencies || {
          base: 'USD',
          supported: currencyService.supportedCurrencies()
        },
        seo: {
          siteName: settings.seo?.siteName || 'MAT STORE',
          canonicalBaseUrl: settings.seo?.canonicalBaseUrl || config.clientUrl
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/importer', importerRoutes);
app.use('/api/cart', cartRoutes);
app.get('/api/paypal/config', orderController.paypalConfig);
app.post('/api/paypal/orders', requireAuth, orderController.createPaypalOrder);
app.post('/api/paypal/orders/:orderID/capture', requireAuth, (req, res, next) => {
  req.body = { ...req.body, orderID: req.params.orderID };
  return orderController.capturePaypalOrder(req, res, next);
});
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiAgentRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    error: {
      message: 'API route not found.',
      status: 404
    }
  });
});

app.use(
  express.static(path.join(__dirname, '..', 'frontend'), {
    extensions: ['html'],
    maxAge: config.env === 'production' ? '1d' : 0,
    etag: true,
    setHeaders(res, filePath) {
      if (/\.(?:css|js|svg|png|jpe?g|webp|gif|ico|woff2?)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        return;
      }
      if (/\.html$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      }
    }
  })
);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

async function start() {
  await userService.ensureAdminUser();
  app.listen(config.port, () => {
    console.log(`MAT STORE running on http://localhost:${config.port}`);
    console.log(`Admin email: ${config.adminEmail}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start MAT STORE:', error);
    process.exit(1);
  });
}

module.exports = app;
