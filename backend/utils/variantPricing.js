function moneyNumber(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundStorePrice(value) {
  const price = Number(value || 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price < 10) return moneyNumber(price);
  return moneyNumber(Math.max(0.99, Math.ceil(price) - 0.01));
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeOptionLabel(name = '') {
  const clean = cleanText(name).replace(/[:：]+$/g, '').toLowerCase();
  if (/colour|color|shade/.test(clean)) return 'Color';
  if (/digital storage|storage capacity|\bstorage\b|capacity|memory size|rom|volume/.test(clean)) return 'Capacity';
  if (/shoe size|size|fit/.test(clean)) return 'Size';
  if (/style|model|configuration|edition/.test(clean)) return 'Style';
  if (/pack|quantity|count/.test(clean)) return 'Pack';
  return clean ? clean.replace(/\b\w/g, (char) => char.toUpperCase()) : '';
}

function parseVariantSelections(variantText = '') {
  return cleanText(variantText)
    .split(/\s*(?:·|\||;)\s*/)
    .map((part) => {
      const match = part.match(/^([^:]+):\s*(.+)$/);
      if (!match) return null;
      return {
        label: normalizeOptionLabel(match[1]),
        value: cleanText(match[2])
      };
    })
    .filter((item) => item?.label && item.value);
}

function parseCapacityGb(value = '') {
  const matches = [...String(value || '').matchAll(/\b(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/gi)];
  if (!matches.length) return 0;
  return Math.max(
    ...matches.map((match) => {
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === 'tb') return amount * 1024;
      if (unit === 'mb') return amount / 1024;
      return amount;
    })
  );
}

function isPhoneProduct(product = {}) {
  const text = [product.title, product.description, product.shortDescription, product.category].filter(Boolean).join(' ').toLowerCase();
  if (!/\b(?:iphone|galaxy|smartphone|android phone|mobile phone|cell phone|unlocked phone)\b/.test(text)) return false;
  return !/\b(?:case|cover|protector|charger|cable|screen protector|tempered glass|lens protector|bundle)\b/.test(text);
}

function productCapacityValues(product = {}) {
  const values = [];
  const add = (value) => {
    const capacity = parseCapacityGb(value);
    if (capacity > 0) values.push(capacity);
  };

  (product.variants || []).forEach((variant) => {
    if (normalizeOptionLabel(variant.name) === 'Capacity') add(variant.value || variant.label);
  });
  (product.marketplaceDetails?.specs || []).forEach((spec) => {
    const label = normalizeOptionLabel(spec.name);
    if (label === 'Capacity') add(spec.value);
    else if (/gb|tb|mb/i.test(spec.value || '') && /storage|capacity|memory|rom/i.test(spec.name || '')) add(spec.value);
  });
  [product.title, product.description, product.shortDescription].filter(Boolean).forEach((text) => {
    [...String(text).matchAll(/\b\d+(?:\.\d+)?\s*(?:tb|gb|mb)\b/gi)].forEach((match) => add(match[0]));
  });
  if (values.length < 2 && isPhoneProduct(product)) values.push(64, 128, 256);

  return [...new Set(values)].sort((a, b) => a - b).slice(0, 8);
}

function explicitVariantPrice(product = {}, selections = []) {
  for (const selection of selections) {
    const match = (product.variants || []).find((variant) => {
      const label = normalizeOptionLabel(variant.name);
      const value = cleanText(variant.value || variant.label).toLowerCase();
      return label === selection.label && value === selection.value.toLowerCase();
    });
    const price = Number(match?.price ?? match?.storePrice);
    if (Number.isFinite(price) && price > 0) return roundStorePrice(price);
  }
  return 0;
}

function variantPricingForProduct(product = {}, variantText = '') {
  const basePrice = Number(product.price || 0);
  const selections = parseVariantSelections(variantText);
  if (!basePrice || !selections.length) {
    return { price: moneyNumber(basePrice), multiplier: 1, adjusted: false, reasons: [] };
  }

  const explicitPrice = explicitVariantPrice(product, selections);
  if (explicitPrice) {
    return {
      price: explicitPrice,
      multiplier: moneyNumber(explicitPrice / basePrice),
      adjusted: Math.abs(explicitPrice - basePrice) >= 0.01,
      reasons: ['Supplier variant price']
    };
  }

  let multiplier = 1;
  const reasons = [];
  const capacitySelection = selections.find((item) => item.label === 'Capacity');
  const selectedCapacity = parseCapacityGb(capacitySelection?.value || '');
  if (selectedCapacity > 0) {
    const capacities = productCapacityValues(product);
    const baseCapacity = capacities.length ? Math.min(...capacities, selectedCapacity) : selectedCapacity;
    if (baseCapacity > 0 && selectedCapacity > baseCapacity) {
      const premium = Math.min(0.65, Math.log2(selectedCapacity / baseCapacity) * 0.1);
      multiplier += premium;
      reasons.push(`${capacitySelection.value} storage premium`);
    } else if (baseCapacity > 0 && selectedCapacity < baseCapacity) {
      const reduction = Math.min(0.35, Math.log2(baseCapacity / selectedCapacity) * 0.08);
      multiplier -= reduction;
      reasons.push(`${capacitySelection.value} storage adjustment`);
    }
  }

  const colorSelection = selections.find((item) => item.label === 'Color');
  if (colorSelection && /\b(?:rose gold|gold|titanium|natural|ceramic)\b/i.test(colorSelection.value)) {
    multiplier += 0.02;
    reasons.push(`${colorSelection.value} finish premium`);
  }

  const packSelection = selections.find((item) => item.label === 'Pack');
  const packCount = Number((packSelection?.value || '').match(/\b(\d+)\b/)?.[1] || 0);
  if (packCount > 1) {
    multiplier += Math.min(1.5, (packCount - 1) * 0.72);
    reasons.push(`${packCount}-pack quantity pricing`);
  }

  const nextPrice = roundStorePrice(basePrice * multiplier);
  return {
    price: nextPrice,
    multiplier: Math.round(multiplier * 1000) / 1000,
    adjusted: Math.abs(nextPrice - basePrice) >= 0.01,
    reasons
  };
}

module.exports = {
  normalizeOptionLabel,
  parseVariantSelections,
  parseCapacityGb,
  productCapacityValues,
  isPhoneProduct,
  variantPricingForProduct
};
