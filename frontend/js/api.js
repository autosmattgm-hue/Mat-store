(function () {
  const storage = window.localStorage;
  const apiBase = '/api';
  const getCache = new Map();
  const PUBLIC_GET_CACHE_TTL_MS = 15000;
  const PUBLIC_GET_CACHE_MAX = 80;

  function cloneData(data) {
    return data === undefined ? data : JSON.parse(JSON.stringify(data));
  }

  function isPublicGetCacheable(path) {
    return /^\/(?:products(?:[/?#]|$)|currencies(?:[/?#]|$)|settings\/public(?:[/?#]|$)|auth\/currencies(?:[/?#]|$))/.test(path);
  }

  function cachedGet(key) {
    const cached = getCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      getCache.delete(key);
      return null;
    }
    return cloneData(cached.data);
  }

  function setCachedGet(key, data) {
    if (!getCache.has(key) && getCache.size >= PUBLIC_GET_CACHE_MAX) {
      getCache.delete(getCache.keys().next().value);
    }
    getCache.set(key, {
      data: cloneData(data),
      expiresAt: Date.now() + PUBLIC_GET_CACHE_TTL_MS
    });
  }

  function clearGetCache() {
    getCache.clear();
  }

  function getSessionId() {
    let sessionId = storage.getItem('mat_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      storage.setItem('mat_session_id', sessionId);
    }
    return sessionId;
  }

  function getAccessToken() {
    return storage.getItem('mat_access_token') || '';
  }

  function getRefreshToken() {
    return storage.getItem('mat_refresh_token') || '';
  }

  function setTokens(accessToken, refreshToken) {
    if (accessToken) storage.setItem('mat_access_token', accessToken);
    if (refreshToken) storage.setItem('mat_refresh_token', refreshToken);
  }

  function clearTokens() {
    storage.removeItem('mat_access_token');
    storage.removeItem('mat_refresh_token');
    storage.removeItem('mat_user');
  }

  function setUser(user) {
    if (user) storage.setItem('mat_user', JSON.stringify(user));
    else storage.removeItem('mat_user');
    window.dispatchEvent(new CustomEvent('mat:user', { detail: user }));
  }

  function getUser() {
    try {
      return JSON.parse(storage.getItem('mat_user') || 'null');
    } catch {
      return null;
    }
  }

  async function parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = body?.error?.message || body?.message || response.statusText || 'Request failed.';
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async function refreshSession() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
      clearTokens();
      setUser(null);
      return false;
    }
    const data = await response.json();
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    return true;
  }

  async function request(path, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const method = String(options.method || 'GET').toUpperCase();
    const cacheKey = `${method}:${path}`;
    const canUseCache = method === 'GET' && !token && isPublicGetCacheable(path);
    if (canUseCache) {
      const cached = cachedGet(cacheKey);
      if (cached) return cached;
    }

    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }

    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers,
      body
    });

    if (response.status === 401 && retry && (await refreshSession())) {
      return request(path, options, false);
    }

    const data = await parseResponse(response);
    if (canUseCache) setCachedGet(cacheKey, data);
    if (method !== 'GET') clearGetCache();
    return data;
  }

  function query(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    const value = search.toString();
    return value ? `?${value}` : '';
  }

  window.MATApi = {
    getSessionId,
    setTokens,
    clearTokens,
    setUser,
    getUser,
    request,
    query,
    get: (path, params) => request(`${path}${query(params)}`),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    refreshSession
  };

  function loadAgent() {
    if (document.querySelector('script[data-mat-agent]')) return;
    const script = document.createElement('script');
    script.src = '/js/agent.js';
    script.defer = true;
    script.dataset.matAgent = 'true';
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAgent, { once: true });
  } else {
    loadAgent();
  }
})();
