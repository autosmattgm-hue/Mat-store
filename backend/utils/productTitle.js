const BRAND_CASES = new Map([
  ['hp', 'HP'],
  ['lg', 'LG'],
  ['msi', 'MSI'],
  ['asus', 'ASUS'],
  ['rog', 'ROG'],
  ['dell', 'Dell'],
  ['lenovo', 'Lenovo'],
  ['acer', 'Acer'],
  ['apple', 'Apple'],
  ['iphone', 'iPhone'],
  ['ipad', 'iPad'],
  ['macbook', 'MacBook'],
  ['samsung', 'Samsung'],
  ['galaxy', 'Galaxy'],
  ['sony', 'Sony'],
  ['nvidia', 'NVIDIA'],
  ['rtx', 'RTX'],
  ['intel', 'Intel'],
  ['amd', 'AMD'],
  ['ryzen', 'Ryzen'],
  ['usb', 'USB'],
  ['ssd', 'SSD'],
  ['hdd', 'HDD'],
  ['nvme', 'NVMe'],
  ['oled', 'OLED'],
  ['qled', 'QLED'],
  ['uhd', 'UHD'],
  ['fhd', 'FHD'],
  ['led', 'LED'],
  ['tv', 'TV'],
  ['pc', 'PC'],
  ['ps5', 'PS5'],
  ['xbox', 'Xbox'],
  ['nike', 'Nike'],
  ['adidas', 'Adidas']
]);

function collapseSpaces(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripSourceScaffolding(value = '') {
  return collapseSpaces(value)
    .replace(/\bAmazon\.com\s*:\s*/gi, '')
    .replace(/\s*[:|,-]\s*(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)(?:\.[a-z]{2,}){0,4}(?:\s*[:|,-]\s*[^|,:-]+)?\s*$/gi, '')
    .replace(/^\s*(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)\s+(?:Search|Goldbox|Front Page|Global Deals|Marketplace|Deals|Picks?)\s*:?\s*/gi, '')
    .replace(/^\s*(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)\s+(?:Product|Deal|Search Pick|Search Match)\s+[A-Z0-9-]{6,}\s*$/gi, '')
    .replace(/\s*(?:[-|:]\s*)?(?:Amazon|Walmart|AliExpress|Alibaba|eBay|Temu)(?:\.[a-z.]+)?(?:\s+.*)?$/gi, '')
    .replace(/\s*[-:]\s*(?:timeless luxury(?:\s+smartphone|\s+in\b.*)?|luxury smartphone|premium MAT STORE.*)\s*$/i, '')
    .replace(/\s+\|\s*MAT STORE$/i, '')
    .replace(/\s+-\s*MAT STORE$/i, '')
    .trim();
}

function stripMatPrefix(value = '') {
  return collapseSpaces(value).replace(/^mat\s+(?:store\s+)?/i, '').trim();
}

function titleCase(value = '') {
  return collapseSpaces(value)
    .toLowerCase()
    .replace(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*/gu, (word) => {
      const lower = word.toLowerCase();
      return BRAND_CASES.get(lower) || lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .replace(/\b(\d+)\s?gb\b/gi, '$1GB')
    .replace(/\b(\d+)\s?tb\b/gi, '$1TB')
    .replace(/\b(\d+)\s?mb\b/gi, '$1MB')
    .replace(/\b(\d+)k\b/gi, '$1K');
}

function cleanProductTitle(value = '', fallback = 'Marketplace Product') {
  const stripped = stripSourceScaffolding(stripMatPrefix(value));
  const clean = collapseSpaces(stripped || fallback)
    .replace(/^\s*buy\s+/i, '')
    .replace(/\b(?:best match|premium pick|deal option|customer favorite|high value find|fast shipping option)\b$/i, '')
    .replace(/\b(?:search pick|search match)\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:product|deal|marketplace product|search pick|search match)$/i.test(clean)) return fallback;
  return clean || fallback;
}

function formatBrandTitle(value = '', fallback = 'Marketplace Product') {
  return titleCase(cleanProductTitle(value, fallback));
}

module.exports = {
  cleanProductTitle,
  formatBrandTitle,
  stripMatPrefix,
  stripSourceScaffolding
};
