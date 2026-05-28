(function () {
  const api = window.MATApi;
  const storage = window.localStorage;
  const state = {
    items: [],
    promoCode: '',
    products: new Map(),
    currency: storage.getItem('mat_currency') || 'USD'
  };

  function save() {
    storage.setItem(
      'mat_cart',
      JSON.stringify({
        items: state.items,
        promoCode: state.promoCode
      })
    );
  }

  function load() {
    try {
      const saved = JSON.parse(storage.getItem('mat_cart') || '{}');
      state.items = Array.isArray(saved.items) ? saved.items : [];
      state.promoCode = saved.promoCode || '';
    } catch {
      state.items = [];
      state.promoCode = '';
    }
  }

  function currency() {
    return storage.getItem('mat_currency') || state.currency || 'USD';
  }

  function formatMoney(value, code = currency()) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'JPY' ? 0 : 2
    }).format(Number(value || 0));
  }

  function snapshot(product, variant = '') {
    const pricedProduct = window.MATVariantPricing?.apply ? window.MATVariantPricing.apply(product, variant) : product;
    return {
      id: pricedProduct.id,
      title: pricedProduct.title,
      image: pricedProduct.images?.[0] || pricedProduct.image || '',
      price: Number(pricedProduct.price || 0),
      displayPrice: Number(pricedProduct.displayPrice || pricedProduct.price || 0),
      formattedPrice: pricedProduct.formattedPrice || formatMoney(pricedProduct.displayPrice || pricedProduct.price),
      currency: pricedProduct.displayCurrency || currency(),
      selectedVariantPricing: pricedProduct.selectedVariantPricing || null
    };
  }

  function setProducts(products) {
    state.products = new Map((products || []).map((product) => [product.id, product]));
    state.items = state.items.map((item) => {
      const product = state.products.get(item.productId);
      return product ? { ...item, snapshot: snapshot(product, item.variant) } : item;
    });
    save();
    render();
  }

  function add(product, quantity = 1, variant = '') {
    const productId = typeof product === 'string' ? product : product.id;
    const productData = typeof product === 'string' ? state.products.get(productId) : product;
    const existing = state.items.find((item) => item.productId === productId && item.variant === variant);
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + quantity);
      if (productData) existing.snapshot = snapshot(productData, variant);
    } else {
      state.items.push({
        productId,
        quantity,
        variant,
        snapshot: productData ? snapshot(productData, variant) : null
      });
    }
    save();
    render();
    sync();
    window.MATApp?.toast('Added to cart.');
  }

  function remove(productId, variant = '') {
    state.items = state.items.filter((item) => item.productId !== productId || item.variant !== variant);
    save();
    render();
    sync();
  }

  function updateQuantity(productId, variant, quantity) {
    const item = state.items.find((entry) => entry.productId === productId && entry.variant === variant);
    if (!item) return;
    item.quantity = Math.max(1, Math.min(99, Number(quantity || 1)));
    save();
    render();
    sync();
  }

  function totals() {
    const subtotal = state.items.reduce((sum, item) => sum + Number(item.snapshot?.displayPrice || 0) * item.quantity, 0);
    const shipping = subtotal > 150 || subtotal === 0 ? 0 : 9.95;
    const tax = subtotal * 0.07;
    const discountRate = state.promoCode === 'MAT10' ? 0.1 : state.promoCode === 'VIP15' ? 0.15 : 0;
    const discount = subtotal * discountRate;
    return {
      subtotal,
      shipping,
      tax,
      discount,
      total: Math.max(0, subtotal + shipping + tax - discount)
    };
  }

  function render() {
    const cartCount = document.getElementById('cartCount');
    const count = state.items.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) cartCount.textContent = String(count);

    const itemsContainer = document.getElementById('cartItems');
    if (itemsContainer) {
      if (!state.items.length) {
        itemsContainer.innerHTML = '<div class="empty-state">Your cart is ready for a premium find.</div>';
      } else {
        itemsContainer.innerHTML = state.items
          .map((item) => {
            const product = item.snapshot || {};
            return `
              <article class="cart-item">
                <img src="${product.image || '/assets/icons/favicon.svg'}" alt="${escapeHtml(product.title || 'Product')}">
                <div>
                  <h3>${escapeHtml(product.title || 'MAT STORE Product')}</h3>
                  <p>${formatMoney(product.displayPrice || 0)} ${item.variant ? `· ${escapeHtml(item.variant)}` : ''}</p>
                  <div class="quantity-stepper" aria-label="Quantity controls">
                    <button type="button" data-qty-minus="${item.productId}" data-variant="${escapeHtml(item.variant)}">-</button>
                    <span>${item.quantity}</span>
                    <button type="button" data-qty-plus="${item.productId}" data-variant="${escapeHtml(item.variant)}">+</button>
                  </div>
                </div>
                <button class="remove-cart-item" type="button" data-remove-cart="${item.productId}" data-variant="${escapeHtml(item.variant)}" aria-label="Remove item">×</button>
              </article>
            `;
          })
          .join('');
      }
    }

    const promoCode = document.getElementById('promoCode');
    if (promoCode && promoCode.value !== state.promoCode) promoCode.value = state.promoCode;

    renderTotals(document.getElementById('cartTotals'));
    renderTotals(document.getElementById('checkoutSummary'));
  }

  function renderTotals(container) {
    if (!container) return;
    const total = totals();
    container.innerHTML = `
      <div><span>Subtotal</span><strong>${formatMoney(total.subtotal)}</strong></div>
      <div><span>Shipping</span><strong>${total.shipping ? formatMoney(total.shipping) : 'Included'}</strong></div>
      <div><span>Estimated tax</span><strong>${formatMoney(total.tax)}</strong></div>
      <div><span>Promo</span><strong>${total.discount ? `-${formatMoney(total.discount)}` : 'None'}</strong></div>
      <div><span>Total</span><strong>${formatMoney(total.total)}</strong></div>
    `;
  }

  async function sync() {
    try {
      await api.post('/cart', {
        sessionId: api.getSessionId(),
        currency: currency(),
        promoCode: state.promoCode,
        items: state.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          variant: item.variant
        }))
      });
    } catch {
      // Cart remains local if the API is temporarily unreachable.
    }
  }

  function openCart() {
    document.getElementById('cartDrawer')?.classList.add('is-open');
    document.getElementById('cartDrawer')?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeCart() {
    document.getElementById('cartDrawer')?.classList.remove('is-open');
    document.getElementById('cartDrawer')?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function openCheckout() {
    if (!state.items.length) {
      window.MATApp?.toast('Add a product before checkout.');
      return;
    }
    closeCart();
    renderTotals(document.getElementById('checkoutSummary'));
    document.getElementById('checkoutModal').showModal();
    document.body.classList.add('modal-open');
  }

  function closeCheckout() {
    const modal = document.getElementById('checkoutModal');
    if (modal.open) modal.close();
    document.body.classList.remove('modal-open');
  }

  async function submitCheckout(event) {
    event.preventDefault();
    if (!state.items.length) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;

    try {
      const payload = {
        sessionId: api.getSessionId(),
        currency: currency(),
        promoCode: state.promoCode,
        paymentMethod: data.paymentMethod,
        customer: {
          name: data.name,
          email: data.email,
          phone: data.phone
        },
        shippingAddress: {
          name: data.name,
          line1: data.line1,
          city: data.city,
          region: data.region,
          postalCode: data.postalCode,
          country: data.country
        },
        items: state.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          variant: item.variant
        }))
      };
      const result = await api.post('/orders', payload);
      state.items = [];
      state.promoCode = '';
      save();
      render();
      closeCheckout();
      window.MATApp?.reloadProducts();

      const handoff = result.payment || {};
      const url = handoff.checkoutUrl || handoff.approvalUrl || handoff.whatsappUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      window.MATApp?.toast(`Order ${result.order.orderNumber} created.`);
    } catch (error) {
      window.MATApp?.toast(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
      return map[char];
    });
  }

  function bind() {
    document.getElementById('cartButton')?.addEventListener('click', openCart);
    document.querySelectorAll('[data-close-cart]').forEach((button) => button.addEventListener('click', closeCart));
    document.getElementById('checkoutButton')?.addEventListener('click', openCheckout);
    document.querySelector('[data-close-checkout]')?.addEventListener('click', closeCheckout);
    document.getElementById('checkoutForm')?.addEventListener('submit', submitCheckout);
    document.getElementById('promoForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.promoCode = document.getElementById('promoCode').value.trim().toUpperCase();
      save();
      render();
      sync();
      window.MATApp?.toast(state.promoCode ? `${state.promoCode} applied.` : 'Promo cleared.');
    });
    document.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-cart]');
      const minusButton = event.target.closest('[data-qty-minus]');
      const plusButton = event.target.closest('[data-qty-plus]');
      if (removeButton) remove(removeButton.dataset.removeCart, removeButton.dataset.variant || '');
      if (minusButton) {
        const item = state.items.find((entry) => entry.productId === minusButton.dataset.qtyMinus && entry.variant === (minusButton.dataset.variant || ''));
        if (item) updateQuantity(item.productId, item.variant, item.quantity - 1);
      }
      if (plusButton) {
        const item = state.items.find((entry) => entry.productId === plusButton.dataset.qtyPlus && entry.variant === (plusButton.dataset.variant || ''));
        if (item) updateQuantity(item.productId, item.variant, item.quantity + 1);
      }
    });
  }

  function init() {
    load();
    bind();
    render();
    sync();
  }

  window.MATCart = {
    init,
    add,
    remove,
    updateQuantity,
    setProducts,
    openCart,
    closeCart,
    render,
    totals,
    items: () => [...state.items],
    formatMoney
  };
})();
