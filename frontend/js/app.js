(function () {
  const api = window.MATApi;
  const state = {
    products: [],
    categories: [],
    category: 'all',
    query: '',
    currency: localStorage.getItem('mat_currency') || 'USD',
    suggestionTimer: null,
    currentProduct: null
  };
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return map[char];
    });
  }

  const REAL_PRODUCT_FALLBACK_IMAGES = {
    beauty: 'https://m.media-amazon.com/images/I/51Zw2fYy13L._AC_SL1500_.jpg',
    electronics: 'https://m.media-amazon.com/images/I/71OWtcxKgvL._AC_SL1500_.jpg',
    gadgets: 'https://m.media-amazon.com/images/I/71OWtcxKgvL._AC_SL1500_.jpg',
    gaming: 'https://ae-pic-a1.aliexpress-media.com/kf/S723c58a1136745c28ac69eb6ce156304U.jpg',
    fashion: 'https://ae-pic-a1.aliexpress-media.com/kf/S66eaa0a2ae354e35aac7c1f59272ef96Z.jpg',
    accessories: 'https://ae-pic-a1.aliexpress-media.com/kf/Sc2a92e0df47446ed80dca980bc33604aT.jpg',
    shoes: 'https://academy.scene7.com/is/image/academy/shoes/skechers-womens-go-walk-flex-slip-in-shoes-124836-nvw/95173bc9-f472-4b6b-8367-bae8db572a47?$pdp-mobile-gallery-ng$',
    home: 'https://ae-pic-a1.aliexpress-media.com/kf/S893dd8fb60674a73b45aad6d0cf1e3d6R.png',
    fitness: 'https://m.media-amazon.com/images/I/71pzkmU3PuL._AC_SL1500_.jpg',
    default: 'https://i5.walmartimages.com/seo/Owyfho-20W-PD-15W-Wireless-Fast-Charge-5000mAh-Portable-Magsafe-Power-Bank-for-iPhone-16-15-14-Samsung_a280b79f-5a86-46cc-9a16-bf0583dbd636.d5dc961a9549ce3dbbbd8bc258907a82.jpeg?odnHeight=1600&odnWidth=1600&odnBg=FFFFFF'
  };

  function generatedFallback(product = {}) {
    const key = `${product.category || ''} ${product.title || ''}`.toLowerCase();
    const match = Object.keys(REAL_PRODUCT_FALLBACK_IMAGES).find((category) => category !== 'default' && key.includes(category));
    return REAL_PRODUCT_FALLBACK_IMAGES[match] || REAL_PRODUCT_FALLBACK_IMAGES.default;
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

  function rawProductImage(product = {}) {
    const candidates = [
      ...(Array.isArray(product.images) ? product.images : []),
      product.image
    ].filter(Boolean);
    return candidates.find((candidate) => !isBlockedStockImageUrl(candidate)) || '';
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

  function isBlockedStockImageUrl(src = '') {
    const blockedStockImageSource = String.fromCharCode(117, 110, 115, 112, 108, 97, 115, 104);
    const blockedStockImageHost = `${blockedStockImageSource}.com`;
    const raw = unproxiedImageUrl(src);
    let decoded = String(raw || '');
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      decoded = String(raw || '');
    }
    try {
      const host = new URL(decoded, window.location.origin).hostname.toLowerCase();
      return host === `images.${blockedStockImageHost}`
        || host === `plus.${blockedStockImageHost}`
        || host.endsWith(`.${blockedStockImageHost}`);
    } catch {
      return new RegExp(`(?:images|plus)\\.${blockedStockImageSource}\\.com`, 'i').test(decoded);
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
      return /(media-amazon|ssl-images-amazon|images-amazon|alicdn|aliexpress-media|ebayimg|kwcdn|walmartimages)/i.test(host);
    } catch {
      return false;
    }
  }

  function clearViewImage(product = {}, src = '') {
    const original = String(src || '');
    if (/^\/api\/media\/(?:catalog|product)\//i.test(original) || /^\/api\/media\/image\?/i.test(original)) return original;
    const raw = unproxiedImageUrl(product.supplierImageUrl || src);
    if (isBlockedStockImageUrl(raw)) return '';
    if (!/^https?:\/\//i.test(raw)) return /^https?:\/\//i.test(src) ? src : '';
    const highRes = highQualityImageUrl(raw);
    return highRes;
  }

  function comparableImageUrl(src = '') {
    const raw = highQualityImageUrl(unproxiedImageUrl(src));
    try {
      const parsed = new URL(raw, window.location.origin);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(raw || '').trim();
    }
  }

  function halfDescription(product = {}) {
    const text = String(product.description || product.shortDescription || '').replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 24) return text;
    return `${words.slice(0, Math.ceil(words.length / 2)).join(' ')}...`;
  }

  function productFallback(product = {}) {
    const primary = comparableImageUrl(rawProductImage(product));
    const candidates = [
      product.image,
      ...(Array.isArray(product.images) ? product.images : [])
    ].filter(Boolean);
    const fallback = candidates.find((candidate) => {
      const raw = unproxiedImageUrl(candidate);
      return /^https?:\/\//i.test(raw) && !isBlockedStockImageUrl(candidate) && comparableImageUrl(candidate) !== primary;
    });
    return fallback ? highQualityImageUrl(unproxiedImageUrl(fallback)) : rawProductImage(product);
  }

  function productUrl(product = {}) {
    return `/product.html?id=${encodeURIComponent(product.slug || product.id || '')}`;
  }

  function formatUsd(value) {
    return window.MATCart?.formatMoney(value, state.currency) || `$${Number(value || 0).toFixed(2)}`;
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
    const listPrice = details.listPrice ? `<span>List ${escapeHtml(formatUsd(details.listPrice))}</span>` : '';
    const savings = details.savingsPercent ? `<span>${Number(details.savingsPercent).toFixed(0)}% savings</span>` : '';
    return `
      <div class="marketplace-snapshot">
        <nav class="product-jump-nav" aria-label="Product detail sections">
          <a href="#about-item">About this item</a>
          <a href="#product-specs">Product information</a>
          <a href="#product-videos">Videos</a>
          <a href="#product-reviews">Reviews</a>
        </nav>
        <section class="buying-options-panel" aria-label="Buying options">
          <div>
            <p class="eyebrow">${escapeHtml(details.badge || 'Buying options')}</p>
            <h3>${escapeHtml(product.formattedPrice || formatUsd(product.price))}</h3>
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
        </section>
        <section class="detail-section" id="about-item">
          <h3>About this item</h3>
          <ul>${details.about.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
        <section class="detail-section" id="product-specs">
          <h3>Product information</h3>
          <dl>${details.specs.slice(0, 12).map((item) => `<div><dt>${escapeHtml(item.name)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>
        </section>
        <section class="detail-section split-detail" id="product-videos">
          <div><h3>Product videos</h3><p>${escapeHtml(details.videos.label || `${details.videos.count || 0} videos available`)}</p></div>
          <div id="product-reviews"><h3>Reviews</h3><p>${Number(details.reviews.rating || 4.8).toFixed(1)} out of 5 · ${Number(details.reviews.count || 0).toLocaleString()} ratings</p><p>${escapeHtml(details.reviews.summary || '')}</p></div>
        </section>
      </div>
    `;
  }

  function imageAttrs(src, fallback) {
    const cleanSrc = src && !isBlockedStockImageUrl(src) ? src : '';
    const cleanFallback = fallback && !isBlockedStockImageUrl(fallback) ? fallback : cleanSrc;
    const nextSrc = cleanSrc || cleanFallback || '/mat-store.png';
    const fallbackAttr = cleanFallback ? ` data-fallback-src="${escapeHtml(cleanFallback)}"` : '';
    return `src="${escapeHtml(nextSrc)}"${fallbackAttr}`;
  }

  function bindImageFallbacks() {
    document.addEventListener(
      'error',
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const fallback = image.dataset.fallbackSrc || '';
        if (!fallback || image.dataset.fallbackApplied === 'true') return;
        try {
          if (new URL(fallback, window.location.origin).href === image.currentSrc) return;
        } catch {}
        image.dataset.fallbackApplied = 'true';
        image.src = fallback;
      },
      true
    );
  }

  function toast(message) {
    const region = document.getElementById('toastRegion');
    if (!region || !message) return;
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      setTimeout(() => item.remove(), 240);
    }, 3200);
  }

  function skeletonGrid(targetId, count = 8) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
  }

  async function loadProducts() {
    skeletonGrid('trendingGrid', 8);
    skeletonGrid('flashGrid', 4);
    const data = await api.get('/products', {
      limit: 160,
      currency: state.currency,
      q: state.query,
      category: state.category === 'all' ? '' : state.category
    });
    state.products = data.items || [];
    state.categories = data.categories || [];
    window.MATCart?.setProducts(state.products);
    renderAll();
  }

  function renderAll() {
    renderCategoryFilters();
    renderHeroStage();
    renderGrid('trendingGrid', trendingProducts(state.products).slice(0, 12));
    const flashProducts = state.products.filter((product) => product.collection === 'Flash Sale' || product.price > 80);
    renderGrid('flashGrid', (flashProducts.length ? flashProducts : state.products).slice(0, 6));
    renderRail();
    renderMasonry();
  }

  function trendingScore(product = {}) {
    const details = product.marketplaceDetails || {};
    const text = [product.title, product.category, product.collection, details.badge, details.boughtInPastMonth, ...(product.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    let score = Math.min(Number(product.reviewsCount || details.reviews?.count || 0), 20000) / 160 + Number(product.rating || 4.8) * 16;
    if (/\b(trending|popular|best seller|amazon's choice|choice|deal|goldbox|front page|global deals|new arrival|customer favorite)\b/i.test(text)) score += 95;
    if (/\b(iphone|galaxy|laptop|tv|smartwatch|headphone|ssd|gaming|speaker|tablet|camera|shoe|beauty)\b/i.test(text)) score += 35;
    if (Number(product.stock || 0) > 0) score += 18;
    if (product.images?.length || product.supplierImageUrl || product.image) score += 12;
    return score;
  }

  function trendingProducts(products = []) {
    return [...products].sort((a, b) => trendingScore(b) - trendingScore(a));
  }

  function renderCategoryFilters() {
    const target = document.getElementById('categoryFilters');
    if (!target) return;
    const categories = ['all', ...state.categories];
    target.innerHTML = categories
      .map(
        (category) => `
          <button class="${state.category === category ? 'active' : ''}" type="button" data-category="${escapeHtml(category)}">
            ${escapeHtml(category)}
          </button>
        `
      )
      .join('');
    target.insertAdjacentHTML(
      'afterbegin',
      `<a class="category-link-pill" href="/shop.html?trending=true">Trending products</a>`
    );
  }

  function renderHeroStage() {
    const target = document.getElementById('heroStage');
    if (!target) return;
    target.innerHTML = state.products
      .slice(0, 3)
      .map(
        (product) => `
          <article class="hero-product">
            <a class="hero-product-media" href="${productUrl(product)}">
              <img ${imageAttrs(productImage(product), productFallback(product))} alt="${escapeHtml(product.title)}" loading="lazy">
            </a>
            <div>
              <p>${escapeHtml(product.category)}</p>
              <h3><a href="${productUrl(product)}">${escapeHtml(product.title)}</a></h3>
              <button type="button" data-quick-view="${product.id}">${escapeHtml(product.formattedPrice)}</button>
            </div>
          </article>
        `
      )
      .join('');
  }

  function renderGrid(targetId, products) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = products.length
      ? products.map(productCard).join('')
      : '<div class="empty-state">No products match this edit.</div>';
  }

  function renderRail() {
    const target = document.getElementById('premiumRail');
    if (!target) return;
    const products = [...state.products.slice(0, 10), ...state.products.slice(0, 10)];
    target.innerHTML = products.map(productCard).join('');
  }

  function renderMasonry() {
    const target = document.getElementById('masonryGrid');
    if (!target) return;
    target.innerHTML = state.products
      .slice(2, 11)
      .map(
        (product) => `
          <article class="masonry-item reveal">
            <a href="${productUrl(product)}">
              <img ${imageAttrs(productImage(product), productFallback(product))} alt="${escapeHtml(product.title)}" loading="lazy">
            </a>
            <div>
              <p>${escapeHtml(product.category)} · ${escapeHtml(product.formattedPrice)}</p>
              <h3><a href="${productUrl(product)}">${escapeHtml(product.title)}</a></h3>
            </div>
          </article>
        `
      )
      .join('');
    observeReveals();
  }

  function productCard(product) {
    const url = productUrl(product);
    return `
      <article class="product-card reveal" data-product-id="${product.id}">
        <div class="product-media">
          <a class="product-media-link" href="${url}">
            <img ${imageAttrs(productImage(product), productFallback(product))} alt="${escapeHtml(product.title)}" loading="lazy">
            <span class="product-badge">${escapeHtml(product.collection || product.category)}</span>
          </a>
          <div class="floating-actions">
            <button type="button" data-wishlist="${product.id}" aria-label="Save ${escapeHtml(product.title)}">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>
            </button>
            <button type="button" data-quick-view="${product.id}" aria-label="Quick view ${escapeHtml(product.title)}">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
            </button>
          </div>
        </div>
        <div class="product-info">
          <h3><a href="${url}">${escapeHtml(product.title)}</a></h3>
          <div class="price-row">
            <strong>${escapeHtml(product.formattedPrice)}</strong>
            <span class="rating">${Number(product.rating || 4.8).toFixed(1)} · ${product.reviewsCount || 0} reviews</span>
          </div>
          <span class="price-note">Fair premium price</span>
          <div class="product-actions">
            <a class="view-link" href="${url}">View</a>
            <button class="add-button" type="button" data-add-product="${product.id}">Add To Cart</button>
          </div>
        </div>
      </article>
    `;
  }

  function productById(id) {
    return state.products.find((product) => product.id === id);
  }

  async function openProduct(idOrSlug) {
    try {
      const data = await api.get(`/products/${idOrSlug}`, { currency: state.currency });
      renderProductModal(data.product);
      const modal = document.getElementById('productModal');
      modal.showModal();
      document.body.classList.add('modal-open');
      updateMeta(data.product);
    } catch (error) {
      toast(error.message);
    }
  }

  function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal.open) modal.close();
    document.body.classList.remove('modal-open');
  }

  function renderProductModal(product) {
    state.currentProduct = product;
    const target = document.getElementById('productModalContent');
    const images = product.images?.length ? product.images : [productImage(product)];
    const fallback = productFallback(product);
    target.innerHTML = `
      <div class="modal-gallery">
        <div class="gallery-kicker"><span>Click thumbnails to see full view</span><span>${Number(productDetails(product).videos.count || 0)} videos</span></div>
        <div class="modal-gallery-main">
          <img id="modalMainImage" ${imageAttrs(clearViewImage(product, images[0]), fallback)} alt="${escapeHtml(product.title)}">
        </div>
        <div class="modal-thumbs">
          ${images
            .map(
              (image) => `
                <button type="button" data-thumb="${escapeHtml(clearViewImage(product, image))}" aria-label="View product image">
                  <img ${imageAttrs(image, fallback)} alt="${escapeHtml(product.title)} thumbnail">
                </button>
              `
            )
            .join('')}
        </div>
      </div>
      <aside class="purchase-panel">
        <p class="eyebrow">${escapeHtml(product.category)} · ${escapeHtml(product.collection)}</p>
        <h2 id="modalProductTitle">${escapeHtml(product.title)}</h2>
        <div class="price-row">
          <strong>${escapeHtml(product.formattedPrice)}</strong>
          <span class="rating">${Number(product.rating || 4.8).toFixed(1)} · ${product.reviewsCount || 0} reviews</span>
        </div>
        <a class="view-link" href="${productUrl(product)}">View Full Product Page</a>
        <p class="view-description">${escapeHtml(halfDescription(product))}</p>
        <ul class="feature-list">
          ${(product.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}
        </ul>
        ${renderMarketplaceInsights(product)}
        <button class="button primary full" type="button" data-modal-add="${product.id}">Add To Cart</button>
        <button class="button ghost full" type="button" data-wishlist="${product.id}">Save To Wishlist</button>
        <div>
          <p class="eyebrow">Related</p>
          <div class="related-products">
            ${(product.related || [])
              .slice(0, 4)
              .map((item) => `<button type="button" data-related-product="${item.id}">${escapeHtml(item.title)}<br><strong>${escapeHtml(item.formattedPrice)}</strong></button>`)
              .join('')}
          </div>
        </div>
      </aside>
    `;
  }

  function updateMeta(product) {
    document.title = `${product.seo?.title || product.title} | MAT STORE`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', product.seo?.description || product.shortDescription || product.description);
  }

  async function showSuggestions(query) {
    const target = document.getElementById('searchSuggestions');
    if (!target) return;
    const cleanQuery = String(query || '').trim();
    if (cleanQuery.length < 2) {
      target.hidden = true;
      target.innerHTML = '';
      return;
    }
    const marketplaceOptions = `
      <div class="suggestion-heading">Choose a search</div>
      <button class="suggestion-item marketplace-suggestion" type="button" data-search-query="${escapeHtml(cleanQuery)}">
        <img ${imageAttrs(searchFallbackImage(cleanQuery), searchFallbackImage(cleanQuery))} alt="Search MAT STORE network">
        <strong>Search MAT STORE network for "${escapeHtml(cleanQuery)}"<span>Premium products from our private sourcing network</span></strong>
      </button>
    `;
    target.hidden = false;
    target.innerHTML = marketplaceOptions;
    try {
      const data = await api.get('/products/suggestions', { q: cleanQuery });
      const localItems = (data.items || []).slice(0, 5);
      target.innerHTML = marketplaceOptions + (localItems.length
        ? `
          <div class="suggestion-heading">MAT STORE products</div>
          ${localItems
            .map(
              (item) => `
                <button class="suggestion-item" type="button" data-suggestion-product="${item.id}">
                  <img ${imageAttrs(item.image, item.image)} alt="${escapeHtml(item.title)}">
                  <strong>${escapeHtml(item.title)}<span>${escapeHtml(item.category)}</span></strong>
                </button>
              `
            )
            .join('')}
        `
        : '');
    } catch {
      target.hidden = false;
    }
  }

  function observeReveals() {
    const items = document.querySelectorAll('.reveal:not(.is-visible)');
    if (!('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    items.forEach((item) => observer.observe(item));
  }

  function startCountdown() {
    const end = Date.now() + 1000 * 60 * 60 * 12;
    setInterval(() => {
      const remaining = Math.max(0, end - Date.now());
      const hours = Math.floor(remaining / 1000 / 60 / 60);
      const minutes = Math.floor((remaining / 1000 / 60) % 60);
      const seconds = Math.floor((remaining / 1000) % 60);
      document.getElementById('countdownHours').textContent = String(hours).padStart(2, '0');
      document.getElementById('countdownMinutes').textContent = String(minutes).padStart(2, '0');
      document.getElementById('countdownSeconds').textContent = String(seconds).padStart(2, '0');
    }, 1000);
  }

  function setMobileMenu(open) {
    const menu = document.getElementById('mobileMenu');
    const toggle = document.getElementById('menuToggle');
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

  function bindEvents() {
    document.getElementById('searchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.query = document.getElementById('searchInput').value.trim();
      document.getElementById('searchSuggestions').hidden = true;
      if (state.query) {
        window.location.href = `/search.html?q=${encodeURIComponent(state.query)}`;
        return;
      }
      loadProducts();
    });

    document.getElementById('searchInput')?.addEventListener('input', (event) => {
      clearTimeout(state.suggestionTimer);
      const value = event.target.value;
      state.suggestionTimer = setTimeout(() => showSuggestions(value), 180);
    });

    document.getElementById('clearFiltersButton')?.addEventListener('click', () => {
      state.category = 'all';
      state.query = '';
      document.getElementById('searchInput').value = '';
      loadProducts();
    });

    document.getElementById('currencySelect')?.addEventListener('change', (event) => {
      state.currency = event.target.value;
      localStorage.setItem('mat_currency', state.currency);
      loadProducts();
      window.MATCart?.render();
    });

    setMobileMenu(false);

    document.getElementById('menuToggle')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = document.getElementById('mobileMenu');
      if (!menu) return;
      setMobileMenu(menu.hidden);
    });

    document.querySelectorAll('#mobileMenu a, #mobileMenu button').forEach((link) => {
      link.addEventListener('click', () => setMobileMenu(false));
    });

    document.addEventListener('click', (event) => {
      const menu = document.getElementById('mobileMenu');
      const toggle = document.getElementById('menuToggle');
      if (!menu || menu.hidden || toggle?.contains(event.target) || menu.contains(event.target)) return;
      setMobileMenu(false);
    });

    document.getElementById('wishlistButton')?.addEventListener('click', () => {
      window.MATAuth?.openAuth('login');
    });

    document.querySelector('[data-close-product]')?.addEventListener('click', closeProductModal);

    document.addEventListener('click', async (event) => {
      const categoryButton = event.target.closest('[data-category]');
      const addButton = event.target.closest('[data-add-product]');
      const modalAddButton = event.target.closest('[data-modal-add]');
      const quickViewButton = event.target.closest('[data-quick-view]');
      const wishlistButton = event.target.closest('[data-wishlist]');
      const thumbButton = event.target.closest('[data-thumb]');
      const relatedButton = event.target.closest('[data-related-product]');
      const suggestionButton = event.target.closest('[data-suggestion-product]');
      const searchButton = event.target.closest('[data-search-query]');

      if (categoryButton) {
        state.category = categoryButton.dataset.category;
        await loadProducts();
      }
      if (addButton) {
        const product = productById(addButton.dataset.addProduct);
        if (product) window.MATCart?.add(product);
      }
      if (modalAddButton) {
        const product =
          productById(modalAddButton.dataset.modalAdd) ||
          (state.currentProduct?.id === modalAddButton.dataset.modalAdd ? state.currentProduct : null);
        if (product) window.MATCart?.add(product);
      }
      if (quickViewButton) openProduct(quickViewButton.dataset.quickView);
      if (wishlistButton) {
        try {
          await window.MATAuth?.toggleWishlist(wishlistButton.dataset.wishlist);
          toast('Wishlist updated.');
        } catch (error) {
          toast(error.message);
        }
      }
      if (thumbButton) {
        const mainImage = document.getElementById('modalMainImage');
        if (mainImage) mainImage.src = thumbButton.dataset.thumb;
      }
      if (relatedButton) openProduct(relatedButton.dataset.relatedProduct);
      if (suggestionButton) {
        document.getElementById('searchSuggestions').hidden = true;
        openProduct(suggestionButton.dataset.suggestionProduct);
      }
      if (searchButton) {
        document.getElementById('searchSuggestions').hidden = true;
        window.location.href = searchUrl(searchButton.dataset.searchQuery);
      }
    });

    document.addEventListener('mousemove', (event) => {
      const glow = document.getElementById('cursorGlow');
      if (!glow) return;
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.getElementById('searchSuggestions').hidden = true;
        setMobileMenu(false);
      }
    });
  }

  async function init() {
    bindImageFallbacks();
    bindEvents();
    window.MATCart?.init();
    await window.MATAuth?.init();
    window.MATAdmin?.init();
    const currencySelect = document.getElementById('currencySelect');
    if (currencySelect && currencySelect.value) state.currency = currencySelect.value;
    await loadProducts();
    observeReveals();
    startCountdown();
    setTimeout(() => document.getElementById('loader')?.classList.add('is-hidden'), 650);
  }

  window.MATApp = {
    init,
    toast,
    reloadProducts: loadProducts,
    products: () => [...state.products]
  };

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      toast(error.message || 'MAT STORE failed to initialize.');
      document.getElementById('loader')?.classList.add('is-hidden');
    });
  });
})();
