(function () {
  const api = window.MATApi;
  const state = {
    user: api.getUser(),
    currencies: []
  };

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function toast(message) {
    window.MATApp?.toast(message);
  }

  function setAuthStatus(message = '', tone = 'info') {
    const status = document.getElementById('authStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = !message;
  }

  function setSubmitBusy(form, busy, busyLabel = 'Working...') {
    const submit = form?.querySelector('button[type="submit"]');
    if (!submit) return;
    if (!submit.dataset.defaultLabel) submit.dataset.defaultLabel = submit.textContent;
    submit.disabled = busy;
    submit.textContent = busy ? busyLabel : submit.dataset.defaultLabel;
  }

  function normalizeCountry(value = '') {
    return String(value || 'US').trim().slice(0, 2).toUpperCase() || 'US';
  }

  function passwordScore(value = '') {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (value.length >= 12) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return score;
  }

  function updatePasswordStrength(input, target) {
    if (!input || !target) return;
    const score = passwordScore(input.value);
    const labels = ['Use 8+ characters with letters and numbers.', 'Weak password.', 'Better. Add uppercase, numbers, or symbols.', 'Good password.', 'Strong password.', 'Excellent password.'];
    target.textContent = labels[score] || labels[0];
    target.dataset.strength = String(score);
  }

  function bindPasswordToggles(root = document) {
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

  function openAuth(tab = 'login') {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    setAuthTab(tab);
    setAuthStatus('');
    renderProfile();
    if (!modal.open) modal.showModal();
    document.body.classList.add('modal-open');
  }

  function closeAuth() {
    const modal = document.getElementById('authModal');
    if (modal?.open) modal.close();
    document.body.classList.remove('modal-open');
  }

  function syncAuthPanelVisibility() {
    const tabs = document.querySelector('.auth-tabs');
    const signedIn = Boolean(state.user);
    if (tabs) tabs.hidden = signedIn;
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      panel.hidden = signedIn || !panel.classList.contains('active');
    });
  }

  function setAuthTab(tab) {
    document.querySelectorAll('[data-auth-tab]').forEach((button) => {
      const active = button.dataset.authTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-auth-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.authPanel === tab);
    });
    syncAuthPanelVisibility();
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
    if (!profilePanel) return;
    profilePanel.hidden = !state.user;
    syncAuthPanelVisibility();
    if (!state.user) return;

    const wishlist = document.getElementById('profileWishlist');
    const role = state.user.role === 'admin' ? 'Administrator' : 'Customer';
    if (wishlist) {
      wishlist.innerHTML = `
        <div class="list-row">
          <strong>${escapeHtml(state.user.email)}</strong>
          <span>${role} · ${escapeHtml(state.user.country || 'US')} · ${escapeHtml(state.user.currency || 'USD')}</span>
          <span>${(state.user.wishlist || []).length} saved products · ${(state.user.addresses || []).length} saved addresses</span>
        </div>
      `;
    }
  }

  async function loadCurrencies() {
    try {
      const data = await api.get('/auth/currencies');
      state.currencies = data.supported || [];
    } catch {
      state.currencies = ['USD', 'EUR', 'GBP', 'GMD', 'NGN', 'CAD', 'AED'];
    }
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
    const form = event.currentTarget;
    setSubmitBusy(form, true, 'Signing in...');
    setAuthStatus('Checking your secure session...', 'info');
    try {
      const data = await api.post('/auth/login', formData(form));
      api.setTokens(data.accessToken, data.refreshToken);
      state.user = data.user;
      api.setUser(data.user);
      localStorage.setItem('mat_currency', data.user.currency || 'USD');
      const currencySelect = document.getElementById('currencySelect');
      if (currencySelect) currencySelect.value = data.user.currency || 'USD';
      updateAuthUi();
      closeAuth();
      window.MATApp?.reloadProducts();
      toast('Welcome back to MAT STORE.');
    } catch (error) {
      setAuthStatus(error.message || 'Login failed. Check your email and password.', 'error');
      toast(error.message);
    } finally {
      setSubmitBusy(form, false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formData(form);
    const confirmPassword = data.confirmPassword || '';
    if (data.password !== confirmPassword) {
      setAuthStatus('Passwords do not match.', 'error');
      return;
    }
    if (passwordScore(data.password) < 2) {
      setAuthStatus('Please use a stronger password before creating your account.', 'error');
      return;
    }

    data.country = normalizeCountry(data.country);
    data.marketingOptIn = Boolean(form.marketingOptIn?.checked);
    delete data.confirmPassword;
    setSubmitBusy(form, true, 'Creating...');
    setAuthStatus('Creating your encrypted MAT STORE profile...', 'info');
    try {
      const result = await api.post('/auth/register', data);
      api.setTokens(result.accessToken, result.refreshToken);
      state.user = result.user;
      api.setUser(result.user);
      localStorage.setItem('mat_currency', result.user.currency || 'USD');
      const currencySelect = document.getElementById('currencySelect');
      if (currencySelect) currencySelect.value = result.user.currency || 'USD';
      updateAuthUi();
      closeAuth();
      window.MATApp?.reloadProducts();
      toast('Your MAT STORE account is ready.');
    } catch (error) {
      setAuthStatus(error.message || 'Account creation failed. Try another email.', 'error');
      toast(error.message);
    } finally {
      setSubmitBusy(form, false);
    }
  }

  async function handleForgot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitBusy(form, true, 'Sending...');
    setAuthStatus('Preparing reset instructions...', 'info');
    try {
      const result = await api.post('/auth/forgot-password', formData(form));
      setAuthStatus(result.devResetToken ? `Reset prepared. Dev token: ${result.devResetToken}` : result.message, 'success');
    } catch (error) {
      setAuthStatus(error.message || 'Password reset could not be prepared.', 'error');
      toast(error.message);
    } finally {
      setSubmitBusy(form, false);
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
    document.getElementById('profileButton')?.addEventListener('click', () => openAuth(state.user ? 'profile' : 'login'));
    document.getElementById('mobileAccountButton')?.addEventListener('click', () => openAuth(state.user ? 'profile' : 'login'));
    document.querySelector('[data-close-auth]')?.addEventListener('click', closeAuth);
    document.querySelectorAll('[data-auth-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setAuthStatus('');
        setAuthTab(button.dataset.authTab);
      });
    });
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    document.getElementById('forgotForm')?.addEventListener('submit', handleForgot);
    document.getElementById('logoutButton')?.addEventListener('click', logout);
    document.querySelectorAll('.country-code-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.value = normalizeCountry(input.value);
      });
    });
    const password = document.getElementById('registerPassword');
    const strength = document.getElementById('registerPasswordStrength');
    password?.addEventListener('input', () => updatePasswordStrength(password, strength));
    bindPasswordToggles();
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
