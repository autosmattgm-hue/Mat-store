(function () {
  const api = window.MATApi;
  const state = {
    user: api.getUser(),
    currencies: []
  };

  function toast(message) {
    window.MATApp?.toast(message);
  }

  function openAuth(tab = 'login') {
    const modal = document.getElementById('authModal');
    setAuthTab(tab);
    renderProfile();
    modal.showModal();
    document.body.classList.add('modal-open');
  }

  function closeAuth() {
    const modal = document.getElementById('authModal');
    if (modal.open) modal.close();
    document.body.classList.remove('modal-open');
  }

  function setAuthTab(tab) {
    document.querySelectorAll('[data-auth-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.authTab === tab);
    });
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.authPanel === tab);
    });
  }

  function updateAuthUi() {
    const user = state.user;
    document.querySelectorAll('.admin-only').forEach((element) => {
      element.hidden = user?.role !== 'admin';
    });
    const profileName = document.getElementById('profileName');
    if (profileName) {
      profileName.textContent = user ? `${user.name} · ${user.currency}` : '';
    }
    renderProfile();
  }

  function renderProfile() {
    const profilePanel = document.getElementById('profilePanel');
    const forms = document.querySelectorAll('.auth-form');
    if (!profilePanel) return;
    profilePanel.hidden = !state.user;
    forms.forEach((form) => {
      form.hidden = Boolean(state.user);
    });
    if (!state.user) return;
    const wishlist = document.getElementById('profileWishlist');
    wishlist.innerHTML = `
      <div class="list-row">
        <strong>${state.user.email}</strong>
        <span>${state.user.role === 'admin' ? 'Administrator' : 'Customer'} · ${state.user.country || 'US'} · ${state.user.currency || 'USD'}</span>
        <span>${(state.user.wishlist || []).length} saved products</span>
      </div>
    `;
  }

  async function loadCurrencies() {
    const data = await api.get('/auth/currencies');
    state.currencies = data.supported || [];
    const selects = [document.getElementById('registerCurrency'), document.getElementById('currencySelect')].filter(Boolean);
    selects.forEach((select) => {
      const current = select.value || localStorage.getItem('mat_currency') || state.user?.currency || 'USD';
      select.innerHTML = state.currencies.map((currency) => `<option value="${currency}">${currency}</option>`).join('');
      select.value = state.currencies.includes(current) ? current : 'USD';
    });
  }

  async function hydrateMe() {
    if (!localStorage.getItem('mat_access_token')) {
      updateAuthUi();
      return;
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
    updateAuthUi();
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function handleLogin(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await api.post('/auth/login', formData(event.currentTarget));
      api.setTokens(data.accessToken, data.refreshToken);
      state.user = data.user;
      api.setUser(data.user);
      localStorage.setItem('mat_currency', data.user.currency || 'USD');
      document.getElementById('currencySelect').value = data.user.currency || 'USD';
      updateAuthUi();
      closeAuth();
      window.MATApp?.reloadProducts();
      toast('Welcome back to MAT STORE.');
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const data = formData(event.currentTarget);
    data.marketingOptIn = event.currentTarget.marketingOptIn.checked;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api.post('/auth/register', data);
      api.setTokens(result.accessToken, result.refreshToken);
      state.user = result.user;
      api.setUser(result.user);
      localStorage.setItem('mat_currency', result.user.currency || 'USD');
      document.getElementById('currencySelect').value = result.user.currency || 'USD';
      updateAuthUi();
      closeAuth();
      window.MATApp?.reloadProducts();
      toast('Your MAT STORE account is ready.');
    } catch (error) {
      toast(error.message);
    } finally {
      submit.disabled = false;
    }
  }

  async function handleForgot(event) {
    event.preventDefault();
    try {
      const result = await api.post('/auth/forgot-password', formData(event.currentTarget));
      toast(result.devResetToken ? `Reset prepared. Dev token: ${result.devResetToken}` : result.message);
    } catch (error) {
      toast(error.message);
    }
  }

  async function logout() {
    try {
      await api.post('/auth/logout', { refreshToken: localStorage.getItem('mat_refresh_token') });
    } catch {
      // Local logout still clears stale sessions if the token has expired.
    }
    api.clearTokens();
    state.user = null;
    api.setUser(null);
    updateAuthUi();
    closeAuth();
    toast('Signed out.');
  }

  async function toggleWishlist(productId) {
    if (!state.user) {
      openAuth('login');
      return null;
    }
    const result = await api.post(`/auth/wishlist/${productId}`, {});
    state.user = result.user;
    api.setUser(result.user);
    updateAuthUi();
    return result.user;
  }

  function bind() {
    document.getElementById('profileButton')?.addEventListener('click', () => openAuth(state.user ? 'login' : 'login'));
    document.getElementById('mobileAccountButton')?.addEventListener('click', () => openAuth('login'));
    document.querySelector('[data-close-auth]')?.addEventListener('click', closeAuth);
    document.querySelectorAll('[data-auth-tab]').forEach((button) => {
      button.addEventListener('click', () => setAuthTab(button.dataset.authTab));
    });
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    document.getElementById('forgotForm')?.addEventListener('submit', handleForgot);
    document.getElementById('logoutButton')?.addEventListener('click', logout);
    window.addEventListener('mat:user', (event) => {
      state.user = event.detail;
      updateAuthUi();
    });
  }

  async function init() {
    bind();
    await loadCurrencies();
    await hydrateMe();
  }

  window.MATAuth = {
    init,
    openAuth,
    closeAuth,
    getUser: () => state.user,
    toggleWishlist,
    loadCurrencies
  };
})();
