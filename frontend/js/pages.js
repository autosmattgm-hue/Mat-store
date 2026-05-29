(function () {
  const api = window.MATApi;
  const state = {
    page: document.body.dataset.page || '',
    currency: localStorage.getItem('mat_currency') || 'USD',
    currencies: [],
    products: [],
    categories: [],
    user: null,
    suggestionTimer: null,
    shop: {
      items: [],
      page: 0,
      pages: 1,
      total: 0,
      category: '',
      query: '',
      sort: 'featured',
      minPrice: '',
      maxPrice: '',
      minRating: '',
      inStock: false,
      brand: '',
      trending: false,
      loading: false,
      marketplaceLoading: false,
      marketplaceLoadedQuery: '',
      marketplaceLimit: 50,
      marketplaceSummary: null,
      refreshAfterMarketplace: false,
      autoLoads: 0,
      observer: null
    }
  };

  const SHOP_PAGE_SIZE = 50;
  const SHOP_AUTO_LOADS = 2;
  const SEARCH_MARKETPLACE_STEP = 50;
  const SEARCH_MARKETPLACE_MAX = 160;
  const RECENTLY_VIEWED_KEY = 'mat_recently_viewed_products';
  const CHECKOUT_SHIPPING_OPTIONS = {
    standard: { label: 'MAT Standard', fee: 0, window: '7-14 business days' },
    express: { label: 'MAT Express', fee: 12.95, window: '4-8 business days' },
    priority: { label: 'MAT Priority', fee: 24.95, window: '2-5 business days' },
    concierge: { label: 'MAT Concierge', fee: 39.95, window: 'Priority support window' }
  };
  const paypalCheckout = {
    scriptKey: '',
    rendered: false,
    rendering: false,
    orderId: '',
    localOrder: null,
    fingerprint: ''
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function generatedFallback(product = {}) {
    const query = new URLSearchParams({
      title: product.title || 'MAT STORE Product',
      marketplace: 'MAT STORE',
      code: '',
      category: product.category || 'premium pick'
    });
    return `/api/media/fallback?${query.toString()}`;
  }

  function rawProductImage(product = {}) {
    return product.images?.[0] || product.image || product.fallbackImage || generatedFallback(product);
  }

  function productImage(product = {}) {
    return clearViewImage(product, rawProductImage(product));
  }

  function unproxiedImageUrl(src = '') {
    if (!String(src).startsWith('/api/media/image')) return src;
    try {
      return new URL(src, window.location.origin).searchParams.get('url') || src;
    } catch {
      return src;
    }
  }

  function highQualityImageUrl(value = '') {
    if (!/^https?:\/\//i.test(value)) return value;
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      let path = parsed.pathname;
      if (/(media-amazon|ssl-images-amazon|images-amazon)/i.test(host)) {
        path = path.replace(/\._[^/.]+_\.(jpg|jpeg|png|webp)$/i, '._AC_SL1500_.$1');
        if (/\/images\/I\/[^/._]+\.(jpg|jpeg|png|webp)$/i.test(path)) {
          path = path.replace(/\.(jpg|jpeg|png|webp)$/i, '._AC_SL1500_.$1');
        }
      }
      if (/ebayimg/i.test(host)) {
        path = path.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, '/s-l1600.$1');
      }
      if (/walmartimages/i.test(host)) {
        parsed.searchParams.set('odnHeight', '1600');
        parsed.searchParams.set('odnWidth', '1600');
        parsed.searchParams.set('odnBg', 'FFFFFF');
      }
      if (/(alicdn|aliexpress-media|kwcdn)/i.test(host)) {
        path = path
          .replace(/_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?(?=\.)/gi, '_1200x1200')
          .replace(/\.(jpg|jpeg|png|webp)_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?\.\1_?/gi, '.$1')
          .replace(/\.(jpg|jpeg|png|webp)_(?:\d{2,4})x(?:\d{2,4})(?:q\d+)?\.(webp)_?/gi, '.$1');
      }
      parsed.pathname = path;
      return parsed.toString();
    } catch {
      return value;
    }
  }

  function shouldProxyImageUrl(value = '') {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return /(media-amazon|ssl-images-amazon|images-amazon|alicdn|aliexpress-media|ebayimg|kwcdn|walmartimages|images\.unsplash|plus\.unsplash)/i.test(host);
    } catch {
      return false;
    }
  }

  function clearViewImage(product = {}, src = '') {
    const raw = unproxiedImageUrl(product.supplierImageUrl || src);
    if (!/^https?:\/\//i.test(raw)) return src || rawProductImage(product);
    const highRes = highQualityImageUrl(raw);
    return shouldProxyImageUrl(highRes) ? `/api/media/image?url=${encodeURIComponent(highRes)}` : highRes;
  }

  function fullDescription(product = {}) {
    return String(product.description || product.shortDescription || 'Premium MAT STORE product selected for secure checkout and refined presentation.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortDescription(product = {}) {
    const text = fullDescription(product);
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 24) return text;
    return `${words.slice(0, Math.ceil(words.length / 2)).join(' ')}...`;
  }

  function normalizeOptionLabel(name = '') {
    const clean = String(name || '').replace(/[:：]+$/g, '').trim().toLowerCase();
    if (!clean) return '';
    if (/colour|color|shade/.test(clean)) return 'Color';
    if (/digital storage|storage capacity|\bstorage\b|capacity|memory size|\brom\b|volume/.test(clean)) return 'Capacity';
    if (/shoe size|size|fit/.test(clean)) return 'Size';
    if (/style|model|configuration|edition/.test(clean)) return 'Style';
    if (/material|fabric/.test(clean)) return 'Material';
    if (/finish/.test(clean)) return 'Finish';
    if (/lens/.test(clean)) return 'Lens';
    if (/pattern/.test(clean)) return 'Pattern';
    if (/pack|quantity|count/.test(clean)) return 'Pack';
    if (/scent|fragrance/.test(clean)) return 'Scent';
    return '';
  }

  function optionSlug(value = '') {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);
  }

  function cleanOptionValue(value = '') {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;|&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\bsee more\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[:\-]+|[:\-]+$/g, '')
      .slice(0, 64);
  }

  function uniqueValues(values = []) {
    const seen = new Set();
    const next = [];
    values.forEach((value) => {
      const clean = cleanOptionValue(value);
      const key = clean.toLowerCase();
      if (!clean || key.length < 2 || seen.has(key)) return;
      if (/^(standard|signature|mat store|marketplace|amazon|aliexpress|alibaba|ebay|temu)$/i.test(clean)) return;
      seen.add(key);
      next.push(clean);
    });
    return next.slice(0, 8);
  }

  function isPhoneProduct(product = {}) {
    const text = [product.title, product.description, product.shortDescription, product.category].filter(Boolean).join(' ').toLowerCase();
    if (!/\b(?:iphone|galaxy|smartphone|android phone|mobile phone|cell phone|unlocked phone)\b/.test(text)) return false;
    return !/\b(?:case|cover|protector|charger|cable|screen protector|tempered glass|lens protector|bundle)\b/.test(text);
  }

  function optionValuesFromText(label, text = '') {
    const value = cleanOptionValue(text);
    if (!value) return [];
    if (label === 'Capacity') {
      const capacityText = value.replace(/\b[\d,.]+\s?(?:mb|gb)\s?\/\s?s\b/gi, ' ');
      return uniqueValues(capacityText.match(/\b\d+(?:\.\d+)?\s?(?:tb|gb|mb|ml|l|oz|inch|in|cm|mm)\b/gi) || []);
    }
    if (label === 'Size') {
      return uniqueValues(value.match(/\b(?:xxs|xs|small|medium|large|x-large|xl|xxl|xxxl|us\s?\d{1,2}(?:\.\d)?|eu\s?\d{2})\b/gi) || []);
    }
    if (label === 'Color') {
      const colors = ['rose gold', 'space gray', 'space grey', 'black', 'white', 'silver', 'gold', 'pink', 'blue', 'red', 'green', 'gray', 'grey', 'beige', 'brown', 'purple', 'orange', 'yellow', 'navy', 'clear'];
      const matches = colors.filter((color) => new RegExp(`\\b${color.replace(/\s+/g, '\\s+')}\\b`, 'i').test(value));
      return uniqueValues(matches.filter((color) => !matches.some((other) => other !== color && other.includes(color))));
    }
    return uniqueValues(
      value
        .split(/\s*(?:,|\/|\||;|\bor\b)\s*/i)
        .map((item) => item.trim())
        .filter((item) => item && item.length <= 48)
    );
  }

  function addOption(groupMap, label, values) {
    if (!label) return;
    const cleanValues = uniqueValues(values);
    if (!cleanValues.length) return;
    const existing = groupMap.get(label) || [];
    groupMap.set(label, uniqueValues([...existing, ...cleanValues]));
  }

  function buildProductOptions(product = {}) {
    const details = productDetails(product);
    const groupMap = new Map();
    const metadataLabels = new Set(['Collection', 'Fulfillment', 'Supplier code', 'Deal badge', 'Image override', 'Marketplace']);

    (product.variants || []).forEach((variant) => {
      const label = normalizeOptionLabel(variant.name);
      if (!label || metadataLabels.has(variant.name)) return;
      addOption(groupMap, label, [variant.value || variant.label || '']);
    });

    (details.specs || []).forEach((spec) => {
      const label = normalizeOptionLabel(spec.name);
      if (!label) return;
      const values = optionValuesFromText(label, spec.value);
      addOption(groupMap, label, values.length ? values : [spec.value]);
    });

    const searchableText = [product.title, product.description, product.shortDescription, ...(details.about || []).slice(0, 6)]
      .filter(Boolean)
      .join(' ');
    ['Color', 'Capacity', 'Size'].forEach((label) => addOption(groupMap, label, optionValuesFromText(label, searchableText)));

    if (isPhoneProduct(product)) {
      if ((groupMap.get('Capacity') || []).length < 2) addOption(groupMap, 'Capacity', ['64GB', '128GB', '256GB']);
      if (!(groupMap.get('Color') || []).length) addOption(groupMap, 'Color', ['Black', 'White', 'Red', 'Purple', 'Green']);
    }

    return [...groupMap.entries()]
      .map(([label, values]) => ({ label, values: uniqueValues(values) }))
      .filter((group) => group.values.length)
      .slice(0, 6);
  }

  function colorClass(value = '') {
    const slug = optionSlug(value);
    const allowed = new Set(['black', 'white', 'silver', 'gold', 'rose-gold', 'pink', 'blue', 'red', 'green', 'gray', 'grey', 'beige', 'brown', 'purple', 'orange', 'yellow', 'navy', 'clear', 'space-gray', 'space-grey']);
    return allowed.has(slug) ? ` color-${slug}` : '';
  }

  function renderProductOptions(product = {}) {
    const groups = buildProductOptions(product);
    if (!groups.length) {
      return '<div class="variant-empty"><strong>Standard selection</strong><span>This product is sold in its displayed configuration.</span></div>';
    }
    return `
      <section class="variant-selector" id="productOptions" aria-label="Product options">
        <h2>Choose Options</h2>
        ${groups
          .map(
            (group, groupIndex) => `
              <fieldset class="variant-group" data-option-label="${escapeHtml(group.label)}">
                <legend>${escapeHtml(group.label)}</legend>
                <div class="variant-chip-row">
                  ${group.values
                    .map((value, index) => {
                      const inputId = `productOption_${groupIndex}_${index}`;
                      return `
                        <label class="variant-chip" for="${inputId}">
                          <input id="${inputId}" type="radio" name="productOption_${groupIndex}" value="${escapeHtml(value)}" ${index === 0 ? 'checked' : ''}>
                          ${group.label === 'Color' ? `<span class="color-swatch${colorClass(value)}" aria-hidden="true"></span>` : ''}
                          <span>${escapeHtml(value)}</span>
                        </label>
                      `;
                    })
                    .join('')}
                </div>
              </fieldset>
            `
          )
          .join('')}
      </section>
    `;
  }

  function selectedProductOptions(scopeId = 'productOptions') {
    const root = document.getElementById(scopeId);
    if (!root) return '';
    return [...root.querySelectorAll('.variant-group')]
      .map((group) => {
        const label = group.dataset.optionLabel || '';
        const checked = group.querySelector('input[type="radio"]:checked');
        return checked ? `${label}: ${checked.value}` : '';
      })
      .filter(Boolean)
      .join(' · ');
  }

  function parseVariantSelections(variantText = '') {
    return String(variantText || '')
      .split(/\s*(?:·|\||;)\s*/)
      .map((part) => {
        const match = part.match(/^([^:]+):\s*(.+)$/);
        if (!match) return null;
        return {
          label: normalizeOptionLabel(match[1]) || match[1].trim(),
          value: cleanOptionValue(match[2])
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

  function capacityValuesForProduct(product = {}) {
    const values = [];
    const add = (value) => {
      const parsed = parseCapacityGb(value);
      if (parsed > 0) values.push(parsed);
    };

    buildProductOptions(product)
      .filter((group) => group.label === 'Capacity')
      .flatMap((group) => group.values)
      .forEach(add);
    [product.title, product.description, product.shortDescription].filter(Boolean).forEach((text) => {
      [...String(text).matchAll(/\b\d+(?:\.\d+)?\s*(?:tb|gb|mb)\b/gi)].forEach((match) => add(match[0]));
    });

    return [...new Set(values)].sort((a, b) => a - b).slice(0, 8);
  }

  function roundStorePrice(value) {
    const price = Number(value || 0);
    if (!Number.isFinite(price) || price <= 0) return 0;
    if (price < 10) return Math.round(price * 100) / 100;
    return Math.round(Math.max(0.99, Math.ceil(price) - 0.01) * 100) / 100;
  }

  function explicitVariantPrice(product = {}, selections = []) {
    for (const selection of selections) {
      const match = (product.variants || []).find((variant) => {
        const label = normalizeOptionLabel(variant.name);
        const value = cleanOptionValue(variant.value || variant.label).toLowerCase();
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
    if (!basePrice || !selections.length) return { price: basePrice, multiplier: 1, adjusted: false, reasons: [] };

    const explicitPrice = explicitVariantPrice(product, selections);
    if (explicitPrice) {
      return {
        price: explicitPrice,
        multiplier: Math.round((explicitPrice / basePrice) * 1000) / 1000,
        adjusted: Math.abs(explicitPrice - basePrice) >= 0.01,
        reasons: ['Variant price']
      };
    }

    let multiplier = 1;
    const reasons = [];
    const capacitySelection = selections.find((item) => item.label === 'Capacity');
    const selectedCapacity = parseCapacityGb(capacitySelection?.value || '');
    if (selectedCapacity > 0) {
      const capacities = capacityValuesForProduct(product);
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

    const price = roundStorePrice(basePrice * multiplier);
    return {
      price,
      multiplier: Math.round(multiplier * 1000) / 1000,
      adjusted: Math.abs(price - basePrice) >= 0.01,
      reasons
    };
  }

  function productWithVariantPrice(product = {}, variantText = '') {
    const pricing = variantPricingForProduct(product, variantText);
    const basePrice = Number(product.price || 0);
    const displayCurrency = product.displayCurrency || state.currency;
    const rate = basePrice > 0 ? Number(product.displayPrice || basePrice) / basePrice : 1;
    const displayPrice = Math.round(pricing.price * rate * 100) / 100;
    return {
      ...product,
      price: pricing.price,
      displayPrice,
      formattedPrice: money(displayPrice, displayCurrency),
      selectedVariantPricing: pricing
    };
  }

  function bindProductVariantPricing(product = {}) {
    const root = document.getElementById('productOptions');
    const note = document.getElementById('variantPriceNote');
    const update = () => {
      const selected = selectedProductOptions('productOptions');
      const pricedProduct = productWithVariantPrice(product, selected);
      document.querySelectorAll('[data-variant-price]').forEach((item) => {
        item.textContent = pricedProduct.formattedPrice;
      });
      if (note) {
        note.textContent = pricedProduct.selectedVariantPricing.adjusted
          ? `Updated for ${selected.replace(/\s*·\s*/g, ', ')}`
          : 'Base price for selected configuration';
      }
    };
    root?.addEventListener('change', update);
    update();
  }

  function productFallback(product = {}) {
    return product.fallbackImage || generatedFallback(product);
  }

  function productUrl(product = {}) {
    return `/product.html?id=${encodeURIComponent(product.slug || product.id || '')}`;
  }

  function productDetails(product = {}) {
    const details = product.marketplaceDetails || {};
    const specs = details.specs?.length
      ? details.specs
      : (product.variants || []).map((variant) => ({ name: variant.name, value: variant.value }));
    return {
      brand: details.brand || 'MAT STORE',
      availability: details.availability || (Number(product.stock || 0) > 0 ? 'In stock' : 'Stock pending'),
      seller: 'MAT STORE',
      shipper: 'MAT STORE',
      returns: details.returns || '30-day refund / replacement review',
      payment: details.payment || 'Secure transaction',
      delivery: details.delivery || 'Delivery calculated at checkout',
      shipping: details.shipping || 'Shipping and import charges calculated at checkout',
      boughtInPastMonth: details.boughtInPastMonth || '',
      badge: details.badge || '',
      listPrice: details.listPrice,
      savingsPercent: details.savingsPercent,
      about: details.about?.length ? details.about : product.features || [],
      specs,
      buyingOptions: details.buyingOptions?.length ? details.buyingOptions : ['Add to cart', 'Buy now', 'Secure transaction'],
      videos: details.videos || { count: 0, label: 'Product videos appear when media is available' },
      reviews: details.reviews || { rating: product.rating || 4.8, count: product.reviewsCount || 0, summary: product.shortDescription || '' }
    };
  }

  function renderMarketplaceInsights(product = {}) {
    const details = productDetails(product);
    const listPrice = details.listPrice ? `<span>List ${escapeHtml(money(details.listPrice, product.displayCurrency || state.currency))}</span>` : '';
    const savings = details.savingsPercent ? `<span>${Number(details.savingsPercent).toFixed(0)}% savings</span>` : '';
    return `
      <section class="marketplace-snapshot">
        <nav class="product-jump-nav" aria-label="Product detail sections">
          <a href="#about-item">About this item</a>
          <a href="#product-specs">Product information</a>
          <a href="#product-videos">Videos</a>
          <a href="#product-reviews">Reviews</a>
        </nav>
        <div class="buying-options-panel">
          <div>
            <p class="eyebrow">${escapeHtml(details.badge || 'Buying options')}</p>
            <h3 data-variant-price>${escapeHtml(product.formattedPrice || money(product.displayPrice || product.price))}</h3>
            <div class="deal-strip">${listPrice}${savings}<span>${escapeHtml(details.availability)}</span></div>
          </div>
          <div class="buy-box-grid">
            <span><strong>Delivery</strong>${escapeHtml(details.delivery)}</span>
            <span><strong>Shipping</strong>${escapeHtml(details.shipping)}</span>
            <span><strong>Sold by</strong>MAT STORE</span>
            <span><strong>Returns</strong>${escapeHtml(details.returns)}</span>
            <span><strong>Payment</strong>${escapeHtml(details.payment)}</span>
            ${details.boughtInPastMonth ? `<span><strong>Demand</strong>${escapeHtml(details.boughtInPastMonth)}</span>` : ''}
          </div>
        </div>
        <div class="detail-section" id="about-item">
          <h2>About this item</h2>
          <ul>${(details.about.length ? details.about : product.features || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
        <div class="detail-section" id="product-specs">
          <h2>Product information</h2>
          <dl>${details.specs.map((item) => `<div><dt>${escapeHtml(item.name)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>
        </div>
        <div class="detail-section split-detail" id="product-videos">
          <div><h2>Product videos</h2><p>${escapeHtml(details.videos.label || `${details.videos.count || 0} videos available`)}</p></div>
          <div id="product-reviews"><h2>Reviews</h2><p>${Number(details.reviews.rating || 4.8).toFixed(1)} out of 5 · ${Number(details.reviews.count || 0).toLocaleString()} ratings</p><p>${escapeHtml(details.reviews.summary || '')}</p></div>
        </div>
      </section>
    `;
  }

  function imageAttrs(src, fallback) {
    const nextFallback = fallback || '/assets/icons/favicon.svg';
    return `src="${escapeHtml(src || nextFallback)}" data-fallback-src="${escapeHtml(nextFallback)}"`;
  }

  function searchUrl(query) {
    return `/search.html?q=${encodeURIComponent(String(query || '').trim())}`;
  }

  function searchFallbackImage(query) {
    return generatedFallback({
      title: `MAT STORE ${query}`,
      supplierName: 'MAT STORE',
      category: 'product search'
    });
  }

  function ensurePageSuggestions() {
    const form = document.getElementById('pageSearchForm');
    if (!form) return null;
    form.setAttribute('role', 'search');
    form.style.position = 'relative';
    const input = document.getElementById('pageSearchInput');
    if (input) input.setAttribute('autocomplete', 'off');
    let target = document.getElementById('pageSearchSuggestions');
    if (!target) {
      target = document.createElement('div');
      target.id = 'pageSearchSuggestions';
      target.className = 'suggestions';
      target.setAttribute('role', 'listbox');
      target.hidden = true;
      form.appendChild(target);
    }
    return target;
  }

  function marketplaceSuggestionButtons(query) {
    const clean = escapeHtml(query);
    const allImage = searchFallbackImage(query, 'MAT STORE');
    const allButton = `
      <button class="suggestion-item marketplace-suggestion" type="button" data-search-query="${clean}">
        <img ${imageAttrs(allImage, allImage)} alt="Search MAT STORE network">
        <strong>Search MAT STORE network for "${clean}"<span>Premium products from our private sourcing network</span></strong>
      </button>
    `;
    return allButton;
  }

  async function showPageSuggestions(query) {
    const target = ensurePageSuggestions();
    const cleanQuery = String(query || '').trim();
    if (!target || cleanQuery.length < 2) {
      if (target) {
        target.hidden = true;
        target.innerHTML = '';
      }
      return;
    }

    target.hidden = false;
    target.innerHTML = `
      <div class="suggestion-heading">Choose a search</div>
      ${marketplaceSuggestionButtons(cleanQuery)}
    `;

    try {
      const data = await api.get('/products/suggestions', { q: cleanQuery });
      const localItems = (data.items || []).slice(0, 5);
      if (!localItems.length) return;
      target.innerHTML += `
        <div class="suggestion-heading">MAT STORE products</div>
        ${localItems
          .map(
            (item) => `
              <button class="suggestion-item" type="button" data-suggestion-product="${escapeHtml(item.id)}">
                <img ${imageAttrs(item.image || generatedFallback(item), generatedFallback(item))} alt="${escapeHtml(item.title)}">
                <strong>${escapeHtml(item.title)}<span>${escapeHtml(item.category)}</span></strong>
              </button>
            `
          )
          .join('')}
      `;
    } catch {
      target.hidden = false;
    }
  }

  function bindImageFallbacks() {
    document.addEventListener(
      'error',
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const fallback = image.dataset.fallbackSrc || generatedFallback({ title: image.alt || 'MAT STORE Product' });
        if (!fallback || image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = fallback;
      },
      true
    );
  }

  function toast(message) {
    let region = document.getElementById('toastRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toastRegion';
      region.className = 'toast-region';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      setTimeout(() => item.remove(), 220);
    }, 3200);
  }

  function money(value, currency = state.currency) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2
    }).format(Number(value || 0));
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function productUniqueKey(product = {}) {
    const supplier = String(product.supplierName || '').toLowerCase();
    const title = String(product.title || '')
      .toLowerCase()
      .replace(/^mat\s+/, '')
      .replace(/\b(?:new|renewed|refurbished)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110);
    if (title) return title;
    return `${supplier}:${product.supplierProductCode || product.supplierUrl || product.slug || product.id || title}`;
  }

  function uniqueProducts(products = []) {
    const seen = new Set();
    return products.filter((product) => {
      const key = productUniqueKey(product);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function appendUniqueProducts(existing = [], next = []) {
    const seen = new Set(existing.map(productUniqueKey));
    const merged = [...existing];
    for (const product of next) {
      const key = productUniqueKey(product);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(product);
    }
    return merged;
  }

  async function loadCurrencies() {
    const select = document.getElementById('currencySelect');
    const registerSelect = document.getElementById('accountCurrency');
    if (!select && !registerSelect) return;
    let currencies = ['USD', 'EUR', 'GBP', 'GMD', 'NGN', 'CAD', 'AED'];
    try {
      const data = await api.get('/auth/currencies');
      currencies = data.supported || currencies;
    } catch {
      toast('Currency service is using offline defaults.');
    }
    state.currencies = currencies;
    [select, registerSelect].filter(Boolean).forEach((element) => {
      element.innerHTML = currencies.map((currency) => `<option value="${currency}">${currency}</option>`).join('');
      element.value = currencies.includes(state.currency) ? state.currency : 'USD';
    });
  }

  async function loadMe() {
    if (!localStorage.getItem('mat_access_token')) {
      state.user = api.getUser();
      updateHeaderUser();
      return state.user;
    }
    try {
      const data = await api.get('/auth/me');
      state.user = data.user;
      api.setUser(data.user);
    } catch {
      api.clearTokens();
      state.user = null;
      api.setUser(null);
    }
    updateHeaderUser();
    return state.user;
  }

  function updateHeaderUser() {
    document.querySelectorAll('.admin-only').forEach((item) => {
      item.hidden = state.user?.role !== 'admin';
    });
  }

  function safeReturnTarget(value = '') {
    const target = String(value || '').trim();
    if (!target || !target.startsWith('/') || target.startsWith('//')) return '';
    return target;
  }

  function accountReturnTarget() {
    return safeReturnTarget(params().get('returnTo') || localStorage.getItem('mat_return_after_login') || '');
  }

  function redirectAfterAccountAuth() {
    const target = accountReturnTarget();
    localStorage.removeItem('mat_return_after_login');
    if (!target) return false;
    window.location.href = target;
    return true;
  }

  function requireCheckoutAccount(message = 'Login or register before checkout.') {
    if (state.user?.id) return true;
    const returnTo = state.page === 'payment' ? '/payment.html' : '/checkout.html';
    localStorage.setItem('mat_return_after_login', returnTo);
    toast(message);
    window.location.href = `/account.html?returnTo=${encodeURIComponent(returnTo)}`;
    return false;
  }

  function ensureMobileMenu() {
    const header = document.querySelector('.site-header');
    if (!header) return {};

    let actions = header.querySelector('.nav-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'nav-actions';
      header.appendChild(actions);
    }

    let toggle = document.getElementById('menuToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'icon-button mobile-only';
      toggle.id = 'menuToggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Open menu');
      toggle.setAttribute('aria-controls', 'mobileMenu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span class="hamburger" aria-hidden="true"></span>';
      actions.prepend(toggle);
    }

    let menu = document.getElementById('mobileMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'mobile-menu';
      menu.id = 'mobileMenu';
      menu.hidden = true;
      menu.setAttribute('aria-hidden', 'true');
      menu.innerHTML = `
        <a href="/shop.html">Shop</a>
        <a href="/categories.html">Categories</a>
        <a href="/deals.html">Deals</a>
        <a href="/wishlist.html">Wishlist</a>
        <a href="/account.html">Account</a>
        <a href="/orders.html">Orders</a>
        <a class="admin-only" href="/admin.html" hidden>Admin</a>
      `;
      header.insertAdjacentElement('afterend', menu);
    }

    return { menu, toggle };
  }

  function setMobileMenu(open) {
    const { menu, toggle } = ensureMobileMenu();
    if (!menu || !toggle) return;
    const isOpen = Boolean(open);
    const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    document.documentElement.style.setProperty('--mobile-menu-top', `${Math.max(headerBottom + 8, 72)}px`);
    menu.hidden = !isOpen;
    menu.setAttribute('aria-hidden', String(!isOpen));
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('mobile-menu-open', isOpen);
  }

  function bindMobileMenu() {
    const { menu, toggle } = ensureMobileMenu();
    if (!menu || !toggle) return;
    setMobileMenu(false);
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      setMobileMenu(menu.hidden);
    });
    menu.querySelectorAll('a, button').forEach((item) => {
      item.addEventListener('click', () => setMobileMenu(false));
    });
    document.addEventListener('click', (event) => {
      if (menu.hidden || toggle.contains(event.target) || menu.contains(event.target)) return;
      setMobileMenu(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1040) setMobileMenu(false);
    });
  }

  async function loadProducts(options = {}) {
    const data = await api.get('/products', {
      limit: 1200,
      currency: state.currency,
      ...options
    });
    state.products = data.items || [];
    state.categories = data.categories || [];
    window.MATCart?.setProducts(state.products);
    return data;
  }

  function card(product) {
    const url = productUrl(product);
    return `
      <article class="product-card reveal is-visible">
        <a class="product-media" href="${url}">
          <img ${imageAttrs(productImage(product), productFallback(product))} alt="${escapeHtml(product.title)}" loading="lazy">
          <span class="product-badge">${escapeHtml(product.collection || product.category)}</span>
        </a>
        <div class="product-info">
          <h3><a href="${url}">${escapeHtml(product.title)}</a></h3>
          <div class="price-row">
            <strong>${escapeHtml(product.formattedPrice || money(product.displayPrice || product.price))}</strong>
            <span class="rating">${Number(product.rating || 4.8).toFixed(1)} · ${product.reviewsCount || 0}</span>
          </div>
          <span class="price-note">Fair premium price</span>
          <div class="product-actions">
            <a class="view-link" href="${url}">View</a>
            <button class="add-button" type="button" data-page-add="${product.id}">Add To Cart</button>
          </div>
        </div>
      </article>
    `;
  }

  function recentlyViewedItems() {
    try {
      const items = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  function rememberProductView(product = {}) {
    const snapshot = {
      id: product.id,
      slug: product.slug || product.id,
      title: product.title,
      category: product.category,
      collection: product.collection,
      image: productImage(product),
      fallbackImage: productFallback(product),
      formattedPrice: product.formattedPrice || money(product.displayPrice || product.price),
      displayPrice: product.displayPrice || product.price,
      rating: product.rating,
      reviewsCount: product.reviewsCount
    };
    if (!snapshot.id || !snapshot.title) return;
    const items = recentlyViewedItems().filter((item) => item.id !== snapshot.id);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify([snapshot, ...items].slice(0, 10)));
  }

  function renderRecentlyViewed(currentId) {
    const target = document.getElementById('recentlyViewedGrid');
    if (!target) return;
    const items = recentlyViewedItems().filter((item) => item.id !== currentId).slice(0, 6);
    target.innerHTML = items.length ? items.map(card).join('') : '<div class="empty-state">Products you view will appear here for quick return shopping.</div>';
  }

  function renderProductReviews(product = {}) {
    const target = document.getElementById('productReviews');
    const label = document.getElementById('reviewSummaryLabel');
    const summary = product.reviewSummary || product.marketplaceDetails?.reviews || {};
    const reviews = product.reviews || [];
    if (label) {
      const count = Number(summary.count ?? product.reviewsCount ?? reviews.length ?? 0);
      const rating = Number(summary.rating ?? product.rating ?? 0);
      label.textContent = count ? `${rating.toFixed(1)} from ${count} review${count === 1 ? '' : 's'}` : 'No reviews yet';
    }
    if (!target) return;
    target.innerHTML = reviews.length
      ? reviews
          .map(
            (review) => `
              <article class="review-card customer-review-card">
                <strong>${escapeHtml(review.title || `${review.rating}-star review`)}</strong>
                <span>${Number(review.rating || 0).toFixed(1)} stars${review.verified ? ' · Verified' : ''}</span>
                <p>${escapeHtml(review.comment)}</p>
                <small>${escapeHtml(review.name || 'MAT STORE Customer')} · ${new Date(review.createdAt).toLocaleDateString()}</small>
              </article>
            `
          )
          .join('')
      : '<article class="review-card"><strong>Be the first reviewer</strong><p>Share fit, quality, setup, delivery, or buying advice to help the next customer choose with confidence.</p></article>';
  }

  function bindReviewForm(product = {}) {
    const form = document.getElementById('reviewForm');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    const nameInput = form.querySelector('[name="name"]');
    if (nameInput && state.user?.name) nameInput.value = state.user.name;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const result = await api.post(`/products/${encodeURIComponent(product.id)}/reviews`, payload);
        product.reviews = [result.review, ...(product.reviews || [])].slice(0, 12);
        product.reviewSummary = result.stats;
        product.rating = result.stats?.rating || product.rating;
        product.reviewsCount = result.stats?.count || product.reviewsCount;
        renderProductReviews(product);
        form.reset();
        toast('Review published. Thank you.');
      } catch (error) {
        toast(error.message);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  function ensureShopLoadControls() {
    const grid = document.getElementById('pageProductGrid');
    if (!grid) return {};
    let controls = document.getElementById('shopLoadControls');
    if (!controls) {
      grid.insertAdjacentHTML(
        'afterend',
        `
          <div class="load-more-shell" id="shopLoadControls">
            <div class="load-more-sentinel" id="shopLoadSentinel" aria-hidden="true"></div>
            <button class="button ghost load-more-button" id="shopLoadMoreButton" type="button" hidden>See More</button>
            <p id="shopLoadStatus">Loading products...</p>
          </div>
        `
      );
      document.getElementById('shopLoadMoreButton')?.addEventListener('click', () => handleShopSeeMore());
    }
    return {
      controls,
      sentinel: document.getElementById('shopLoadSentinel'),
      button: document.getElementById('shopLoadMoreButton'),
      status: document.getElementById('shopLoadStatus')
    };
  }

  function renderShopFeed() {
    const grid = document.getElementById('pageProductGrid');
    if (!grid) return;
    grid.innerHTML = state.shop.items.length ? state.shop.items.map(card).join('') : '<div class="empty-state">No matching products yet.</div>';
    state.products = state.shop.items;
    window.MATCart?.setProducts(state.products);

    const count = document.getElementById('resultCount');
    if (count) {
      const loaded = Math.min(state.shop.items.length, state.shop.total);
      count.textContent = state.shop.total ? `${loaded} of ${state.shop.total} products · ${state.currency}` : `0 products · ${state.currency}`;
    }

    const { sentinel, button, status } = ensureShopLoadControls();
    const canLoadMore = state.shop.page < state.shop.pages;
    const marketplaceQuery = marketplaceFeedQuery();
    const canMarketplaceMore = canUseMarketplaceExpansion() &&
      Boolean(marketplaceQuery) &&
      !canLoadMore &&
      !state.shop.marketplaceLoading &&
      state.shop.marketplaceLoadedQuery === marketplaceQuery &&
      state.shop.marketplaceLimit < SEARCH_MARKETPLACE_MAX;
    const useButton = canLoadMore && state.shop.autoLoads >= SHOP_AUTO_LOADS;
    if (sentinel) sentinel.hidden = !canLoadMore || useButton;
    if (button) {
      button.hidden = !(useButton || canMarketplaceMore);
      button.textContent = 'See More';
      button.disabled = state.shop.loading || state.shop.marketplaceLoading;
    }
    if (status) {
      const marketplaceSummary = state.shop.marketplaceSummary;
      status.textContent = state.shop.marketplaceLoading
        ? 'Searching the MAT STORE product network for exact matches...'
        : marketplaceSummary?.imported
          ? `${marketplaceSummary.imported} MAT STORE products added.`
          : state.shop.loading
        ? 'Loading more products...'
        : canLoadMore
          ? useButton
            ? 'More products are ready.'
            : 'Scroll to load more.'
          : canMarketplaceMore
            ? 'See more marketplace results.'
          : 'All products loaded.';
    }
  }

  function canUseMarketplaceExpansion() {
    return ['search', 'shop', 'categories'].includes(state.page);
  }

  function marketplaceFeedQuery() {
    const typedQuery = String(state.shop.query || '').trim();
    if (typedQuery) return typedQuery;
    if (state.shop.trending) return 'trending products';
    const category = String(state.shop.category || '').trim();
    if (!category || category === 'all') return '';
    return category.replace(/[-_]+/g, ' ');
  }

  function marketplaceCategoryOverride() {
    if (String(state.shop.query || '').trim()) return '';
    if (state.shop.trending) return 'trending products';
    return String(state.shop.category || '').trim();
  }

  function currentShopFilterValues() {
    return {
      minPrice: document.getElementById('minPriceInput')?.value.trim() || state.shop.minPrice || '',
      maxPrice: document.getElementById('maxPriceInput')?.value.trim() || state.shop.maxPrice || '',
      minRating: document.getElementById('minRatingSelect')?.value || state.shop.minRating || '',
      inStock: Boolean(document.getElementById('inStockOnly')?.checked || state.shop.inStock),
      brand: document.getElementById('brandFilterInput')?.value.trim() || state.shop.brand || '',
      sort: document.getElementById('sortSelect')?.value || state.shop.sort || 'featured'
    };
  }

  function navigateShop(overrides = {}) {
    const target = state.page === 'categories' ? '/categories.html' : state.page === 'search' ? '/search.html' : '/shop.html';
    const filters = { ...currentShopFilterValues(), ...overrides };
    const search = new URLSearchParams();
    const category = overrides.category !== undefined ? overrides.category : state.shop.category;
    const trending = overrides.trending !== undefined ? overrides.trending : state.shop.trending;
    const query = overrides.query !== undefined ? overrides.query : state.shop.query;
    if (query) search.set('q', query);
    if (trending) search.set('trending', 'true');
    else if (category) search.set('category', category);
    if (filters.sort && filters.sort !== 'featured') search.set('sort', filters.sort);
    if (filters.minPrice) search.set('minPrice', filters.minPrice);
    if (filters.maxPrice) search.set('maxPrice', filters.maxPrice);
    if (filters.minRating) search.set('minRating', filters.minRating);
    if (filters.inStock) search.set('inStock', 'true');
    if (filters.brand) search.set('brand', filters.brand);
    const suffix = search.toString();
    window.location.href = suffix ? `${target}?${suffix}` : target;
  }

  async function enrichMarketplaceSearch(query, options = {}) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery || (!options.force && state.shop.marketplaceLoadedQuery === cleanQuery) || state.shop.marketplaceLoading) return;
    state.shop.marketplaceLoading = true;
    state.shop.marketplaceSummary = null;
    renderShopFeed();
    try {
      const result = await api.get('/marketplace/search', {
        q: cleanQuery,
        currency: state.currency,
        limit: state.shop.marketplaceLimit,
        category: marketplaceCategoryOverride()
      });
      state.shop.marketplaceLoadedQuery = cleanQuery;
      state.shop.marketplaceSummary = {
        imported: Number(result.imported || 0),
        total: Number(result.total || 0),
        sources: result.sources || [],
        errors: result.errors || []
      };
    } catch (error) {
      state.shop.marketplaceLoadedQuery = cleanQuery;
      state.shop.marketplaceSummary = {
        imported: 0,
        total: 0,
        sources: [],
        errors: [{ message: error.message }]
      };
    } finally {
      state.shop.marketplaceLoading = false;
      renderShopFeed();
      if (state.shop.loading) {
        state.shop.refreshAfterMarketplace = true;
        return;
      }
      if (canUseMarketplaceExpansion() && marketplaceFeedQuery() === cleanQuery) {
        await reloadShopFirstPage();
      }
    }
  }

  async function reloadShopFirstPage() {
    if (state.shop.loading) {
      state.shop.refreshAfterMarketplace = true;
      return;
    }
    state.shop.items = [];
    state.shop.page = 0;
    state.shop.pages = 1;
    state.shop.total = 0;
    state.shop.autoLoads = 0;
    await loadShopPage();
  }

  async function handleShopSeeMore() {
    if (state.shop.loading || state.shop.marketplaceLoading) return;
    if (state.shop.page < state.shop.pages) {
      await loadShopPage({ manual: true });
      return;
    }
    const cleanQuery = marketplaceFeedQuery();
    if (!canUseMarketplaceExpansion() || !cleanQuery || state.shop.marketplaceLimit >= SEARCH_MARKETPLACE_MAX) {
      renderShopFeed();
      return;
    }
    state.shop.marketplaceLimit = Math.min(SEARCH_MARKETPLACE_MAX, state.shop.marketplaceLimit + SEARCH_MARKETPLACE_STEP);
    state.shop.marketplaceLoadedQuery = '';
    await enrichMarketplaceSearch(cleanQuery, { force: true });
  }

  async function loadShopPage({ reset = false, manual = false } = {}) {
    if (state.shop.loading) return;
    const grid = document.getElementById('pageProductGrid');
    if (!grid) return;
    if (reset) {
      state.shop.items = [];
      state.shop.page = 0;
      state.shop.pages = 1;
      state.shop.total = 0;
      state.shop.autoLoads = 0;
      state.shop.marketplaceLimit = SEARCH_MARKETPLACE_STEP;
      state.shop.marketplaceLoadedQuery = '';
      grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    }

    if (reset) {
      const feedQuery = marketplaceFeedQuery();
      if (feedQuery) enrichMarketplaceSearch(feedQuery);
    }

    if (!reset && state.shop.page >= state.shop.pages) {
      renderShopFeed();
      return;
    }

    state.shop.loading = true;
    renderShopFeed();
    try {
      const data = await api.get('/products', {
        limit: SHOP_PAGE_SIZE,
        page: state.shop.page + 1,
        currency: state.currency,
        category: state.shop.category,
        q: state.shop.query,
        trending: state.shop.trending ? 'true' : '',
        sort: state.shop.sort,
        minPrice: state.shop.minPrice,
        maxPrice: state.shop.maxPrice,
        minRating: state.shop.minRating,
        inStock: state.shop.inStock ? 'true' : '',
        brand: state.shop.brand
      });
      const incoming = uniqueProducts(data.items || []);
      state.shop.items = reset ? incoming : appendUniqueProducts(state.shop.items, incoming);
      state.shop.page = Number(data.page || state.shop.page + 1);
      state.shop.pages = Number(data.pages || 1);
      state.shop.total = Number(data.total || state.shop.items.length);
      if (manual) state.shop.autoLoads = SHOP_AUTO_LOADS;
    } finally {
      state.shop.loading = false;
      renderShopFeed();
      observeShopFeed();
      if (state.shop.refreshAfterMarketplace) {
        state.shop.refreshAfterMarketplace = false;
        await reloadShopFirstPage();
      }
    }
  }

  function observeShopFeed() {
    const { sentinel } = ensureShopLoadControls();
    if (!sentinel) return;
    if (state.shop.observer) state.shop.observer.disconnect();
    state.shop.observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || state.shop.loading) return;
      if (state.shop.autoLoads >= SHOP_AUTO_LOADS || state.shop.page >= state.shop.pages) return;
      state.shop.autoLoads += 1;
      loadShopPage();
    }, { rootMargin: '520px 0px' });
    state.shop.observer.observe(sentinel);
  }

  function bindGlobal() {
    bindMobileMenu();

    document.getElementById('supportRequestForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      toast('Support request captured locally. Connect email transport for production.');
      event.currentTarget.reset();
    });

    document.getElementById('pageSearchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = document.getElementById('pageSearchInput')?.value.trim();
      document.getElementById('pageSearchSuggestions')?.setAttribute('hidden', '');
      if (query) window.location.href = searchUrl(query);
    });

    document.getElementById('pageSearchInput')?.addEventListener('input', (event) => {
      clearTimeout(state.suggestionTimer);
      const value = event.target.value;
      state.suggestionTimer = setTimeout(() => showPageSuggestions(value), 120);
    });

    document.getElementById('currencySelect')?.addEventListener('change', (event) => {
      state.currency = event.target.value;
      localStorage.setItem('mat_currency', state.currency);
      window.location.reload();
    });

    document.addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-page-add]');
      const suggestionButton = event.target.closest('[data-suggestion-product]');
      const searchButton = event.target.closest('[data-search-query]');
      if (addButton) {
        const product = state.products.find((item) => item.id === addButton.dataset.pageAdd);
        const selectedVariant = addButton.dataset.variantScope ? selectedProductOptions(addButton.dataset.variantScope) : addButton.dataset.variant || '';
        if (product) {
          window.MATCart?.add(product, 1, selectedVariant);
          if (addButton.dataset.buyNow === 'true') {
            if (requireCheckoutAccount('Login or register before buying.')) window.location.href = '/checkout.html';
          }
        }
      }
      if (suggestionButton) {
        document.getElementById('pageSearchSuggestions')?.setAttribute('hidden', '');
        window.location.href = `/product.html?id=${encodeURIComponent(suggestionButton.dataset.suggestionProduct)}`;
      }
      if (searchButton) {
        document.getElementById('pageSearchSuggestions')?.setAttribute('hidden', '');
        window.location.href = searchUrl(searchButton.dataset.searchQuery);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.getElementById('pageSearchSuggestions')?.setAttribute('hidden', '');
      }
    });
  }

  async function initShopLike() {
    const urlParams = params();
    const selectedCategory = urlParams.get('category') || 'all';
    const query = urlParams.get('q') || '';
    const wantsTrending = ['true', '1', 'yes'].includes(String(urlParams.get('trending') || '').toLowerCase()) || selectedCategory === 'trending products';
    state.shop.trending = wantsTrending;
    state.shop.category = selectedCategory === 'all' || wantsTrending ? '' : selectedCategory;
    state.shop.query = query;
    state.shop.sort = urlParams.get('sort') || document.getElementById('sortSelect')?.value || 'featured';
    state.shop.minPrice = urlParams.get('minPrice') || '';
    state.shop.maxPrice = urlParams.get('maxPrice') || '';
    state.shop.minRating = urlParams.get('minRating') || '';
    state.shop.inStock = ['true', '1', 'yes'].includes(String(urlParams.get('inStock') || '').toLowerCase());
    state.shop.brand = urlParams.get('brand') || '';

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.value = state.shop.sort;
    const minPriceInput = document.getElementById('minPriceInput');
    const maxPriceInput = document.getElementById('maxPriceInput');
    const minRatingSelect = document.getElementById('minRatingSelect');
    const inStockOnly = document.getElementById('inStockOnly');
    const brandFilterInput = document.getElementById('brandFilterInput');
    if (minPriceInput) minPriceInput.value = state.shop.minPrice;
    if (maxPriceInput) maxPriceInput.value = state.shop.maxPrice;
    if (minRatingSelect) minRatingSelect.value = state.shop.minRating;
    if (inStockOnly) inStockOnly.checked = state.shop.inStock;
    if (brandFilterInput) brandFilterInput.value = state.shop.brand;

    const title = document.getElementById('resultTitle');
    if (title) title.textContent = query ? `Search results for "${query}"` : wantsTrending ? 'Trending Products' : selectedCategory === 'all' ? 'All Products' : `${selectedCategory} Edit`;

    const filters = document.getElementById('pageCategoryFilters');
    if (filters) {
      if (!state.categories.length) {
        const categoryData = await api.get('/products', { limit: 1, currency: state.currency });
        state.categories = categoryData.categories || [];
      }
      const categories = ['trending products', 'all', ...state.categories.filter((category) => category !== 'trending products')];
      filters.innerHTML = categories
        .map((category) => {
          const active = category === 'trending products' ? wantsTrending : !wantsTrending && category === selectedCategory;
          return `<button type="button" class="${active ? 'active' : ''}" data-page-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`;
        })
        .join('');
    }

    await loadShopPage({ reset: true });

    if (sortSelect && sortSelect.dataset.bound !== 'true') {
      sortSelect.dataset.bound = 'true';
      sortSelect.addEventListener('change', () => navigateShop());
    }
    document.getElementById('applyFiltersButton')?.addEventListener('click', () => navigateShop());
    document.getElementById('clearFiltersButton')?.addEventListener('click', () => navigateShop({
      minPrice: '',
      maxPrice: '',
      minRating: '',
      inStock: false,
      brand: '',
      sort: 'featured'
    }));
    document.querySelectorAll('[data-page-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.pageCategory;
        if (category === 'trending products') navigateShop({ trending: true, category: '' });
        else navigateShop({ trending: false, category: category === 'all' ? '' : category });
      });
    });
  }

  async function initCategories() {
    await loadProducts();
    const target = document.getElementById('categoryTiles');
    const images = {
      electronics: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1000&q=82',
      accessories: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1000&q=82',
      fashion: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1000&q=82',
      beauty: 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=1000&q=82',
      shoes: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1000&q=82'
    };
    if (target) {
      target.innerHTML = state.categories
        .map((category) => {
          const count = state.products.filter((product) => product.category === category).length;
          return `
            <a class="category-tile" href="/shop.html?category=${encodeURIComponent(category)}" style="--tile-image:url('${images[category] || images.fashion}')">
              <p class="eyebrow">${count} pieces</p>
              <h2>${escapeHtml(category)}</h2>
              <p>AI-curated MAT STORE selections for high-intent shopping.</p>
            </a>
          `;
        })
        .join('');
    }
    await initShopLike();
  }

  async function initProduct() {
    const id = params().get('id') || params().get('slug') || 'noir-halo-wireless-headphones';
    const data = await api.get(`/products/${encodeURIComponent(id)}`, { currency: state.currency });
    const product = data.product;
    state.products = [product, ...(product.related || [])];
    window.MATCart?.setProducts(state.products);
    document.title = `${product.seo?.title || product.title} | MAT STORE`;

    const target = document.getElementById('productDetail');
    const images = product.images?.length ? product.images : [productImage(product)];
    const fallback = productFallback(product);
    const details = productDetails(product);
    target.innerHTML = `
      <div>
        <div class="detail-gallery">
          <div class="gallery-kicker"><span>Click thumbnails to see full view</span><span>${Number(details.videos.count || 0)} videos</span></div>
          <div class="detail-gallery-main"><img id="detailMainImage" ${imageAttrs(clearViewImage(product, images[0]), fallback)} alt="${escapeHtml(product.title)}"></div>
          <div class="modal-thumbs">
            ${images.map((image) => `<button type="button" data-detail-thumb="${escapeHtml(clearViewImage(product, image))}"><img ${imageAttrs(image, fallback)} alt="${escapeHtml(product.title)} thumbnail"></button>`).join('')}
          </div>
        </div>
        <div class="detail-copy">
          <h2>AI-polished product story</h2>
          <p class="view-description product-full-description">${escapeHtml(fullDescription(product))}</p>
          <ul class="feature-list">${(product.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
          ${renderMarketplaceInsights(product)}
        </div>
      </div>
      <aside class="purchase-panel">
        <p class="eyebrow">${escapeHtml(product.category)} · ${escapeHtml(product.collection)}</p>
        <h1>${escapeHtml(product.title)}</h1>
        <div class="price-row"><strong data-variant-price>${escapeHtml(product.formattedPrice)}</strong><span class="rating">${Number(product.rating || 4.8).toFixed(1)} · ${product.reviewsCount || 0} reviews</span></div>
        <span class="variant-price-note" id="variantPriceNote">Base price for selected configuration</span>
        <p class="view-description purchase-summary">${escapeHtml(shortDescription(product))}</p>
        ${renderProductOptions(product)}
        <button class="button primary full" type="button" data-page-add="${product.id}" data-variant-scope="productOptions">Add To Cart</button>
        <button class="button ghost full" type="button" data-page-add="${product.id}" data-variant-scope="productOptions" data-buy-now="true">Buy Now</button>
        <button class="button ghost full" type="button" id="productWishlistButton">Save To Wishlist</button>
      </aside>
    `;

    const related = document.getElementById('relatedGrid');
    if (related) related.innerHTML = (product.related || []).map(card).join('');
    rememberProductView(product);
    renderProductReviews(product);
    bindReviewForm(product);
    renderRecentlyViewed(product.id);

    document.querySelectorAll('[data-detail-thumb]').forEach((button) => {
      button.addEventListener('click', () => {
        document.getElementById('detailMainImage').src = button.dataset.detailThumb;
      });
    });

    bindProductVariantPricing(product);

    document.getElementById('productWishlistButton')?.addEventListener('click', async () => {
      if (!state.user) {
        toast('Login to save wishlist products.');
        window.location.href = '/account.html';
        return;
      }
      const result = await api.post(`/auth/wishlist/${product.id}`, {});
      state.user = result.user;
      api.setUser(result.user);
      toast('Wishlist updated.');
    });
  }

  function renderCartPage() {
    const items = window.MATCart?.items() || [];
    const list = document.getElementById('cartPageItems');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Your cart is empty. Add a premium find from the shop.</div>';
    } else {
      list.innerHTML = items
        .map((item) => {
          const product = item.snapshot || {};
          return `
            <article class="line-item">
              <img ${imageAttrs(product.image || product.fallbackImage || generatedFallback(product), product.fallbackImage || generatedFallback(product))} alt="${escapeHtml(product.title || 'Product')}">
              <div>
                <h2>${escapeHtml(product.title || 'MAT STORE Product')}</h2>
                <p>${money(product.displayPrice || 0)} · Qty ${item.quantity}${item.variant ? ` · ${escapeHtml(item.variant)}` : ''}</p>
              </div>
              <div class="row-actions">
                <button type="button" data-page-minus="${item.productId}" data-variant="${escapeHtml(item.variant)}">-</button>
                <button type="button" data-page-plus="${item.productId}" data-variant="${escapeHtml(item.variant)}">+</button>
                <button type="button" data-page-remove="${item.productId}" data-variant="${escapeHtml(item.variant)}">Remove</button>
              </div>
            </article>
          `;
        })
        .join('');
    }
    renderSummary();
  }

  function checkoutPromoRate() {
    const code = String(document.querySelector('#checkoutPageForm [name="promoCode"]')?.value || '').trim().toUpperCase();
    if (code === 'MAT10') return 0.1;
    if (code === 'VIP15') return 0.15;
    return 0;
  }

  function selectedCheckoutShipping() {
    const selected = document.querySelector('#checkoutPageForm input[name="shippingMethod"]:checked')?.value || 'standard';
    return CHECKOUT_SHIPPING_OPTIONS[selected] || CHECKOUT_SHIPPING_OPTIONS.standard;
  }

  function checkoutEstimatedTotals() {
    const items = window.MATCart?.items ? window.MATCart.items() : [];
    const subtotal = items.reduce((sum, item) => sum + Number(item.snapshot?.displayPrice || 0) * Number(item.quantity || 0), 0);
    const baseShipping = subtotal > 150 || subtotal === 0 ? 0 : 9.95;
    const shipping = baseShipping + selectedCheckoutShipping().fee;
    const tax = subtotal * 0.07;
    const discount = subtotal * checkoutPromoRate();
    return {
      subtotal,
      shipping,
      tax,
      discount,
      total: Math.max(0, subtotal + shipping + tax - discount)
    };
  }

  function renderSummary() {
    const summary = document.getElementById('pageSummary');
    if (!summary || !window.MATCart) return;
    const isCheckout = state.page === 'checkout';
    const totals = isCheckout ? checkoutEstimatedTotals() : window.MATCart.totals();
    const items = window.MATCart.items ? window.MATCart.items() : [];
    const shipping = isCheckout ? selectedCheckoutShipping() : null;
    summary.innerHTML = `
      <h2>Order Summary</h2>
      ${
        isCheckout
          ? `<div class="checkout-review-list">${
              items.length
                ? items
                    .map((item) => {
                      const product = item.snapshot || {};
                      return `
                        <article class="checkout-review-item">
                          <img src="${product.image || '/assets/icons/favicon.svg'}" alt="${escapeHtml(product.title || 'Product')}">
                          <div>
                            <strong>${escapeHtml(product.title || 'MAT STORE Product')}</strong>
                            <span>${item.quantity} x ${money(product.displayPrice || 0)}${item.variant ? ` · ${escapeHtml(item.variant)}` : ''}</span>
                          </div>
                        </article>
                      `;
                    })
                    .join('')
                : '<div class="empty-state">Your cart is empty.</div>'
            }</div>
            <div class="checkout-delivery-note">
              <strong>${escapeHtml(shipping.label)}</strong>
              <span>${escapeHtml(shipping.window)}</span>
            </div>`
          : ''
      }
      <div class="cart-totals">
        <div><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
        <div><span>Shipping</span><strong>${totals.shipping ? money(totals.shipping) : 'Included'}</strong></div>
        <div><span>Tax</span><strong>${money(totals.tax)}</strong></div>
        <div><span>Discount</span><strong>${totals.discount ? `-${money(totals.discount)}` : 'None'}</strong></div>
        <div><span>Total</span><strong>${money(totals.total)}</strong></div>
      </div>
      ${isCheckout ? '<div class="checkout-trust-row"><span>Encrypted</span><span>Protected</span><span>Support ready</span></div>' : '<a class="button primary full" href="/checkout.html">Secure Checkout</a>'}
      <a class="button ghost full" href="/shop.html">Continue Shopping</a>
    `;
  }

  async function initCartPage() {
    await loadProducts();
    renderCartPage();
    document.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-page-remove]');
      const plus = event.target.closest('[data-page-plus]');
      const minus = event.target.closest('[data-page-minus]');
      const item = [...(window.MATCart?.items() || [])].find((entry) => entry.productId === (remove?.dataset.pageRemove || plus?.dataset.pagePlus || minus?.dataset.pageMinus));
      if (remove) window.MATCart.remove(remove.dataset.pageRemove, remove.dataset.variant || '');
      if (plus && item) window.MATCart.updateQuantity(item.productId, item.variant, item.quantity + 1);
      if (minus && item) window.MATCart.updateQuantity(item.productId, item.variant, item.quantity - 1);
      if (remove || plus || minus) renderCartPage();
    });
  }

  function checkoutCartItems() {
    return window.MATCart?.items() || [];
  }

  function checkoutPayload(form, paymentMethod) {
    const data = Object.fromEntries(new FormData(form).entries());
    const billingSameAsShipping = data.billingSameAsShipping === 'on';
    const shippingAddress = {
      name: data.name,
      line1: data.line1,
      line2: data.line2,
      city: data.city,
      region: data.region,
      postalCode: data.postalCode,
      country: String(data.country || 'US').slice(0, 2).toUpperCase()
    };
    return {
      sessionId: api.getSessionId(),
      currency: state.currency,
      paymentMethod: 'paypal',
      promoCode: data.promoCode,
      shippingMethod: data.shippingMethod || 'standard',
      termsAccepted: data.termsAccepted === 'on',
      marketingOptIn: data.marketingOptIn === 'on',
      notes: data.notes,
      customer: { name: data.name, email: data.email, phone: data.phone },
      shippingAddress,
      billingSameAsShipping,
      billingAddress: billingSameAsShipping
        ? shippingAddress
        : {
            name: data.billingName || data.name,
            line1: data.billingLine1,
            line2: data.billingLine2,
            city: data.billingCity,
            region: data.billingRegion,
            postalCode: data.billingPostalCode,
            country: String(data.billingCountry || data.country || 'US').slice(0, 2).toUpperCase()
          },
      checkoutMeta: {
        savedAt: new Date().toISOString(),
        shipping: selectedCheckoutShipping(),
        estimatedTotals: checkoutEstimatedTotals()
      },
      items: checkoutCartItems().map((item) => ({ productId: item.productId, quantity: item.quantity, variant: item.variant }))
    };
  }

  function checkoutFingerprint(payload) {
    return JSON.stringify({
      currency: payload.currency,
      promoCode: payload.promoCode || '',
      shippingMethod: payload.shippingMethod || 'standard',
      customer: payload.customer,
      shippingAddress: payload.shippingAddress,
      billingSameAsShipping: payload.billingSameAsShipping,
      billingAddress: payload.billingAddress,
      items: payload.items
    });
  }

  function validateCheckoutForm(form) {
    if (!requireCheckoutAccount('Login or register to place an order. You can still browse products without an account.')) {
      return false;
    }
    if (!checkoutCartItems().length) {
      toast('Your cart is empty.');
      return false;
    }
    if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) return false;
    return true;
  }

  function clearCheckoutCart(items = checkoutCartItems()) {
    items.forEach((item) => window.MATCart?.remove(item.productId, item.variant));
  }

  function resetPayPalCheckoutSession() {
    paypalCheckout.orderId = '';
    paypalCheckout.localOrder = null;
    paypalCheckout.fingerprint = '';
  }

  function setPayPalStatus(message, tone = '') {
    const status = document.getElementById('paypal-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function payPalSdkUrl(config) {
    const params = new URLSearchParams({
      'client-id': config.clientId,
      currency: config.currency || 'USD',
      components: config.components || 'buttons,card-fields',
      intent: config.intent || 'capture'
    });
    if (config.buyerCountry) params.set('buyer-country', config.buyerCountry);
    if (config.enableFunding) params.set('enable-funding', config.enableFunding);
    return `https://www.paypal.com/sdk/js?${params.toString()}`;
  }

  function loadPayPalSdk(config) {
    const key = `${config.clientId}:${config.currency}:${config.components}:${config.intent}:${config.buyerCountry || ''}:${config.enableFunding || ''}`;
    if (window.paypal && paypalCheckout.scriptKey === key) return Promise.resolve();

    document.querySelectorAll('script[data-paypal-sdk]').forEach((script) => script.remove());
    paypalCheckout.scriptKey = key;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = payPalSdkUrl(config);
      script.async = true;
      script.dataset.paypalSdk = 'true';
      script.dataset.key = key;
      script.dataset.sdkIntegrationSource = 'mat-store-expanded-checkout';
      script.addEventListener('load', () => (window.paypal ? resolve() : reject(new Error('PayPal SDK did not load.'))), { once: true });
      script.addEventListener('error', () => reject(new Error('PayPal SDK could not be loaded.')), { once: true });
      document.head.appendChild(script);
    });
  }

  async function createPayPalSdkOrder(form) {
    if (!validateCheckoutForm(form)) throw new Error('Complete checkout details before paying.');
    const payload = checkoutPayload(form, 'paypal');
    return createPayPalOrderFromPayload(payload);
  }

  async function createPayPalOrderFromPayload(payload) {
    if (!requireCheckoutAccount('Login or register before making a payment.')) {
      throw new Error('Login required before payment.');
    }
    const fingerprint = checkoutFingerprint(payload);
    if (paypalCheckout.orderId && paypalCheckout.fingerprint === fingerprint) return paypalCheckout.orderId;

    setPayPalStatus('Creating secure PayPal order...', 'loading');
    const result = await api.post('/orders/paypal/create', payload);
    paypalCheckout.orderId = result.payment?.orderId || '';
    paypalCheckout.localOrder = result.order || null;
    paypalCheckout.fingerprint = fingerprint;
    if (!paypalCheckout.orderId) throw new Error('PayPal did not return an order id.');
    setPayPalStatus(`PayPal order ready: ${result.payment.currency} ${Number(result.payment.amount || 0).toFixed(2)}`, 'success');
    return paypalCheckout.orderId;
  }

  function cardBillingAddress() {
    const payload = activePaymentPayload('paypal') || storedCheckoutPayload() || {};
    const fallback = payload.billingAddress || payload.shippingAddress || {};
    const value = (id, fallbackValue = '') => {
      const input = document.getElementById(id);
      return String(input?.value || fallbackValue || '').trim();
    };
    return {
      addressLine1: value('card-billing-address-line-1', fallback.line1),
      addressLine2: value('card-billing-address-line-2', fallback.line2),
      adminArea1: value('card-billing-address-admin-area-line-1', fallback.region),
      adminArea2: value('card-billing-address-admin-area-line-2', fallback.city),
      countryCode: value('card-billing-address-country-code', fallback.country || 'US').toUpperCase().slice(0, 2),
      postalCode: value('card-billing-address-postal-code', fallback.postalCode)
    };
  }

  function hydrateCardBillingFields(payload = {}) {
    const billing = payload.billingAddress || payload.shippingAddress || {};
    const values = {
      'card-billing-address-line-1': billing.line1,
      'card-billing-address-line-2': billing.line2,
      'card-billing-address-admin-area-line-1': billing.region,
      'card-billing-address-admin-area-line-2': billing.city,
      'card-billing-address-country-code': billing.country || 'US',
      'card-billing-address-postal-code': billing.postalCode
    };
    Object.entries(values).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input && !input.value) input.value = String(value || '');
    });
  }

  function paypalCaptureProblem(details = {}) {
    const transaction =
      details?.purchase_units?.[0]?.payments?.captures?.[0] ||
      details?.purchase_units?.[0]?.payments?.authorizations?.[0] ||
      null;
    const errorDetail = details?.details?.[0] || null;
    if (errorDetail) return { restart: errorDetail.issue === 'INSTRUMENT_DECLINED', message: `${errorDetail.issue || 'PAYPAL_ERROR'} ${errorDetail.description || ''}`.trim() };
    if (!transaction) return { restart: false, message: 'PayPal did not return a completed transaction.' };
    if (transaction.status === 'DECLINED') return { restart: false, message: `Transaction DECLINED: ${transaction.id || ''}`.trim() };
    return null;
  }

  async function capturePayPalSdkOrder(data, actions) {
    try {
      setPayPalStatus('Capturing PayPal payment...', 'loading');
      const result = await api.post('/orders/paypal/capture', {
        orderID: data.orderID,
        localOrderId: paypalCheckout.localOrder?.id || ''
      });
      const details = result.payment?.details || {};
      const problem = paypalCaptureProblem(details);
      if (problem?.restart && actions?.restart) {
        setPayPalStatus('Payment method was declined. Restarting PayPal so you can choose another method...', 'warning');
        return actions.restart();
      }
      if (problem) throw new Error(problem.message);

      const order = result.order || result.payment?.order || paypalCheckout.localOrder;
      localStorage.removeItem('mat_checkout_payload');
      clearCheckoutCart();
      resetPayPalCheckoutSession();
      setPayPalStatus('Payment complete. Preparing your order page...', 'success');
      window.location.href = `/orders.html?created=${encodeURIComponent(order?.orderNumber || '')}`;
    } catch (error) {
      setPayPalStatus(error.message || 'Sorry, your transaction could not be processed.', 'error');
      toast(error.message || 'Sorry, your transaction could not be processed.');
      throw error;
    }
  }

  async function renderPayPalCheckout(form) {
    if (paypalCheckout.rendered || paypalCheckout.rendering) return;
    paypalCheckout.rendering = true;
    try {
      setPayPalStatus('Loading PayPal secure checkout...', 'loading');
      const config = await api.get('/orders/paypal/config', { currency: state.currency });
      const note = document.getElementById('paypalCurrencyNote');
      if (note) {
        note.textContent = config.currency !== config.requestedCurrency ? `PayPal settles in ${config.currency}` : `${config.currency} secure payment`;
      }
      if (!config.enabled || !config.clientId) {
        const missing = config.diagnostics?.missing?.length ? config.diagnostics.missing.join(' and ') : 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET';
        setPayPalStatus(`PayPal is not configured on the server. Add ${missing} in Vercel Environment Variables, then redeploy.`, 'error');
        return;
      }

      await loadPayPalSdk(config);
      const buttonContainer = document.getElementById('paypal-button-container');
      if (buttonContainer) buttonContainer.innerHTML = '';
      ['card-name-field-container', 'card-number-field-container', 'card-expiry-field-container', 'card-cvv-field-container'].forEach((id) => {
        const container = document.getElementById(id);
        if (container) container.innerHTML = '';
      });

      window.paypal.Buttons({
        style: {
          layout: 'vertical',
          color: 'gold',
          shape: 'rect',
          label: 'paypal',
          borderRadius: 8
        },
        onClick(_data, actions) {
          if (!validateCheckoutForm(form)) return actions.reject();
          return actions.resolve();
        },
        createOrder() {
          return createPayPalSdkOrder(form);
        },
        onApprove(data, actions) {
          return capturePayPalSdkOrder(data, actions);
        },
        onCancel() {
          setPayPalStatus('PayPal checkout was cancelled. Your cart is still here.', 'warning');
        },
        onError(error) {
          setPayPalStatus(error?.message || 'PayPal checkout could not be completed.', 'error');
          toast(error?.message || 'PayPal checkout could not be completed.');
        }
      }).render('#paypal-button-container');

      const cardShell = document.getElementById('paypal-card-fields');
      const cardSubmit = document.getElementById('paypal-card-submit');
      if (window.paypal.CardFields && cardShell && cardSubmit) {
        const cardFields = window.paypal.CardFields({
          style: {
            input: {
              color: '#16130f',
              'font-size': '16px',
              'font-family': 'Inter, sans-serif',
              'font-weight': '600'
            },
            '.invalid': { color: '#b64235' }
          },
          createOrder() {
            return createPayPalSdkOrder(form);
          },
          onApprove(data, actions) {
            return capturePayPalSdkOrder(data, actions);
          },
          onError(error) {
            setPayPalStatus(error?.message || 'Card payment could not be completed.', 'error');
            toast(error?.message || 'Card payment could not be completed.');
          },
          onCancel() {
            setPayPalStatus('Card verification was cancelled.', 'warning');
          },
          inputEvents: {
            onChange(data) {
              cardSubmit.disabled = !data.isFormValid;
            }
          }
        });

        if (cardFields.isEligible()) {
          cardShell.hidden = false;
          cardFields.NameField({ placeholder: 'Full name on card' }).render('#card-name-field-container');
          cardFields.NumberField({ placeholder: 'Card number' }).render('#card-number-field-container');
          cardFields.ExpiryField({ placeholder: 'MM/YY' }).render('#card-expiry-field-container');
          cardFields.CVVField({ placeholder: 'CVV' }).render('#card-cvv-field-container');
          cardSubmit.addEventListener('click', async () => {
            if (!validateCheckoutForm(form)) return;
            const fieldState = await cardFields.getState();
            if (!fieldState.isFormValid) {
              setPayPalStatus('Check your card details before paying.', 'error');
              return;
            }
            cardSubmit.disabled = true;
            try {
              await cardFields.submit({ billingAddress: cardBillingAddress() });
            } catch (error) {
              setPayPalStatus(error?.message || 'Card payment could not be submitted.', 'error');
            } finally {
              cardSubmit.disabled = false;
            }
          });
        }
      }

      paypalCheckout.rendered = true;
      setPayPalStatus('Choose PayPal wallet or enter card details below.', 'success');
    } catch (error) {
      setPayPalStatus(error.message, 'error');
      toast(error.message);
    } finally {
      paypalCheckout.rendering = false;
    }
  }

  function bindPayPalCheckout(form) {
    const panel = document.getElementById('paypalCheckoutPanel');
    const submit = document.getElementById('checkoutSubmitButton');
    if (!form || !panel || !submit) return;

    const refreshPaymentUi = () => {
      const selected = form.querySelector('input[name="paymentMethod"]:checked')?.value || 'paypal';
      const isPayPal = selected === 'paypal';
      panel.hidden = !isPayPal;
      submit.classList.toggle('is-hidden', isPayPal);
      submit.disabled = false;
      if (isPayPal) renderPayPalCheckout(form);
    };

    form.querySelectorAll('input[name="paymentMethod"]').forEach((input) => input.addEventListener('change', refreshPaymentUi));
    form.addEventListener('input', (event) => {
      if (!event.target.matches('input[name="paymentMethod"]')) resetPayPalCheckoutSession();
    });
    window.addEventListener('mat:cart-updated', resetPayPalCheckoutSession);
    refreshPaymentUi();
  }

  function bindCheckoutEnhancements(form) {
    if (!form) return;
    const billingToggle = document.getElementById('billingSameAsShipping');
    const billingPanel = document.getElementById('billingAddressPanel');

    const syncBilling = () => {
      const same = billingToggle ? billingToggle.checked : true;
      if (billingPanel) billingPanel.hidden = same;
      billingPanel?.querySelectorAll('input').forEach((input) => {
        const requiredNames = new Set(['billingName', 'billingCountry', 'billingLine1', 'billingCity', 'billingRegion', 'billingPostalCode']);
        input.required = !same && requiredNames.has(input.name);
      });
    };

    const syncSummary = () => {
      renderSummary();
      resetPayPalCheckoutSession();
    };

    billingToggle?.addEventListener('change', syncBilling);
    form.querySelectorAll('input[name="shippingMethod"]').forEach((input) => input.addEventListener('change', syncSummary));
    form.querySelector('[name="promoCode"]')?.addEventListener('input', renderSummary);
    form.querySelector('[name="country"]')?.addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().slice(0, 2);
    });
    form.querySelector('[name="billingCountry"]')?.addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().slice(0, 2);
    });
    syncBilling();
    renderSummary();
  }

  async function initCheckout() {
    if (!requireCheckoutAccount('Login or register before checkout.')) return;
    await loadProducts();
    renderSummary();
    const form = document.getElementById('checkoutPageForm');
    bindCheckoutEnhancements(form);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateCheckoutForm(form)) return;
      const payload = checkoutPayload(form, 'paypal');
      localStorage.setItem('mat_checkout_payload', JSON.stringify(payload));
      resetPayPalCheckoutSession();
      window.location.href = '/payment.html';
    });
  }

  function storedCheckoutPayload() {
    try {
      return JSON.parse(localStorage.getItem('mat_checkout_payload') || 'null');
    } catch {
      return null;
    }
  }

  function saveCheckoutPayload(payload) {
    localStorage.setItem('mat_checkout_payload', JSON.stringify(payload));
  }

  function activePaymentPayload(method) {
    const payload = storedCheckoutPayload();
    if (!payload) return null;
    return {
      ...payload,
      currency: payload.currency || state.currency,
      paymentMethod: 'paypal'
    };
  }

  function paymentLineItems(payload) {
    const cartItems = window.MATCart?.items ? window.MATCart.items() : [];
    return (payload?.items || []).map((item) => {
      const cartItem = cartItems.find((entry) => entry.productId === item.productId && entry.variant === item.variant);
      const product = state.products.find((entry) => entry.id === item.productId);
      return {
        ...item,
        snapshot: cartItem?.snapshot || {
          title: product?.title || 'MAT STORE Product',
          image: productImage(product || {}),
          displayPrice: product?.displayPrice || product?.price || 0
        }
      };
    });
  }

  function renderPaymentSummary(payload) {
    const summary = document.getElementById('paymentSummary');
    if (!summary) return;
    if (!payload) {
      summary.innerHTML = `
        <h2>Order Summary</h2>
        <div class="empty-state">Checkout details were not found.</div>
        <a class="button primary full" href="/checkout.html">Return to Checkout</a>
      `;
      return;
    }

    const totals = payload.checkoutMeta?.estimatedTotals || checkoutEstimatedTotals();
    const shipping = payload.checkoutMeta?.shipping || CHECKOUT_SHIPPING_OPTIONS[payload.shippingMethod] || CHECKOUT_SHIPPING_OPTIONS.standard;
    const items = paymentLineItems(payload);
    summary.innerHTML = `
      <h2>Order Summary</h2>
      <div class="checkout-review-list">
        ${
          items.length
            ? items
                .map((item) => {
                  const product = item.snapshot || {};
                  return `
                    <article class="checkout-review-item">
                      <img src="${product.image || '/assets/icons/favicon.svg'}" alt="${escapeHtml(product.title || 'Product')}">
                      <div>
                        <strong>${escapeHtml(product.title || 'MAT STORE Product')}</strong>
                        <span>${item.quantity} x ${money(product.displayPrice || 0, payload.currency)}${item.variant ? ` · ${escapeHtml(item.variant)}` : ''}</span>
                      </div>
                    </article>
                  `;
                })
                .join('')
            : '<div class="empty-state">No products are attached to this payment.</div>'
        }
      </div>
      <div class="checkout-delivery-note">
        <strong>${escapeHtml(shipping.label || 'MAT Standard')}</strong>
        <span>${escapeHtml(shipping.window || 'Delivery calculated at checkout')}</span>
      </div>
      <div class="cart-totals">
        <div><span>Subtotal</span><strong>${money(totals.subtotal, payload.currency)}</strong></div>
        <div><span>Shipping</span><strong>${totals.shipping ? money(totals.shipping, payload.currency) : 'Included'}</strong></div>
        <div><span>Tax</span><strong>${money(totals.tax, payload.currency)}</strong></div>
        <div><span>Discount</span><strong>${totals.discount ? `-${money(totals.discount, payload.currency)}` : 'None'}</strong></div>
        <div><span>Total</span><strong>${money(totals.total, payload.currency)}</strong></div>
      </div>
      <div class="checkout-trust-row"><span>Encrypted</span><span>Protected</span><span>Support ready</span></div>
    `;
  }

  function setPaymentStatus(message, tone = '') {
    const status = document.getElementById('paymentStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function submitPaymentOrder(method) {
    const payload = activePaymentPayload('paypal');
    if (!payload || !payload.items?.length) {
      setPaymentStatus('Checkout details are missing. Return to checkout first.', 'error');
      return;
    }
    const button = document.getElementById('paypalPaymentButton');
    if (button) button.disabled = true;
      try {
        setPaymentStatus('Creating PayPal order...', 'loading');
        const result = await api.post('/orders', payload);
        localStorage.removeItem('mat_checkout_payload');
        clearCheckoutCart();
        const url = result.payment?.approvalUrl;
        if (result.payment?.requiresConfiguration) {
          toast(result.payment.message || 'Payment provider needs configuration.');
        }
        setPaymentStatus(`Order ${result.order.orderNumber} created.`, 'success');
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        window.location.href = `/orders.html?created=${encodeURIComponent(result.order.orderNumber)}`;
      } catch (error) {
        setPaymentStatus(error.message, 'error');
        toast(error.message);
      } finally {
        if (button) button.disabled = false;
      }
  }

  async function renderPaymentPayPal(payload) {
    const panel = document.getElementById('paypalCheckoutPanel');
    if (!panel) return;
    panel.hidden = false;
    resetPayPalCheckoutSession();
    paypalCheckout.rendered = false;
    paypalCheckout.rendering = true;
    try {
      setPayPalStatus('Loading PayPal secure checkout...', 'loading');
      const config = await api.get('/orders/paypal/config', { currency: payload.currency || state.currency });
      const note = document.getElementById('paypalCurrencyNote');
      if (note) note.textContent = config.currency !== config.requestedCurrency ? `PayPal settles in ${config.currency}` : `${config.currency} secure payment`;
      if (!config.enabled || !config.clientId) {
        const missing = config.diagnostics?.missing?.length ? config.diagnostics.missing.join(' and ') : 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET';
        setPayPalStatus(`PayPal is not configured on the server. Add ${missing} in Vercel Environment Variables, then redeploy.`, 'error');
        return;
      }

      await loadPayPalSdk(config);
      const buttonContainer = document.getElementById('paypal-button-container');
      if (buttonContainer) buttonContainer.innerHTML = '';
      hydrateCardBillingFields(payload);

      window.paypal.Buttons({
        style: {
          layout: 'vertical',
          color: 'gold',
          shape: 'rect',
          label: 'paypal',
          borderRadius: 8
        },
        createOrder() {
          return createPayPalOrderFromPayload(activePaymentPayload('paypal'));
        },
        onApprove(data, actions) {
          return capturePayPalSdkOrder(data, actions);
        },
        onCancel() {
          setPayPalStatus('PayPal checkout was cancelled. Your checkout details are still saved.', 'warning');
        },
        onError(error) {
          setPayPalStatus(error?.message || 'PayPal checkout could not be completed.', 'error');
          toast(error?.message || 'PayPal checkout could not be completed.');
        }
      }).render('#paypal-button-container');

      const cardShell = document.getElementById('paypal-card-fields');
      const cardSubmit = document.getElementById('paypal-card-submit');
      if (window.paypal.CardFields && cardShell && cardSubmit) {
        const cardFields = window.paypal.CardFields({
          style: {
            input: {
              color: '#16130f',
              'font-size': '16px',
              'font-family': 'Inter, sans-serif',
              'font-weight': '600'
            },
            '.invalid': { color: '#b64235' }
          },
          createOrder() {
            return createPayPalOrderFromPayload(activePaymentPayload('paypal'));
          },
          onApprove(data, actions) {
            return capturePayPalSdkOrder(data, actions);
          },
          onError(error) {
            setPayPalStatus(error?.message || 'Card payment could not be completed.', 'error');
            toast(error?.message || 'Card payment could not be completed.');
          },
          inputEvents: {
            onChange(data) {
              cardSubmit.disabled = !data.isFormValid;
            }
          }
        });

        if (cardFields.isEligible()) {
          cardShell.hidden = false;
          cardFields.NameField({ placeholder: 'Full name on card' }).render('#card-name-field-container');
          cardFields.NumberField({ placeholder: 'Card number' }).render('#card-number-field-container');
          cardFields.ExpiryField({ placeholder: 'MM/YY' }).render('#card-expiry-field-container');
          cardFields.CVVField({ placeholder: 'CVV' }).render('#card-cvv-field-container');
          cardSubmit.addEventListener('click', async () => {
            const fieldState = await cardFields.getState();
            if (!fieldState.isFormValid) {
              setPayPalStatus('Check your card details before paying.', 'error');
              return;
            }
            cardSubmit.disabled = true;
            try {
              await cardFields.submit({ billingAddress: cardBillingAddress() });
            } catch (error) {
              setPayPalStatus(error?.message || 'Card payment could not be submitted.', 'error');
            } finally {
              cardSubmit.disabled = false;
            }
          });
        }
      }

      paypalCheckout.rendered = true;
      setPayPalStatus('Choose PayPal wallet or enter card details below.', 'success');
    } catch (error) {
      setPayPalStatus(error.message, 'error');
      toast(error.message);
    } finally {
      paypalCheckout.rendering = false;
    }
  }

  function showPaymentMethod(method) {
    const selectedMethod = 'paypal';
    const payload = activePaymentPayload(selectedMethod);
    if (payload) saveCheckoutPayload(payload);
    document.getElementById('paypalCheckoutPanel')?.removeAttribute('hidden');
    resetPayPalCheckoutSession();
    if (payload) renderPaymentPayPal(payload);
  }

  async function initPayment() {
    if (!requireCheckoutAccount('Login or register before payment.')) return;
    await loadProducts();
    const payload = storedCheckoutPayload();
    renderPaymentSummary(payload);
    if (!payload || !payload.items?.length) {
      setPaymentStatus('Checkout details are missing. Return to checkout first.', 'error');
      document.getElementById('paymentMethodPanel')?.setAttribute('hidden', '');
      return;
    }

    const selectedMethod = 'paypal';
    document.querySelectorAll('input[name="paymentPageMethod"]').forEach((input) => {
      input.checked = input.value === selectedMethod;
      input.addEventListener('change', () => showPaymentMethod(input.value));
    });
    document.getElementById('card-billing-address-country-code')?.addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().slice(0, 2);
    });
    showPaymentMethod(selectedMethod);
  }

  function setAccountTab(name) {
    document.querySelectorAll('[data-account-tab]').forEach((button) => {
      const active = button.dataset.accountTab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-account-panel]').forEach((panel) => {
      const active = panel.dataset.accountPanel === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  function setAccountStatus(message = '', tone = 'info') {
    const status = document.getElementById('accountStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = !message;
  }

  function accountFormData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function normalizeCountryCode(value = '') {
    return String(value || 'US').trim().slice(0, 2).toUpperCase() || 'US';
  }

  function setFormBusy(form, busy, busyLabel = 'Working...') {
    const submit = form?.querySelector('button[type="submit"]');
    if (!submit) return;
    if (!submit.dataset.defaultLabel) submit.dataset.defaultLabel = submit.textContent;
    submit.disabled = busy;
    submit.textContent = busy ? busyLabel : submit.dataset.defaultLabel;
  }

  function accountPasswordScore(value = '') {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return score;
  }

  function updateAccountPasswordStrength() {
    const input = document.getElementById('accountRegisterPassword');
    const target = document.getElementById('accountPasswordStrength');
    if (!input || !target) return;
    const score = accountPasswordScore(input.value);
    const labels = ['Use 8+ characters with letters and numbers.', 'Weak password.', 'Better. Add uppercase, numbers, or symbols.', 'Good password.', 'Strong password.', 'Excellent password.'];
    target.textContent = labels[score] || labels[0];
    target.dataset.strength = String(score);
  }

  function bindAccountPasswordToggles(root = document) {
    root.querySelectorAll('[data-toggle-password]').forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        button.textContent = isPassword ? 'Hide' : 'Show';
        button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      });
    });
  }

  function accountCurrencyOptions(selected) {
    const currencies = state.currencies?.length ? state.currencies : ['USD', 'EUR', 'GBP', 'GMD', 'NGN', 'CAD', 'AED'];
    return currencies.map((currency) => `<option value="${escapeHtml(currency)}" ${currency === selected ? 'selected' : ''}>${escapeHtml(currency)}</option>`).join('');
  }

  function addressSummary(address = {}) {
    return [address.line1, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ');
  }

  async function accountLogout() {
    try {
      await api.post('/auth/logout', { refreshToken: localStorage.getItem('mat_refresh_token') });
    } catch {
      // A stale refresh token should not block the customer from signing out locally.
    }
    api.clearTokens();
    state.user = null;
    api.setUser(null);
    updateHeaderUser();
    setAccountTab('login');
    renderAccount();
    setAccountStatus('You are signed out.', 'success');
    toast('Signed out.');
  }

  async function renderAccount() {
    const profile = document.getElementById('accountProfile');
    if (!profile) return;
    if (!state.user) {
      profile.innerHTML = '<div class="empty-state">Login or register to manage profile, addresses, wishlist, and orders.</div>';
      return;
    }

    const addresses = state.user.addresses || [];
    const selectedCurrency = state.user.currency || state.currency || 'USD';
    const marketingOptIn = Boolean(state.user.preferences?.marketingOptIn);
    const addressRows = addresses.length
      ? addresses.map((address) => `
          <div class="list-row address-row">
            <strong>${escapeHtml(address.label || 'Saved address')}</strong>
            <span>${escapeHtml(address.name || state.user.name)} · ${escapeHtml(addressSummary(address))}</span>
          </div>
        `).join('')
      : '<div class="empty-state">No saved addresses yet. Add one from the address panel.</div>';

    profile.innerHTML = `
      <div class="profile-grid">
        <section class="profile-card">
          <p class="eyebrow">Signed in</p>
          <h2>${escapeHtml(state.user.name)}</h2>
          <p>${escapeHtml(state.user.email)}</p>
        </section>
        <section class="profile-card">
          <p class="eyebrow">Shopping profile</p>
          <h2>${escapeHtml(selectedCurrency)} · ${escapeHtml(state.user.country || 'US')}</h2>
          <p>${(state.user.wishlist || []).length} saved products · ${addresses.length} saved addresses · ${escapeHtml(state.user.role || 'customer')}</p>
        </section>
      </div>
      <form id="accountProfileForm" class="page-form profile-edit-form">
        <div class="form-grid">
          <label>Full name
            <input class="page-input" name="name" autocomplete="name" value="${escapeHtml(state.user.name)}" required>
          </label>
          <label>Email
            <input class="page-input" value="${escapeHtml(state.user.email)}" disabled>
          </label>
        </div>
        <div class="form-grid">
          <label>Country code
            <input class="page-input country-code-input" name="country" maxlength="2" autocomplete="country" value="${escapeHtml(state.user.country || 'US')}" required>
          </label>
          <label>Currency
            <select class="page-select" id="accountProfileCurrency" name="currency">${accountCurrencyOptions(selectedCurrency)}</select>
          </label>
        </div>
        <label class="check-line premium-check">
          <input name="marketingOptIn" type="checkbox" ${marketingOptIn ? 'checked' : ''}>
          Send premium drops, order reminders, and private deal alerts.
        </label>
        <button class="button primary full" type="submit">Save profile</button>
      </form>
      <section class="profile-card address-stack">
        <div class="section-head">
          <div>
            <p class="eyebrow">Saved addresses</p>
            <h2>Delivery book</h2>
          </div>
          <span>${addresses.length}/8 saved</span>
        </div>
        ${addressRows}
      </section>
      <button class="button ghost full" type="button" id="accountLogout">Logout</button>
    `;

    bindAccountPasswordToggles(profile);
    profile.querySelectorAll('.country-code-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.value = normalizeCountryCode(input.value);
      });
    });
    document.getElementById('accountLogout')?.addEventListener('click', accountLogout);
    document.getElementById('accountProfileForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = accountFormData(form);
      payload.country = normalizeCountryCode(payload.country);
      payload.preferences = { marketingOptIn: Boolean(form.marketingOptIn?.checked) };
      delete payload.marketingOptIn;
      setFormBusy(form, true, 'Saving...');
      try {
        const result = await api.patch('/auth/profile', payload);
        state.user = result.user;
        api.setUser(result.user);
        state.currency = result.user.currency || state.currency;
        localStorage.setItem('mat_currency', state.currency);
        const currencySelect = document.getElementById('currencySelect');
        if (currencySelect) currencySelect.value = state.currency;
        updateHeaderUser();
        renderAccount();
        setAccountStatus('Profile updated.', 'success');
        toast('Profile updated.');
      } catch (error) {
        setAccountStatus(error.message || 'Profile could not be updated.', 'error');
        toast(error.message);
      } finally {
        setFormBusy(form, false);
      }
    });
  }

  async function initAccount() {
    setAccountTab(state.user ? 'profile' : 'login');
    renderAccount();
    document.querySelectorAll('[data-account-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setAccountStatus('');
        setAccountTab(button.dataset.accountTab);
      });
    });
    document.querySelectorAll('.country-code-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.value = normalizeCountryCode(input.value);
      });
    });
    bindAccountPasswordToggles();
    document.getElementById('accountRegisterPassword')?.addEventListener('input', updateAccountPasswordStrength);

    document.getElementById('accountLoginForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setFormBusy(form, true, 'Signing in...');
      setAccountStatus('Checking your secure session...', 'info');
      try {
        const data = accountFormData(form);
        const result = await api.post('/auth/login', data);
        api.setTokens(result.accessToken, result.refreshToken);
        state.user = result.user;
        api.setUser(result.user);
        state.currency = result.user.currency || 'USD';
        localStorage.setItem('mat_currency', state.currency);
        const currencySelect = document.getElementById('currencySelect');
        if (currencySelect) currencySelect.value = state.currency;
        updateHeaderUser();
        setAccountTab('profile');
        renderAccount();
        setAccountStatus('Welcome back.', 'success');
        toast('Logged in.');
        if (redirectAfterAccountAuth()) return;
      } catch (error) {
        setAccountStatus(error.message || 'Login failed. Check your email and password.', 'error');
        toast(error.message);
      } finally {
        setFormBusy(form, false);
      }
    });

    document.getElementById('accountRegisterForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = accountFormData(form);
      if (data.password !== data.confirmPassword) {
        setAccountStatus('Passwords do not match.', 'error');
        return;
      }
      if (accountPasswordScore(data.password) < 2) {
        setAccountStatus('Please use a stronger password before creating your account.', 'error');
        return;
      }

      data.country = normalizeCountryCode(data.country);
      data.marketingOptIn = Boolean(form.marketingOptIn?.checked);
      delete data.confirmPassword;
      setFormBusy(form, true, 'Creating...');
      setAccountStatus('Creating your encrypted MAT STORE profile...', 'info');
      try {
        const result = await api.post('/auth/register', data);
        api.setTokens(result.accessToken, result.refreshToken);
        state.user = result.user;
        api.setUser(result.user);
        state.currency = result.user.currency || 'USD';
        localStorage.setItem('mat_currency', state.currency);
        const currencySelect = document.getElementById('currencySelect');
        if (currencySelect) currencySelect.value = state.currency;
        updateHeaderUser();
        setAccountTab('profile');
        renderAccount();
        setAccountStatus('Account created. Your secure profile is ready.', 'success');
        toast('Account created.');
        if (redirectAfterAccountAuth()) return;
      } catch (error) {
        setAccountStatus(error.message || 'Account creation failed. Try another email.', 'error');
        toast(error.message);
      } finally {
        setFormBusy(form, false);
      }
    });

    document.getElementById('accountResetForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setFormBusy(form, true, 'Sending...');
      setAccountStatus('Preparing reset instructions...', 'info');
      try {
        const data = accountFormData(form);
        const result = await api.post('/auth/forgot-password', data);
        setAccountStatus(result.devResetToken ? `Reset prepared. Dev token: ${result.devResetToken}` : result.message, 'success');
        toast('Reset request prepared.');
      } catch (error) {
        setAccountStatus(error.message || 'Password reset could not be prepared.', 'error');
        toast(error.message);
      } finally {
        setFormBusy(form, false);
      }
    });

    document.getElementById('addressForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!state.user) {
        setAccountTab('login');
        setAccountStatus('Login or create an account before saving addresses.', 'error');
        return toast('Login to save addresses.');
      }
      const data = accountFormData(form);
      data.country = normalizeCountryCode(data.country);
      setFormBusy(form, true, 'Saving...');
      try {
        const result = await api.post('/auth/addresses', data);
        state.user = result.user;
        api.setUser(result.user);
        renderAccount();
        setAccountStatus('Address saved.', 'success');
        toast('Address saved.');
      } catch (error) {
        setAccountStatus(error.message || 'Address could not be saved.', 'error');
        toast(error.message);
      } finally {
        setFormBusy(form, false);
      }
    });
  }

  async function initWishlist() {
    await loadProducts();
    const target = document.getElementById('wishlistGrid');
    if (!state.user) {
      target.innerHTML = '<div class="empty-state">Login to view wishlist products.</div>';
      return;
    }
    const ids = new Set(state.user.wishlist || []);
    const products = state.products.filter((product) => ids.has(product.id));
    target.innerHTML = products.length ? products.map(card).join('') : '<div class="empty-state">No saved products yet.</div>';
  }

  async function initOrders() {
    const target = document.getElementById('ordersList');
    if (!state.user) {
      target.innerHTML = '<div class="empty-state">Login to view order history.</div>';
      return;
    }
    const data = await api.get('/orders/my');
    target.innerHTML = (data.orders || []).length
      ? data.orders.map((order) => `
        <article class="order-card">
          <header><strong>${escapeHtml(order.orderNumber)}</strong><span>${money(order.totals?.displayTotal || order.totals?.total, order.currency)}</span></header>
          <span>${escapeHtml(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)} · ${escapeHtml(order.fulfillmentStatus)}</span>
          <p>${(order.items || []).map((item) => `${item.quantity}x ${escapeHtml(item.title)}`).join(', ')}</p>
          <a class="button ghost full" href="/tracking.html?orderNumber=${encodeURIComponent(order.orderNumber)}&email=${encodeURIComponent(order.customer?.email || '')}">Track Order</a>
        </article>
      `).join('')
      : '<div class="empty-state">No orders yet.</div>';
  }

  function renderTrackingResult(tracking = null) {
    const target = document.getElementById('trackingResult');
    if (!target) return;
    if (!tracking) {
      target.innerHTML = '<h2>Tracking Result</h2><div class="empty-state">Enter your order details to view progress.</div>';
      return;
    }
    target.innerHTML = `
      <h2>${escapeHtml(tracking.orderNumber)}</h2>
      <div class="cart-totals">
        <div><span>Payment</span><strong>${escapeHtml(tracking.paymentStatus)}</strong></div>
        <div><span>Fulfillment</span><strong>${escapeHtml(tracking.fulfillmentStatus)}</strong></div>
        <div><span>Total</span><strong>${money(tracking.totals?.displayTotal || tracking.totals?.total || 0)}</strong></div>
        <div><span>Delivery</span><strong>${escapeHtml(tracking.checkout?.deliveryWindow || 'Calculated after dispatch')}</strong></div>
      </div>
      <div class="tracking-steps">
        ${(tracking.trackingSteps || []).map((step) => `
          <div class="tracking-step ${step.complete ? 'complete' : ''} ${step.active ? 'active' : ''} ${step.cancelled ? 'cancelled' : ''}">
            <strong>${escapeHtml(step.label)}</strong>
            <span>${escapeHtml(step.description)}</span>
          </div>
        `).join('')}
      </div>
      <div class="checkout-review-list">
        ${(tracking.items || []).map((item) => `
          <article class="checkout-review-item">
            <img ${imageAttrs(item.image || generatedFallback(item), generatedFallback(item))} alt="${escapeHtml(item.title)}">
            <div><strong>${escapeHtml(item.title)}</strong><span>${item.quantity}x${item.variant ? ` · ${escapeHtml(item.variant)}` : ''}</span></div>
          </article>
        `).join('')}
      </div>
      ${tracking.trackingNumber ? `<a class="button ghost full" href="${escapeHtml(tracking.trackingUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(tracking.trackingCarrier || 'Carrier')} ${escapeHtml(tracking.trackingNumber)}</a>` : '<div class="empty-state">Carrier tracking will appear after dispatch.</div>'}
    `;
  }

  async function initTracking() {
    renderTrackingResult(null);
    const form = document.getElementById('trackingForm');
    const orderNumber = params().get('orderNumber') || params().get('order') || '';
    const email = params().get('email') || '';
    if (form) {
      form.elements.orderNumber.value = orderNumber;
      form.elements.email.value = email;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
          const result = await api.get('/orders/track', data);
          renderTrackingResult(result.tracking);
        } catch (error) {
          renderTrackingResult(null);
          toast(error.message);
        } finally {
          if (submit) submit.disabled = false;
        }
      });
      if (orderNumber && email) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }

  async function initAdminPage() {
    const gate = document.getElementById('adminGate');
    const adminView = document.getElementById('adminView');
    window.MATAdmin?.init();
    async function reveal() {
      await loadMe();
      const isAdmin = state.user?.role === 'admin';
      gate.hidden = isAdmin;
      adminView.hidden = !isAdmin;
      if (isAdmin) window.MATAdmin?.loadAll();
    }
    document.getElementById('adminPageLogin')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/auth/login', Object.fromEntries(new FormData(event.currentTarget).entries()));
        api.setTokens(result.accessToken, result.refreshToken);
        state.user = result.user;
        api.setUser(result.user);
        await reveal();
        toast('Admin dashboard unlocked.');
      } catch (error) {
        toast(error.message);
      }
    });
    await reveal();
  }

  async function initStaticEnhancements() {
    const featured = document.getElementById('featuredSupportProducts');
    if (!featured) return;
    await loadProducts();
    featured.innerHTML = state.products.slice(0, 3).map(card).join('');
  }

  async function init() {
    bindImageFallbacks();
    bindGlobal();
    window.MATApp = { toast, reloadProducts: loadProducts };
    window.MATCart?.init();
    await loadCurrencies();
    await loadMe();

    if (state.page === 'shop' || state.page === 'search') await initShopLike();
    else if (state.page === 'categories') await initCategories();
    else if (state.page === 'product') await initProduct();
    else if (state.page === 'cart') await initCartPage();
    else if (state.page === 'checkout') await initCheckout();
    else if (state.page === 'payment') await initPayment();
    else if (state.page === 'account') await initAccount();
    else if (state.page === 'wishlist') await initWishlist();
    else if (state.page === 'orders') await initOrders();
    else if (state.page === 'tracking') await initTracking();
    else if (state.page === 'admin') await initAdminPage();
    else await initStaticEnhancements();
  }

  window.MATVariantPricing = {
    apply: productWithVariantPrice,
    price: variantPricingForProduct
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => toast(error.message || 'Page could not load.'));
  });
})();
