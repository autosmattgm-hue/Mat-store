const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');

function securityMiddleware(app) {
  app.disable('x-powered-by');
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com', 'https://www.paypal.com', 'https://www.paypalobjects.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          mediaSrc: ["'self'", 'https:'],
          connectSrc: [
            "'self'",
            'https://api.stripe.com',
            'https://www.paypal.com',
            'https://www.sandbox.paypal.com',
            'https://www.paypalobjects.com',
            'https://api-m.sandbox.paypal.com',
            'https://api-m.paypal.com',
            'https://integrate.api.nvidia.com',
            'https://api.nvidia.com'
          ],
          frameSrc: ['https://js.stripe.com', 'https://www.paypal.com', 'https://www.sandbox.paypal.com', 'https://www.paypalobjects.com'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: []
        }
      }
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === config.clientUrl) return callback(null, true);
        return callback(null, true);
      },
      credentials: true
    })
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use(
    ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password'],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
}

module.exports = securityMiddleware;
