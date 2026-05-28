const ratesToUsd = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  GMD: 67.8,
  NGN: 1480,
  CAD: 1.36,
  AED: 3.67,
  AUD: 1.51,
  JPY: 156.8,
  CNY: 7.24,
  ZAR: 18.35,
  XOF: 603.2
};

const countryCurrencyMap = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  GM: 'GMD',
  NG: 'NGN',
  AE: 'AED',
  FR: 'EUR',
  DE: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR'
};

const currencySymbols = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  GMD: 'D',
  NGN: '₦',
  CAD: 'C$',
  AED: 'د.إ',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
  ZAR: 'R',
  XOF: 'CFA'
};

function supportedCurrencies() {
  return Object.keys(ratesToUsd);
}

function detectCurrency(country = '') {
  return countryCurrencyMap[String(country).toUpperCase()] || 'USD';
}

function convertFromUsd(amount, targetCurrency = 'USD') {
  const currency = String(targetCurrency || 'USD').toUpperCase();
  const rate = ratesToUsd[currency] || 1;
  return Math.round(Number(amount || 0) * rate * 100) / 100;
}

function convertToUsd(amount, sourceCurrency = 'USD') {
  const currency = String(sourceCurrency || 'USD').toUpperCase();
  const rate = ratesToUsd[currency] || 1;
  return Math.round((Number(amount || 0) / rate) * 100) / 100;
}

function formatMoney(amount, currency = 'USD') {
  const code = String(currency || 'USD').toUpperCase();
  const symbol = currencySymbols[code] || `${code} `;
  const rounded = Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: code === 'JPY' ? 0 : 2,
    maximumFractionDigits: code === 'JPY' ? 0 : 2
  });
  return `${symbol}${rounded}`;
}

module.exports = {
  ratesToUsd,
  currencySymbols,
  supportedCurrencies,
  detectCurrency,
  convertFromUsd,
  convertToUsd,
  formatMoney
};
