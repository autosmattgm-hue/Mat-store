(function () {
  function showToast(message) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function openConcierge(prompt, mode) {
    const attempt = () => {
      const launcher = document.getElementById('matAiAgentLauncher');
      const input = document.getElementById('matAiAgentInput');
      const form = document.getElementById('matAiAgentForm');
      if (!launcher || !input || !form) return false;
      const panel = document.getElementById('matAiAgentPanel');
      if (panel?.hidden) launcher.click();
      input.value = prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dataset.homeMode = mode || 'shopper';
      form.requestSubmit();
      return true;
    };
    if (attempt()) return;
    window.setTimeout(() => {
      if (!attempt()) showToast('MAT AI is still loading. Please try again in a moment.');
    }, 500);
  }

  function bindConcierge() {
    document.querySelectorAll('[data-concierge-prompt]').forEach((card) => {
      card.addEventListener('click', () => openConcierge(card.dataset.conciergePrompt, card.dataset.conciergeMode));
    });
  }

  function bindMembership() {
    const form = document.getElementById('membershipForm');
    const status = document.getElementById('membershipStatus');
    if (!form || !status) return;
    const saved = localStorage.getItem('mat_dispatch_email');
    if (saved) status.textContent = `You’re on the edit with ${saved}.`;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = String(new FormData(form).get('email') || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        status.textContent = 'Enter a valid email address to join the edit.';
        return;
      }
      localStorage.setItem('mat_dispatch_email', email);
      status.textContent = `You’re on the list with ${email}. Watch this space for the next edit.`;
      showToast('Saved your MAT Dispatch preference on this device.');
      form.reset();
    });
  }

  function bindTracking() {
    const form = document.getElementById('homeTrackingForm');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const orderNumber = String(new FormData(form).get('orderNumber') || '').trim();
      if (!orderNumber) return;
      window.location.href = `/tracking.html?orderNumber=${encodeURIComponent(orderNumber)}`;
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindConcierge();
    bindMembership();
    bindTracking();
  });
})();
