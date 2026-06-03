(function () {
  const state = {
    installPrompt: null,
    button: null
  };

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  }

  function ensureInstallButton() {
    if (state.button || isStandalone()) return state.button;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pwa-install-button';
    button.textContent = 'Install App';
    button.hidden = true;
    button.setAttribute('aria-label', 'Install MAT STORE app');
    button.addEventListener('click', async () => {
      if (!state.installPrompt) return;
      button.disabled = true;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice.catch(() => null);
      state.installPrompt = null;
      button.hidden = true;
      button.disabled = false;
    });
    document.body.appendChild(button);
    state.button = button;
    return button;
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      // The site still works normally if the browser blocks service workers.
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    const button = ensureInstallButton();
    if (button) button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    if (state.button) state.button.hidden = true;
  });

  function init() {
    registerServiceWorker();
    ensureInstallButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
