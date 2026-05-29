const store = require('../database/jsonStore');

const DEFAULT_PRICING = {
  defaultMarkupPercent: 40,
  hardToFindMarkupPercent: 50,
  maxResponsibleMarkupPercent: 70,
  fixedMargin: 0,
  rounding: 0.99,
  smartPricing: true,
  paymentFeePercent: 3.4,
  paymentFeeFixed: 0.49,
  riskBufferPercent: 4,
  profitProtectionPercent: 12
};

const PRICING_TIERS = [
  { max: 2, label: 'micro accessory', minProfit: 2.25 },
  { max: 5, label: 'low-cost impulse', minProfit: 3.25 },
  { max: 15, label: 'entry deal', minProfit: 5.25 },
  { max: 50, label: 'core catalog', minProfit: 8.5 },
  { max: 150, label: 'premium everyday', minProfit: 16 },
  { max: 500, label: 'high-consideration', minProfit: 32 },
  { max: 1200, label: 'high-ticket', minProfit: 58 },
  { max: Infinity, label: 'luxury high-ticket', minProfit: 90 }
];

function moneyNumber(value, fallback = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.max(0, Math.round(amount * 100) / 100);
}

function clampNumber(value, min, max, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.min(max, Math.max(min, amount));
}

function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_PRICING,
    ...(settings || {}),
    defaultMarkupPercent: clampNumber(settings.defaultMarkupPercent, 1, 150, DEFAULT_PRICING.defaultMarkupPercent),
    hardToFindMarkupPercent: clampNumber(settings.hardToFindMarkupPercent, 1, 150, DEFAULT_PRICING.hardToFindMarkupPercent),
    maxResponsibleMarkupPercent: clampNumber(settings.maxResponsibleMarkupPercent, 1, 150, DEFAULT_PRICING.maxResponsibleMarkupPercent),
    fixedMargin: clampNumber(settings.fixedMargin, 0, 10000, DEFAULT_PRICING.fixedMargin),
    rounding: Number.isFinite(Number(settings.rounding)) ? Number(settings.rounding) : DEFAULT_PRICING.rounding,
    paymentFeePercent: clampNumber(settings.paymentFeePercent, 0, 12, DEFAULT_PRICING.paymentFeePercent),
    paymentFeeFixed: clampNumber(settings.paymentFeeFixed, 0, 5, DEFAULT_PRICING.paymentFeeFixed),
    riskBufferPercent: clampNumber(settings.riskBufferPercent, 0, 25, DEFAULT_PRICING.riskBufferPercent),
    profitProtectionPercent: clampNumber(settings.profitProtectionPercent, 0, 60, DEFAULT_PRICING.profitProtectionPercent),
    smartPricing: settings.smartPricing !== false
  };
}

function roundLuxuryPrice(value, rounding = 0.99) {
  const amount = Math.max(0, Number(value || 0));
  if (rounding === 0) return Math.round(amount * 100) / 100;
  const roundedCents = Number(rounding || 0.99);
  const floored = Math.floor(amount);
  let candidate = floored + roundedCents;
  if (candidate + 0.0001 < amount) candidate = floored + 1 + roundedCents;
  return Math.round(candidate * 100) / 100;
}

async function getPricingSettings() {
  const settings = await store.read('settings');
  return normalizeSettings(settings.pricing || DEFAULT_PRICING);
}

async function updatePricingSettings(payload) {
  let nextSettings;
  await store.update('settings', (settings) => {
    const pricing = normalizeSettings(settings.pricing || DEFAULT_PRICING);
    nextSettings = {
      ...settings,
      pricing: {
        ...pricing,
        defaultMarkupPercent: clampNumber(payload.defaultMarkupPercent, 1, 150, pricing.defaultMarkupPercent),
        hardToFindMarkupPercent: clampNumber(payload.hardToFindMarkupPercent, 1, 150, pricing.hardToFindMarkupPercent),
        maxResponsibleMarkupPercent: clampNumber(payload.maxResponsibleMarkupPercent, 1, 150, pricing.maxResponsibleMarkupPercent),
        fixedMargin: clampNumber(payload.fixedMargin, 0, 10000, pricing.fixedMargin),
        rounding: Number.isFinite(Number(payload.rounding)) ? Number(payload.rounding) : pricing.rounding,
        smartPricing: payload.smartPricing === undefined ? pricing.smartPricing : payload.smartPricing !== false,
        paymentFeePercent: clampNumber(payload.paymentFeePercent, 0, 12, pricing.paymentFeePercent),
        paymentFeeFixed: clampNumber(payload.paymentFeeFixed, 0, 5, pricing.paymentFeeFixed),
        riskBufferPercent: clampNumber(payload.riskBufferPercent, 0, 25, pricing.riskBufferPercent),
        profitProtectionPercent: clampNumber(payload.profitProtectionPercent, 0, 60, pricing.profitProtectionPercent)
      }
    };
    return nextSettings;
  });
  return normalizeSettings(nextSettings.pricing);
}

function tierForSupplierPrice(supplierPrice) {
  return PRICING_TIERS.find((tier) => supplierPrice <= tier.max) || PRICING_TIERS.at(-1);
}

function productDemandSignal(options = {}) {
  const rating = Number(options.rating || options.marketplaceDetails?.reviews?.rating || 0);
  const reviews = Number(options.reviewsCount || options.marketplaceDetails?.reviews?.count || 0);
  const badge = String(options.marketplaceDetails?.badge || '').toLowerCase();
  let boost = 0;
  if (rating >= 4.6) boost += 1.5;
  if (reviews >= 1000) boost += 1.5;
  if (/choice|seller|deal|popular|trending/i.test(badge)) boost += 1;
  return boost;
}

function hardToFindSignal(options = {}) {
  const text = [
    options.title,
    options.description,
    options.shortDescription,
    options.category,
    options.collection,
    options.marketplaceDetails?.badge,
    options.marketplaceDetails?.availability,
    options.marketplaceDetails?.boughtInPastMonth,
    ...(options.tags || []),
    ...(options.features || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const stock = Number(options.stock || 0);
  const lowStockThreshold = Math.max(1, Number(options.lowStockThreshold || 6));
  const reviews = Number(options.reviewsCount || options.marketplaceDetails?.reviews?.count || 0);
  const rating = Number(options.rating || options.marketplaceDetails?.reviews?.rating || 0);
  const reasons = [];
  let score = 0;

  if (options.hardToFind || options.isHardToFind) {
    score += 5;
    reasons.push('Admin marked hard to find');
  }
  if (/\b(hard to find|rare|scarce|limited edition|limited time|exclusive|collectible|collector|discontinued|sold out|only \d+ left|low stock|backorder|pre[-\s]?order)\b/i.test(text)) {
    score += 3;
    reasons.push('Scarcity language detected');
  }
  if (stock > 0 && stock <= lowStockThreshold) {
    score += 2;
    reasons.push('Low stock versus threshold');
  }
  if (/currently unavailable|temporarily out of stock|deal availability may change/i.test(text)) {
    score += 1.5;
    reasons.push('Supplier availability is unstable');
  }
  if (reviews >= 1000 && rating >= 4.6) {
    score += 1;
    reasons.push('High demand social proof');
  }
  if (/\b(luxury|premium|pro|max|ultra|signature|atelier|gold|leather)\b/i.test(text) && reviews >= 250) {
    score += 1;
    reasons.push('Premium high-intent product');
  }

  return {
    isHardToFind: score >= 3,
    score: Math.round(score * 10) / 10,
    reasons: reasons.slice(0, 4)
  };
}

function buildPricingPlan(supplierPriceInput, options = {}, settingsInput = DEFAULT_PRICING) {
  const settings = normalizeSettings(settingsInput);
  const supplierPrice = moneyNumber(supplierPriceInput);
  const requestedMarkup = clampNumber(options.markupPercent ?? settings.defaultMarkupPercent, 1, 150, settings.defaultMarkupPercent);

  if (!supplierPrice) {
    const fallbackPrice = roundLuxuryPrice(options.price || 0, settings.rounding);
    return {
      supplierPrice: 0,
      price: fallbackPrice,
      minStorePrice: fallbackPrice,
      requestedMarkupPercent: requestedMarkup,
      appliedMarkupPercent: requestedMarkup,
      grossProfit: fallbackPrice,
      marginPercent: fallbackPrice ? 100 : 0,
      paymentBuffer: 0,
      riskBuffer: 0,
      fixedMargin: settings.fixedMargin,
      strategy: 'manual-no-supplier-cost',
      protected: false,
      notes: ['No supplier price detected. Add supplier cost for protected pricing.']
    };
  }

  const tier = tierForSupplierPrice(supplierPrice);
  const scarcity = settings.smartPricing ? hardToFindSignal(options) : { isHardToFind: false, score: 0, reasons: [] };
  const baseMarkup = scarcity.isHardToFind ? settings.hardToFindMarkupPercent : settings.defaultMarkupPercent;
  const targetMarkup = settings.smartPricing
    ? clampNumber(Math.max(requestedMarkup, baseMarkup), baseMarkup, settings.maxResponsibleMarkupPercent, baseMarkup)
    : requestedMarkup;
  const markupProfit = supplierPrice * (targetMarkup / 100);
  const feeReserve = supplierPrice * (settings.paymentFeePercent / 100) + settings.paymentFeeFixed;
  const riskReserve = supplierPrice * (settings.riskBufferPercent / 100);
  const protectedProfit = Math.max(
    settings.fixedMargin,
    tier.minProfit,
    supplierPrice * (settings.profitProtectionPercent / 100),
    markupProfit
  );
  const targetPrice = supplierPrice + protectedProfit + feeReserve + riskReserve + settings.fixedMargin;
  const price = roundLuxuryPrice(targetPrice, settings.rounding);
  const grossProfit = moneyNumber(price - supplierPrice);
  const marginPercent = price > 0 ? Math.round((grossProfit / price) * 1000) / 10 : 0;
  const demandBoost = productDemandSignal(options);
  const businessRule = scarcity.isHardToFind ? 'hard-to-find 50% rule' : 'standard 40% rule';

  return {
    supplierPrice,
    price,
    minStorePrice: price,
    requestedMarkupPercent: requestedMarkup,
    appliedMarkupPercent: Math.round(targetMarkup * 10) / 10,
    grossProfit,
    marginPercent,
    paymentBuffer: moneyNumber(feeReserve),
    riskBuffer: moneyNumber(riskReserve),
    fixedMargin: settings.fixedMargin,
    strategy: `AI business ${businessRule}`,
    tier: tier.label,
    businessRule,
    hardToFind: scarcity.isHardToFind,
    scarcityScore: scarcity.score,
    scarcityReasons: scarcity.reasons,
    demandSignal: demandBoost,
    protected: true,
    notes: [
      `Supplier cost protected at $${supplierPrice.toFixed(2)}`,
      `${scarcity.isHardToFind ? 'Hard-to-find product priced with 50% markup' : 'Standard product priced with 40% markup'}`,
      `Estimated PayPal fee and risk reserve $${moneyNumber(feeReserve + riskReserve).toFixed(2)} included before rounding`,
      `Customer-facing price rounded for conversion`
    ]
  };
}

function applySmartPricing(payload = {}, settingsInput = DEFAULT_PRICING, options = {}) {
  const settings = normalizeSettings(settingsInput);
  const supplierPrice = moneyNumber(payload.supplierPrice ?? payload.supplierCost ?? 0);
  const plan = buildPricingPlan(supplierPrice, payload, settings);
  const manualPrice = Number(payload.price);
  const hasManualPrice = Number.isFinite(manualPrice) && manualPrice > 0;
  const preserveManualPrice = options.preserveManualPrice !== false;
  const safeManualPrice = hasManualPrice && preserveManualPrice && manualPrice >= plan.minStorePrice;
  const price = safeManualPrice ? moneyNumber(manualPrice) : plan.price;
  const grossProfit = moneyNumber(price - supplierPrice);
  const marginPercent = price > 0 ? Math.round((grossProfit / price) * 1000) / 10 : 0;

  return {
    ...payload,
    supplierPrice,
    price,
    markupPercent: supplierPrice ? Math.round(((price - supplierPrice) / supplierPrice) * 1000) / 10 : plan.appliedMarkupPercent,
    pricingPlan: {
      ...plan,
      price,
      grossProfit,
      marginPercent,
      manualPricePreserved: safeManualPrice,
      adjusted: hasManualPrice ? Math.abs(price - manualPrice) >= 0.01 : false
    }
  };
}

async function calculateStorePrice(supplierPrice, options = {}) {
  const settings = await getPricingSettings();
  return buildPricingPlan(supplierPrice, options, settings).price;
}

async function calculatePricingPlan(supplierPrice, options = {}) {
  const settings = await getPricingSettings();
  return buildPricingPlan(supplierPrice, options, settings);
}

async function bulkMarkup(products, markupPercent) {
  const settings = await getPricingSettings();
  return products.map((product) =>
    applySmartPricing(
      {
        ...product,
        markupPercent: Number(markupPercent)
      },
      settings,
      { preserveManualPrice: false }
    )
  );
}

module.exports = {
  getPricingSettings,
  updatePricingSettings,
  buildPricingPlan,
  applySmartPricing,
  calculatePricingPlan,
  calculateStorePrice,
  bulkMarkup,
  roundLuxuryPrice
};
