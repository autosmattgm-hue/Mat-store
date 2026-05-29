const { randomUUID } = require('crypto');
const config = require('../config');
const orderService = require('./orderService');
const HttpError = require('../utils/httpError');
const { sanitizeString } = require('../utils/sanitize');

const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'ILS',
  'JPY',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'SEK',
  'SGD',
  'THB',
  'TWD',
  'USD'
]);

function configuredPayPal() {
  return Boolean(config.paypal.clientId && config.paypal.clientSecret);
}

function paypalCurrency(requestedCurrency = 'USD') {
  const currency = String(requestedCurrency || 'USD').toUpperCase();
  return PAYPAL_SUPPORTED_CURRENCIES.has(currency) ? currency : 'USD';
}

function paypalAmountForOrder(order) {
  const currency = paypalCurrency(order.currency);
  const amount = currency === order.currency ? order.totals.displayTotal : order.totals.total;
  return {
    currency,
    value: Number(amount || 0).toFixed(currency === 'JPY' ? 0 : 2),
    convertedFrom: currency === order.currency ? '' : order.currency
  };
}

function friendlyPayPalError(data = {}) {
  const detail = data.details?.[0] || {};
  const issue = sanitizeString(detail.issue || data.name || '', 120);
  const description = sanitizeString(detail.description || data.message || '', 280);
  if (issue === 'PAYEE_ACCOUNT_RESTRICTED') {
    return 'PayPal cannot create live orders because the merchant account is restricted. Open PayPal Business Resolution Center or use valid Sandbox credentials until PayPal removes the restriction.';
  }
  if (issue === 'DUPLICATE_INVOICE_ID') return 'PayPal rejected this order because the invoice id was already used. Please restart checkout.';
  if (issue === 'INVALID_RESOURCE_ID') return 'PayPal could not find this payment session. Please restart checkout.';
  if (issue === 'INSTRUMENT_DECLINED') return 'PayPal declined this payment method. Choose another PayPal funding source or card.';
  if (issue && description) return `PayPal rejected the order: ${issue} - ${description}`;
  return description || 'PayPal order could not be created.';
}

function publicPayPalDetails(data = {}) {
  const detail = data.details?.[0] || {};
  return {
    name: sanitizeString(data.name || '', 120),
    issue: sanitizeString(detail.issue || '', 120),
    field: sanitizeString(detail.field || '', 180),
    description: sanitizeString(detail.description || data.message || '', 260),
    debugId: sanitizeString(data.debug_id || '', 120),
    informationLink: sanitizeString(data.links?.find((link) => link.rel === 'information_link')?.href || '', 260)
  };
}

function paypalClientConfig(requestedCurrency = 'USD') {
  const currency = paypalCurrency(requestedCurrency);
  const sandbox = config.paypal.apiBase.includes('sandbox');
  return {
    enabled: configuredPayPal(),
    clientId: config.paypal.clientId || '',
    currency,
    requestedCurrency: String(requestedCurrency || 'USD').toUpperCase(),
    components: 'buttons,card-fields',
    intent: 'capture',
    buyerCountry: sandbox ? 'US' : '',
    enableFunding: 'venmo',
    sandbox,
    mode: sandbox ? 'sandbox' : 'live'
  };
}

async function paypalAccessToken(options = {}) {
  if (!configuredPayPal()) {
    if (options.required) throw new HttpError(424, 'PayPal checkout is not configured yet.');
    return null;
  }
  const credentials = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const response = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (options.required) {
      const mode = config.paypal.apiBase.includes('sandbox') ? 'sandbox' : 'live';
      throw new HttpError(424, data.error_description || `PayPal authentication failed for ${mode} credentials. Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_API_BASE.`);
    }
    return null;
  }
  return data.access_token;
}

async function createPayPalOrder(order, options = {}) {
  const token = await paypalAccessToken({ required: Boolean(options.required) });
  if (!token) {
    return {
      provider: 'paypal',
      mode: 'demo',
      approvalUrl: `/orders.html?created=${encodeURIComponent(order.orderNumber)}&payment=paypal-demo`,
      requiresConfiguration: true,
      message: 'PayPal is not configured yet. Order was created without redirecting to the homepage.'
    };
  }

  const settlement = paypalAmountForOrder(order);
  const response = await fetch(`${config.paypal.apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `mat-create-${order.id}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          invoice_id: order.orderNumber,
          custom_id: order.id,
          description: `MAT STORE ${order.orderNumber}`,
          amount: {
            currency_code: settlement.currency,
            value: settlement.value
          }
        }
      ],
      application_context: {
        brand_name: 'MAT STORE',
        locale: 'en-US',
        landing_page: 'LOGIN',
        shipping_preference: 'GET_FROM_FILE',
        user_action: 'PAY_NOW',
        return_url: `${config.clientUrl}/orders.html?order=${order.orderNumber}&payment=success`,
        cancel_url: `${config.clientUrl}/checkout.html?order=${order.orderNumber}&payment=cancelled`
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(424, friendlyPayPalError(data), publicPayPalDetails(data));
  }
  const approvalUrl = data.links?.find((link) => link.rel === 'approve')?.href;
  await orderService.updateOrderPayment(order.id, {
    provider: 'paypal',
    paymentStatus: 'pending',
    processorOrderId: data.id,
    processorStatus: data.status,
    processorMode: config.paypal.apiBase.includes('sandbox') ? 'sandbox' : 'live',
    settlementCurrency: settlement.currency,
    settlementAmount: Number(settlement.value),
    message: settlement.convertedFrom
      ? `PayPal order created in ${settlement.currency}; customer display currency was ${settlement.convertedFrom}.`
      : 'PayPal order created.'
  });

  return {
    provider: 'paypal',
    mode: 'live',
    orderId: data.id,
    approvalUrl,
    currency: settlement.currency,
    amount: Number(settlement.value),
    convertedFrom: settlement.convertedFrom
  };
}

function paymentStatusFromPayPal(status = '') {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'COMPLETED') return 'paid';
  if (normalized === 'APPROVED') return 'approved';
  if (normalized === 'VOIDED' || normalized === 'CANCELLED') return 'cancelled';
  if (normalized === 'PAYER_ACTION_REQUIRED') return 'action_required';
  return normalized ? normalized.toLowerCase() : 'pending';
}

async function capturePayPalOrder(payload = {}) {
  const paypalOrderId = sanitizeString(payload.orderID || payload.orderId || '', 120);
  if (!paypalOrderId) throw new HttpError(400, 'PayPal order id is required.');

  const token = await paypalAccessToken({ required: true });
  const response = await fetch(`${config.paypal.apiBase}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `mat-capture-${sanitizeString(payload.localOrderId || randomUUID(), 80)}`,
      Prefer: 'return=representation'
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(424, friendlyPayPalError(data), publicPayPalDetails(data));
  }

  const purchaseUnit = data.purchase_units?.[0] || {};
  const capture = purchaseUnit.payments?.captures?.[0] || {};
  const localOrderId = sanitizeString(purchaseUnit.custom_id || purchaseUnit.reference_id || payload.localOrderId || '', 120);
  let order = null;
  if (localOrderId) {
    order = await orderService.updateOrderPayment(localOrderId, {
      userId: payload.userId || '',
      provider: 'paypal',
      paymentStatus: paymentStatusFromPayPal(data.status),
      processorOrderId: data.id || paypalOrderId,
      processorCaptureId: capture.id || '',
      processorStatus: capture.status || data.status,
      processorMode: config.paypal.apiBase.includes('sandbox') ? 'sandbox' : 'live',
      settlementCurrency: capture.amount?.currency_code || purchaseUnit.amount?.currency_code || '',
      settlementAmount: Number(capture.amount?.value || purchaseUnit.amount?.value || 0),
      payerEmail: data.payer?.email_address || '',
      message: `PayPal capture ${capture.status || data.status || 'received'}.`
    });
  }

  return {
    provider: 'paypal',
    mode: config.paypal.apiBase.includes('sandbox') ? 'sandbox' : 'live',
    status: data.status,
    paypalOrderId: data.id || paypalOrderId,
    captureId: capture.id || '',
    order,
    details: data
  };
}

async function createPaymentHandoff(order) {
  return createPayPalOrder(order);
}

module.exports = {
  createPaymentHandoff,
  createPayPalOrder,
  capturePayPalOrder,
  paypalClientConfig,
  paypalCurrency
};
