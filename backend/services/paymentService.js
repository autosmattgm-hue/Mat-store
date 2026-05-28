const config = require('../config');
const orderService = require('./orderService');
const currencyService = require('./currencyService');

async function createStripeCheckout(order) {
  if (!config.stripe.secretKey) {
    return {
      provider: 'stripe',
      mode: 'demo',
      checkoutUrl: `${config.clientUrl}/?order=${order.orderNumber}&payment=stripe-demo`,
      message: 'Stripe key is not configured. Demo checkout handoff returned.'
    };
  }

  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${config.clientUrl}/?order=${order.orderNumber}&payment=success`);
  body.set('cancel_url', `${config.clientUrl}/?order=${order.orderNumber}&payment=cancelled`);
  body.set('customer_email', order.customer.email);
  body.set('metadata[orderId]', order.id);
  body.set('metadata[orderNumber]', order.orderNumber);

  order.items.forEach((item, index) => {
    body.set(`line_items[${index}][quantity]`, String(item.quantity));
    body.set(`line_items[${index}][price_data][currency]`, order.currency.toLowerCase());
    body.set(`line_items[${index}][price_data][unit_amount]`, String(Math.round(currencyService.convertFromUsd(item.unitPrice, order.currency) * 100)));
    body.set(`line_items[${index}][price_data][product_data][name]`, item.title);
    if (item.image) body.set(`line_items[${index}][price_data][product_data][images][0]`, item.image);
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const session = await response.json();
  if (!response.ok) throw new Error(session.error?.message || 'Stripe checkout could not be created.');

  return {
    provider: 'stripe',
    mode: 'live',
    checkoutUrl: session.url,
    sessionId: session.id
  };
}

async function paypalAccessToken() {
  if (!config.paypal.clientId || !config.paypal.clientSecret) return null;
  const credentials = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const response = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.access_token;
}

async function createPayPalOrder(order) {
  const token = await paypalAccessToken();
  if (!token) {
    return {
      provider: 'paypal',
      mode: 'demo',
      approvalUrl: `${config.clientUrl}/?order=${order.orderNumber}&payment=paypal-demo`,
      message: 'PayPal credentials are not configured. Demo approval handoff returned.'
    };
  }

  const response = await fetch(`${config.paypal.apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          amount: {
            currency_code: order.currency,
            value: order.totals.displayTotal.toFixed(2)
          }
        }
      ],
      application_context: {
        brand_name: 'MAT STORE',
        return_url: `${config.clientUrl}/?order=${order.orderNumber}&payment=success`,
        cancel_url: `${config.clientUrl}/?order=${order.orderNumber}&payment=cancelled`
      }
    })
  });

  const data = await response.json();
  const approvalUrl = data.links?.find((link) => link.rel === 'approve')?.href;
  return {
    provider: 'paypal',
    mode: 'live',
    orderId: data.id,
    approvalUrl
  };
}

async function createPaymentHandoff(order) {
  if (order.paymentMethod === 'paypal') return createPayPalOrder(order);
  if (order.paymentMethod === 'whatsapp') {
    return {
      provider: 'whatsapp',
      mode: 'direct',
      whatsappUrl: orderService.buildWhatsAppOrderUrl(order, config.whatsappNumber)
    };
  }
  return createStripeCheckout(order);
}

module.exports = {
  createPaymentHandoff,
  createStripeCheckout,
  createPayPalOrder
};
