(function () {
  const api = window.MATApi;
  const state = {
    products: [],
    orders: [],
    customers: [],
    preview: [],
    importOptions: {},
    dashboard: null,
    productQuery: '',
    productCollection: 'all',
    productSupplier: 'all',
    productStatus: 'all',
    productVisible: 80,
    loaded: false
  };

  const PRODUCT_BATCH_SIZE = 80;

  function toast(message) {
    window.MATApp?.toast(message);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return map[char];
    });
  }

  function money(value) {
    return window.MATCart?.formatMoney(value, 'USD') || `$${Number(value || 0).toFixed(2)}`;
  }

  function pricingSummary(product = {}) {
    const supplierPrice = Number(product.supplierPrice || 0);
    const price = Number(product.price || 0);
    const grossProfit = Number(product.pricingPlan?.grossProfit ?? (price - supplierPrice));
    const marginPercent = Number(product.pricingPlan?.marginPercent ?? (price ? (grossProfit / price) * 100 : 0));
    const strategy = product.pricingPlan?.strategy || 'AI smart pricing';
    return {
      supplierPrice,
      price,
      grossProfit,
      marginPercent,
      strategy,
      adjusted: Boolean(product.pricingPlan?.adjusted),
      protected: product.pricingPlan?.protected !== false && supplierPrice > 0 && price > supplierPrice
    };
  }

  function generatedFallback(product = {}) {
    const query = new URLSearchParams({
      title: product.title || 'MAT STORE Product',
      marketplace: product.supplierName || 'MAT STORE',
      code: product.supplierProductCode || '',
      category: product.category || 'premium pick'
    });
    return `/api/media/fallback?${query.toString()}`;
  }

  function productImage(product = {}) {
    return product.images?.[0] || product.image || product.fallbackImage || generatedFallback(product);
  }

  function productFallback(product = {}) {
    return product.fallbackImage || generatedFallback(product);
  }

  function imageAttrs(src, fallback) {
    const nextFallback = fallback || '/assets/icons/favicon.svg';
    return `src="${escapeHtml(src || nextFallback)}" data-fallback-src="${escapeHtml(nextFallback)}"`;
  }

  function optionHtml(value, label, selectedValue) {
    const selected = String(value) === String(selectedValue) ? ' selected' : '';
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
  }

  function fillSelect(id, values, selectedValue, allLabel) {
    const select = document.getElementById(id);
    if (!select) return;
    const options = [optionHtml('all', allLabel, selectedValue)]
      .concat(values.map((value) => optionHtml(value, value, selectedValue)));
    select.innerHTML = options.join('');
  }

  function uniqueProductValues(key, fallback = 'MAT STORE') {
    return [...new Set(state.products.map((product) => product[key] || fallback).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));
  }

  function productStatusClass(status) {
    const clean = String(status || 'draft').toLowerCase();
    if (clean === 'active') return 'status-pill active';
    if (clean === 'archived') return 'status-pill archived';
    return 'status-pill';
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

  function openAdmin() {
    const user = window.MATAuth?.getUser();
    if (user?.role !== 'admin') {
      window.MATAuth?.openAuth('login');
      toast('Admin login required.');
      return;
    }
    document.getElementById('storefront').hidden = true;
    document.getElementById('adminView').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadAll();
  }

  function closeAdmin() {
    document.getElementById('storefront').hidden = false;
    document.getElementById('adminView').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function logoutAdmin() {
    const refreshToken = localStorage.getItem('mat_refresh_token');
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      // Clearing local state is still correct if the server-side token already expired.
    }
    api.clearTokens();
    api.setUser(null);
    const adminView = document.getElementById('adminView');
    const adminGate = document.getElementById('adminGate');
    const storefront = document.getElementById('storefront');
    if (adminView) adminView.hidden = true;
    if (adminGate) adminGate.hidden = false;
    if (storefront) storefront.hidden = false;
    toast('Admin signed out.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setPanel(name) {
    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.adminTab === name);
    });
    document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.adminPanel === name);
    });
  }

  async function loadAll() {
    try {
      await Promise.all([loadDashboard(), loadProducts(), loadOrders(), loadCustomers(), loadAbandoned()]);
      state.loaded = true;
    } catch (error) {
      toast(error.message);
    }
  }

  async function loadDashboard() {
    const data = await api.get('/admin/dashboard');
    state.dashboard = data.analytics;
    renderDashboard(data.analytics);
  }

  function renderDashboard(analytics) {
    const stats = document.getElementById('adminStats');
    if (stats) {
      const items = [
        ['Revenue', money(analytics.revenue)],
        ['30-day revenue', money(analytics.revenue30Days)],
        ['Orders', analytics.orders],
        ['Customers', analytics.customers],
        ['Abandoned carts', analytics.abandonedCarts],
        ['AOV', money(analytics.averageOrderValue)],
        ['Catalog value', money(analytics.retailValue)],
        ['Margin value', money(analytics.marginValue)],
        ['Price protected', analytics.pricingHealth?.protected || 0],
        ['Hard-to-find', analytics.pricingHealth?.hardToFind || 0],
        ['At-risk prices', analytics.pricingHealth?.underpriced || 0],
        ['Duplicates', analytics.duplicateCount || 0],
        ['Active products', analytics.activeProducts],
        ['Pending orders', analytics.pendingOrders],
        ['Low stock', analytics.lowStock.length],
        ['Image ready', `${analytics.imageHealth?.withImages || 0}/${analytics.imageHealth?.total || 0}`]
      ];
      stats.innerHTML = items
        .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`)
        .join('');
    }

    const max = Math.max(1, ...(analytics.categoryRevenue || []).map((item) => item.value));
    const categoryRevenue = document.getElementById('categoryRevenue');
    if (categoryRevenue) {
      categoryRevenue.innerHTML = (analytics.categoryRevenue || []).length
        ? analytics.categoryRevenue
            .map(
              (item) => `
                <div class="bar-row" style="--bar-width:${Math.round((item.value / max) * 100)}%">
                  <strong>${escapeHtml(item.category)}</strong>
                  <span>${money(item.value)}</span>
                </div>
              `
            )
            .join('')
        : '<div class="empty-state">Revenue categories appear after orders.</div>';
    }

    const lowStock = document.getElementById('lowStockList');
    if (lowStock) {
      lowStock.innerHTML = analytics.lowStock.length
        ? analytics.lowStock
            .map((product) => `<div class="list-row"><strong>${escapeHtml(product.title)}</strong><span>${product.stock} units · ${escapeHtml(product.category)}</span></div>`)
            .join('')
        : '<div class="empty-state">Inventory is healthy.</div>';
    }

    renderGroupStats('adminCollectionStats', analytics.collectionStats || [], 'collection');
    renderGroupStats('adminMarketplaceStats', analytics.marketplaceStats || [], 'source');
    renderHealthPanel(analytics);
  }

  function renderGroupStats(targetId, items, label) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = items.length
      ? items
          .slice(0, 8)
          .map(
            (item) => `
              <div class="metric-row">
                <div>
                  <strong>${escapeHtml(item.label || item[label] || 'MAT STORE')}</strong>
                  <span>${Number(item.active || 0)} active · ${Number(item.stock || 0)} units</span>
                </div>
                <div>
                  <strong>${Number(item.count || 0)}</strong>
                  <span>${money(item.retailValue || 0)}</span>
                </div>
              </div>
            `
          )
          .join('')
      : `<div class="empty-state">No ${escapeHtml(label)} data yet.</div>`;
  }

  function renderHealthPanel(analytics) {
    const target = document.getElementById('adminHealthPanel');
    if (!target) return;
    const imageHealth = analytics.imageHealth || {};
    const pricingHealth = analytics.pricingHealth || {};
    const statusStats = analytics.statusStats || {};
    const statusText = Object.entries(statusStats)
      .map(([status, count]) => `${status}: ${count}`)
      .join(' · ') || 'No products';
    target.innerHTML = `
      <div class="metric-row">
        <div><strong>Product rows</strong><span>${Number(analytics.totalProducts || 0)} total · ${Number(analytics.activeProducts || 0)} active</span></div>
        <div><strong>${Number(analytics.duplicateCount || 0)}</strong><span>duplicates</span></div>
      </div>
      <div class="metric-row">
        <div><strong>Media readiness</strong><span>${Number(imageHealth.withImages || 0)} supplier images · ${Number(imageHealth.fallbackOnly || 0)} generated</span></div>
        <div><strong>${Number(imageHealth.missingImages || 0)}</strong><span>missing</span></div>
      </div>
      <div class="metric-row">
        <div><strong>Inventory value</strong><span>${money(analytics.inventoryValue || 0)} cost basis</span></div>
        <div><strong>${money(analytics.marginValue || 0)}</strong><span>gross margin</span></div>
      </div>
      <div class="metric-row">
        <div><strong>Pricing protection</strong><span>${Number(pricingHealth.protected || 0)} AI-priced · ${Number(pricingHealth.hardToFind || 0)} hard-to-find at 50%</span></div>
        <div><strong>${Number(pricingHealth.underpriced || 0)}</strong><span>underpriced</span></div>
      </div>
      <div class="metric-row">
        <div><strong>Status mix</strong><span>${escapeHtml(statusText)}</span></div>
      </div>
    `;
  }

  async function loadProducts() {
    const data = await api.get('/products', { limit: 1200, currency: 'USD' });
    state.products = data.items || [];
    renderProductFilters();
    renderProducts();
  }

  function renderProductFilters() {
    fillSelect('adminCollectionFilter', uniqueProductValues('collection', 'MAT Signature'), state.productCollection, 'All collections');
    fillSelect('adminSupplierFilter', uniqueProductValues('supplierName', 'MAT STORE'), state.productSupplier, 'All sources');
    fillSelect('adminProductStatusFilter', uniqueProductValues('status', 'active'), state.productStatus, 'All statuses');
  }

  function getFilteredProducts() {
    const query = state.productQuery.toLowerCase();
    return state.products.filter((product) => {
      const haystack = [
        product.title,
        product.category,
        product.collection,
        product.sku,
        product.supplierName,
        product.supplierProductCode,
        product.status
      ].join(' ').toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCollection = state.productCollection === 'all' || product.collection === state.productCollection;
      const matchesSupplier = state.productSupplier === 'all' || (product.supplierName || 'MAT STORE') === state.productSupplier;
      const matchesStatus = state.productStatus === 'all' || (product.status || 'active') === state.productStatus;
      return matchesQuery && matchesCollection && matchesSupplier && matchesStatus;
    });
  }

  function renderProducts() {
    const table = document.getElementById('adminProductsTable');
    if (!table) return;
    const products = getFilteredProducts();
    const visibleProducts = products.slice(0, state.productVisible);
    const productCount = document.getElementById('adminProductCount');
    const showMore = document.getElementById('adminProductShowMore');
    if (productCount) {
      productCount.textContent = `Showing ${visibleProducts.length} of ${products.length} products`;
    }
    if (showMore) {
      showMore.hidden = visibleProducts.length >= products.length;
      showMore.textContent = `Show ${Math.min(PRODUCT_BATCH_SIZE, products.length - visibleProducts.length)} More`;
    }

    table.innerHTML = products.length
      ? `
          <div class="admin-table-summary">
            <strong>${visibleProducts.length} visible</strong>
            <span>${state.products.length} catalog products · filters keep duplicate-safe rows manageable.</span>
          </div>
        ` + visibleProducts
          .map(
            (product) => {
              const pricing = pricingSummary(product);
              const pricingClass = pricing.protected ? 'price-stack protected' : 'price-stack warning';
              return `
              <article class="table-row">
                <div class="table-title">
                  <img ${imageAttrs(productImage(product), productFallback(product))} alt="${escapeHtml(product.title)}">
                  <div>
                    <strong>${escapeHtml(product.title)}</strong>
                    <span>${escapeHtml(product.category)} · ${escapeHtml(product.collection || 'MAT Signature')} · ${escapeHtml(product.sku)}</span>
                    <span>${escapeHtml(product.supplierName || 'MAT STORE')} · ${escapeHtml(product.supplierProductCode || 'manual')}</span>
                  </div>
                </div>
                <span class="${pricingClass}"><strong>MAT ${money(product.price)}</strong><small>Supplier ${money(product.supplierPrice)}</small></span>
                <span class="${pricingClass}"><strong>${money(pricing.grossProfit)}</strong><small>${Number(pricing.marginPercent || 0).toFixed(1)}% margin</small></span>
                <span>Stock ${product.stock}</span>
                <span>${Number(product.markupPercent || 0).toFixed(1)}%</span>
                <span class="${productStatusClass(product.status)}">${escapeHtml(product.status || 'active')}</span>
                <div class="row-actions">
                  <a href="/product.html?id=${encodeURIComponent(product.slug || product.id)}">View</a>
                  <button type="button" data-edit-product="${product.id}">Edit</button>
                  <button class="danger-action" type="button" data-delete-product="${product.id}">Delete</button>
                </div>
              </article>
            `;
            }
          )
          .join('')
      : '<div class="empty-state">No products yet.</div>';
  }

  async function loadOrders() {
    const data = await api.get('/orders');
    state.orders = data.orders || [];
    const table = document.getElementById('adminOrders');
    if (!table) return;
    table.innerHTML = state.orders.length
      ? state.orders
          .map(
            (order) => `
              <article class="table-row">
                <div>
                  <strong>${escapeHtml(order.orderNumber)}</strong>
                  <span>${escapeHtml(order.customer?.email)} · ${new Date(order.createdAt).toLocaleDateString()}</span>
                </div>
                <span>${money(order.totals?.total)}</span>
                <span>${escapeHtml(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)}</span>
                <span>${escapeHtml(order.fulfillmentStatus)}</span>
                <div class="row-actions">
                  <button type="button" data-order-status="${order.id}" data-status="processing">Process</button>
                  <button type="button" data-order-status="${order.id}" data-status="delivered">Deliver</button>
                </div>
              </article>
            `
          )
          .join('')
      : '<div class="empty-state">Orders appear after checkout.</div>';
  }

  async function loadCustomers() {
    const data = await api.get('/admin/customers');
    state.customers = data.customers || [];
    const table = document.getElementById('adminCustomers');
    if (!table) return;
    table.innerHTML = state.customers.length
      ? state.customers
          .map(
            (customer) => `
              <article class="table-row">
                <div>
                  <strong>${escapeHtml(customer.name)}</strong>
                  <span>${escapeHtml(customer.email)}</span>
                </div>
                <span>${escapeHtml(customer.role)}</span>
                <span>${escapeHtml(customer.country || 'US')}</span>
                <span>${escapeHtml(customer.currency || 'USD')}</span>
                <span>${new Date(customer.createdAt).toLocaleDateString()}</span>
              </article>
            `
          )
          .join('')
      : '<div class="empty-state">Customer profiles appear after registration.</div>';
  }

  async function loadAbandoned() {
    const data = await api.get('/cart/abandoned');
    const container = document.getElementById('abandonedCarts');
    if (!container) return;
    container.innerHTML = (data.carts || []).length
      ? data.carts
          .map(
            (cart) => `
              <div class="list-row">
                <strong>${cart.itemCount} items · ${money(cart.estimatedValue)}</strong>
                <span>${escapeHtml(cart.recoveryChannel)} · ${escapeHtml(cart.status)}</span>
              </div>
            `
          )
          .join('')
      : '<div class="empty-state">Recovery queue is clear.</div>';
  }

  async function previewImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const links = form.url.value.trim();
    const markupPercent = Number(form.markupPercent.value || 40);
    const stock = Number(form.stock?.value || 24);
    const imageUrl = form.imageUrl?.value.trim() || '';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      state.importOptions = { imageUrl, stock, markupPercent, links };
      const data = await api.post('/importer/preview', {
        links,
        imageUrl,
        stock,
        markupPercent
      });
      state.preview = (data.products || [data.product])
        .filter(Boolean)
        .map((product) => ({
          ...product,
          markupPercent,
          stock
        }));
      renderImportPreview();
      document.getElementById('confirmImportButton').disabled = !state.preview.length;
      toast(`${state.preview.length} AI import preview${state.preview.length === 1 ? '' : 's'} ready.`);
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  function renderImportPreview() {
    const target = document.getElementById('importPreview');
    const products = Array.isArray(state.preview) ? state.preview : [state.preview].filter(Boolean);
    if (!target || !products.length) return;
    const summary = `
      <div class="import-summary">
        <strong>${products.length} product${products.length === 1 ? '' : 's'} ready</strong>
        <span>${products.length > 1 ? 'Collection import detected. Publishing will add every parsed product to MAT STORE.' : 'Preview verified and ready to publish.'}</span>
      </div>
    `;
    target.innerHTML = summary + products
      .map(
        (product, index) => {
          const image = productImage(product);
          const fallback = productFallback(product);
          const imageLabel = product.imageStatus === 'supplier-image'
            ? 'Supplier image ready'
            : product.imageStatus === 'external-image'
              ? 'Override image ready'
              : 'Luxury fallback image';
          const pricing = pricingSummary(product);
          return `
          <article class="import-preview-card">
            <div class="import-media-frame">
              <img ${imageAttrs(image, fallback)} alt="${escapeHtml(product.title)}" loading="lazy">
            </div>
            <div class="preview-chip-row">
              <span>${escapeHtml(imageLabel)}</span>
              <span>${escapeHtml(product.mediaConfidence || 'ready')}</span>
              <span>${Number(product.imageCandidateCount || 0)} media candidate${Number(product.imageCandidateCount || 0) === 1 ? '' : 's'}</span>
              <span>${Number(product.stock || 0)} in stock</span>
            </div>
            <p class="eyebrow">${escapeHtml(product.supplierName)} · ${escapeHtml(product.category)}</p>
            <h2>${escapeHtml(product.title)}</h2>
            <p>${escapeHtml(product.description)}</p>
            <div class="list-row">
              <strong>Supplier ${money(product.supplierPrice)} · MAT ${money(product.price)}</strong>
              <span>${money(pricing.grossProfit)} profit · ${Number(pricing.marginPercent || 0).toFixed(1)}% margin · ${escapeHtml(product.supplierProductCode || 'product link')}</span>
            </div>
            <div class="pricing-intelligence">
              <strong>${escapeHtml(pricing.strategy)}</strong>
              <span>Standard products use 40% markup. Hard-to-find products use 50%, with fee and risk reserves tracked inside gross margin.</span>
            </div>
            <span class="source-link">Image source: ${escapeHtml(product.imageSource || 'MAT STORE media system')}</span>
            ${product.supplierImageUrl ? `<a class="source-link" href="${escapeHtml(product.supplierImageUrl)}" target="_blank" rel="noopener noreferrer">Supplier image URL</a>` : ''}
            <a class="source-link" href="${escapeHtml(product.originalUrl || product.sourceUrl)}" target="_blank" rel="noopener noreferrer">Pasted link ${index + 1}: ${escapeHtml(product.originalUrl || product.sourceUrl)}</a>
            ${product.resolvedUrl && product.resolvedUrl !== product.originalUrl ? `<a class="source-link" href="${escapeHtml(product.resolvedUrl)}" target="_blank" rel="noopener noreferrer">Resolved link: ${escapeHtml(product.resolvedUrl)}</a>` : ''}
            <a class="source-link" href="${escapeHtml(product.sourceUrl)}" target="_blank" rel="noopener noreferrer">Clean import link: ${escapeHtml(product.sourceUrl)}</a>
          </article>
        `;
        }
      )
      .join('');
  }

  async function confirmImport() {
    const products = Array.isArray(state.preview) ? state.preview : [state.preview].filter(Boolean);
    if (!products.length) return;
    const button = document.getElementById('confirmImportButton');
    button.disabled = true;
    try {
      await api.post('/importer/import', {
        links: state.importOptions.links || products.map((product) => product.sourceUrl).join('\n'),
        options: {
          imageUrl: state.importOptions.imageUrl || '',
          stock: Number.isFinite(state.importOptions.stock) ? state.importOptions.stock : products[0].stock || 24,
          markupPercent: products[0].markupPercent
        },
        overrides: {
          markupPercent: products[0].markupPercent,
          stock: Number.isFinite(state.importOptions.stock) ? state.importOptions.stock : products[0].stock || 24
        }
      });
      state.preview = [];
      state.importOptions = {};
      document.getElementById('importPreview').innerHTML = '<div class="empty-state">Products published to MAT STORE.</div>';
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast(`${products.length} product${products.length === 1 ? '' : 's'} published.`);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value ?? '';
  }

  function getInputValue(id) {
    return document.getElementById(id)?.value || '';
  }

  function fillProductForm(product) {
    setInputValue('productId', product?.id || '');
    setInputValue('productTitle', product?.title || '');
    setInputValue('productCategory', product?.category || '');
    setInputValue('productCollection', product?.collection || 'MAT Signature');
    setInputValue('productSupplierName', product?.supplierName || 'MAT STORE');
    setInputValue('productSupplierUrl', product?.supplierUrl || '');
    setInputValue('productStatus', product?.status || 'active');
    setInputValue('productSupplierPrice', product?.supplierPrice || '');
    setInputValue('productPrice', product?.price || '');
    setInputValue('productMarkupPercent', product?.markupPercent || 40);
    setInputValue('productStock', product?.stock || '');
    setInputValue('productLowStockThreshold', product?.lowStockThreshold || 6);
    setInputValue('productImage', product?.images?.[0] || product?.supplierImageUrl || '');
    setInputValue('productDescription', product?.description || '');
  }

  async function saveProduct(event) {
    event.preventDefault();
    const id = getInputValue('productId');
    const category = getInputValue('productCategory');
    const payload = {
      title: getInputValue('productTitle'),
      category,
      collection: getInputValue('productCollection') || 'MAT Signature',
      supplierName: getInputValue('productSupplierName') || 'MAT STORE',
      supplierUrl: getInputValue('productSupplierUrl'),
      status: getInputValue('productStatus') || 'active',
      supplierPrice: Number(getInputValue('productSupplierPrice')),
      price: Number(getInputValue('productPrice')),
      markupPercent: Number(getInputValue('productMarkupPercent') || 40),
      stock: Number(getInputValue('productStock')),
      lowStockThreshold: Number(getInputValue('productLowStockThreshold') || 6),
      description: getInputValue('productDescription'),
      images: [getInputValue('productImage')].filter(Boolean),
      tags: category.split(',').map((item) => item.trim()).filter(Boolean),
      features: ['Admin-curated product', 'Secure checkout ready', 'SEO-ready listing']
    };
    try {
      if (id) await api.put(`/products/${id}`, payload);
      else await api.post('/products', payload);
      fillProductForm(null);
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast('Product saved.');
    } catch (error) {
      toast(error.message);
    }
  }

  async function deleteProduct(id) {
    const product = state.products.find((item) => item.id === id);
    const confirmed = window.confirm(`Permanently delete "${product?.title || 'this product'}" from MAT STORE?`);
    if (!confirmed) return;
    try {
      await api.delete(`/products/${id}`);
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast('Product deleted.');
    } catch (error) {
      toast(error.message);
    }
  }

  async function applyBulkMarkup() {
    const markupPercent = Number(document.getElementById('bulkMarkupInput').value || 40);
    try {
      await api.patch('/products/bulk/markup', { markupPercent });
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast('Bulk markup applied.');
    } catch (error) {
      toast(error.message);
    }
  }

  async function cleanupDuplicates() {
    const confirmed = window.confirm('Clean duplicate product rows and keep one visible listing per supplier product?');
    if (!confirmed) return;
    const button = document.getElementById('cleanupDuplicatesButton');
    if (button) button.disabled = true;
    try {
      const result = await api.post('/admin/products/cleanup-duplicates', {});
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast(`Duplicate cleanup complete. Removed ${result.removed || 0} product${Number(result.removed || 0) === 1 ? '' : 's'}.`);
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function repairPricing() {
    const confirmed = window.confirm('Recalculate all product prices with AI business pricing? Standard products use 40% markup and hard-to-find products use 50% markup.');
    if (!confirmed) return;
    const button = document.getElementById('repairPricingButton');
    if (button) button.disabled = true;
    try {
      const markupPercent = Number(document.getElementById('bulkMarkupInput')?.value || 40);
      const result = await api.post('/admin/products/repair-pricing', { markupPercent });
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast(`AI pricing repaired ${result.updated || 0} product${Number(result.updated || 0) === 1 ? '' : 's'}.`);
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function repairImages() {
    const confirmed = window.confirm('Repair weak product images and remove generated category rows that cannot have real product photos?');
    if (!confirmed) return;
    const button = document.getElementById('imageAuditButton');
    if (button) button.disabled = true;
    try {
      const result = await api.post('/admin/products/repair-images', { limit: 120 });
      await Promise.all([loadProducts(), loadDashboard()]);
      window.MATApp?.reloadProducts();
      toast(`Image repair complete. Repaired ${result.repaired || 0}, removed ${result.removed || 0}.`);
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function updateOrderStatus(id, status) {
    try {
      await api.patch(`/orders/${id}`, {
        fulfillmentStatus: status,
        paymentStatus: status === 'delivered' ? 'paid' : 'pending',
        message: `Marked ${status} from admin dashboard.`
      });
      await Promise.all([loadOrders(), loadDashboard()]);
      toast('Order updated.');
    } catch (error) {
      toast(error.message);
    }
  }

  async function runTool(kind) {
    const output = document.getElementById('automationOutput');
    output.innerHTML = '<div class="skeleton"></div>';
    try {
      const endpoint = kind === 'seo' ? '/admin/seo/audit' : kind === 'image' ? '/admin/images/audit' : '/admin/inventory/sync';
      const data = kind === 'inventory' ? await api.post(endpoint, {}) : await api.get(endpoint);
      const items = data.items || data.lowStock || [];
      output.innerHTML = items.length
        ? items
            .slice(0, 20)
            .map(
              (item) => `
                <div class="list-row">
                  <strong>${escapeHtml(item.title || item.id || item.message || 'Result')}</strong>
                  <span>${escapeHtml(item.missing?.join(', ') || item.action || item.status || `${item.stock || 0} units`)}</span>
                </div>
              `
            )
            .join('')
        : `<div class="empty-state">${escapeHtml(data.message || 'No issues found.')}</div>`;
    } catch (error) {
      output.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  function bind() {
    document.getElementById('adminOpenButton')?.addEventListener('click', openAdmin);
    document.getElementById('heroImportTeaser')?.addEventListener('click', () => {
      const user = window.MATAuth?.getUser();
      if (user?.role === 'admin') openAdmin();
      else window.MATAuth?.openAuth('login');
    });
    document.getElementById('adminExitButton')?.addEventListener('click', closeAdmin);
    document.getElementById('adminLogoutButton')?.addEventListener('click', logoutAdmin);
    document.getElementById('adminRefreshButton')?.addEventListener('click', loadAll);
    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.addEventListener('click', () => setPanel(button.dataset.adminTab));
    });
    document.getElementById('importPreviewForm')?.addEventListener('submit', previewImport);
    document.getElementById('confirmImportButton')?.addEventListener('click', confirmImport);
    document.getElementById('productForm')?.addEventListener('submit', saveProduct);
    document.getElementById('resetProductForm')?.addEventListener('click', () => fillProductForm(null));
    document.getElementById('bulkMarkupButton')?.addEventListener('click', applyBulkMarkup);
    document.getElementById('cleanupDuplicatesButton')?.addEventListener('click', cleanupDuplicates);
    document.getElementById('repairPricingButton')?.addEventListener('click', repairPricing);
    document.getElementById('adminProductShowMore')?.addEventListener('click', () => {
      state.productVisible += PRODUCT_BATCH_SIZE;
      renderProducts();
    });
    document.getElementById('adminProductSearch')?.addEventListener('input', (event) => {
      state.productQuery = event.target.value.trim();
      state.productVisible = PRODUCT_BATCH_SIZE;
      renderProducts();
    });
    document.getElementById('adminCollectionFilter')?.addEventListener('change', (event) => {
      state.productCollection = event.target.value;
      state.productVisible = PRODUCT_BATCH_SIZE;
      renderProducts();
    });
    document.getElementById('adminSupplierFilter')?.addEventListener('change', (event) => {
      state.productSupplier = event.target.value;
      state.productVisible = PRODUCT_BATCH_SIZE;
      renderProducts();
    });
    document.getElementById('adminProductStatusFilter')?.addEventListener('change', (event) => {
      state.productStatus = event.target.value;
      state.productVisible = PRODUCT_BATCH_SIZE;
      renderProducts();
    });
    document.getElementById('seoAuditButton')?.addEventListener('click', () => runTool('seo'));
    document.getElementById('imageAuditButton')?.addEventListener('click', repairImages);
    document.getElementById('inventorySyncButton')?.addEventListener('click', () => runTool('inventory'));

    document.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-product]');
      const deleteButton = event.target.closest('[data-delete-product]');
      const statusButton = event.target.closest('[data-order-status]');
      if (editButton) {
        const product = state.products.find((item) => item.id === editButton.dataset.editProduct);
        fillProductForm(product);
        setPanel('products');
      }
      if (deleteButton) deleteProduct(deleteButton.dataset.deleteProduct);
      if (statusButton) updateOrderStatus(statusButton.dataset.orderStatus, statusButton.dataset.status);
    });
  }

  function init() {
    bindImageFallbacks();
    bind();
  }

  window.MATAdmin = {
    init,
    openAdmin,
    closeAdmin,
    loadAll
  };
})();
