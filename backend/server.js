const path = require('path');
const express = require('express');
const config = require('./config');
const securityMiddleware = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const userService = require('./services/userService');

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

securityMiddleware(app);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    name: 'MAT STORE API',
    time: new Date().toISOString()
  });
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
    etag: true
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
