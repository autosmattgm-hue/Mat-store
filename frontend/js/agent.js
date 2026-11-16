(function () {
  if (window.MATAgentLoaded) return;
  window.MATAgentLoaded = true;

  const api = window.MATApi;
  if (!api) return;

  const storageKey = 'mat_ai_agent_messages';
  const maxHistory = 8;
  const state = {
    open: false,
    busy: false,
    messages: loadMessages()
  };

  function loadMessages() {
    try {
      const messages = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(messages) ? messages.slice(-maxHistory) : [];
    } catch {
      return [];
    }
  }

  function saveMessages() {
    localStorage.setItem(storageKey, JSON.stringify(state.messages.slice(-maxHistory)));
  }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function professionalText(value = '') {
    return String(value || '')
      .replace(/[<>]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''))
      .split('\n')
      .map((line) => line
        .replace(/^\s{0,3}#{1,6}\s*/g, '')
        .replace(/^\s*[-*•]\s+/g, '')
        .replace(/^\s*\d+\.\s+/g, '')
        .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1')
        .replace(/[*#`~]/g, '')
        .replace(/\s+/g, ' ')
        .trim())
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  function currentMode() {
    const user = api.getUser?.();
    return user?.role === 'admin' ? 'business' : 'shopper';
  }

  function pageContext() {
    return {
      page: document.body?.dataset?.page || window.location.pathname,
      path: window.location.pathname,
      query: window.location.search,
      currency: localStorage.getItem('mat_currency') || api.getUser?.()?.currency || 'USD',
      cartItems: window.MATCart?.items?.()?.length || 0
    };
  }

  function addMessage(role, content, suggestions, actions) {
    const message = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content: role === 'assistant' ? professionalText(content) : String(content || '').trim(),
      suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 4) : [],
      actions: Array.isArray(actions) ? actions.slice(0, 3) : []
    };
    state.messages.push(message);
    state.messages = state.messages.slice(-maxHistory);
    saveMessages();
    renderMessages();
  }

  function setOpen(open) {
    state.open = Boolean(open);
    const panel = document.getElementById('matAiAgentPanel');
    const launcher = document.getElementById('matAiAgentLauncher');
    if (!panel || !launcher) return;
    panel.hidden = !state.open;
    launcher.setAttribute('aria-expanded', String(state.open));
    document.body.classList.toggle('ai-agent-open', state.open);
    if (state.open) {
      setTimeout(() => document.getElementById('matAiAgentInput')?.focus(), 80);
      renderMessages();
    }
  }

  function renderSuggestion(parent, item) {
    const link = create('a', 'ai-agent-product');
    link.href = item.url || `/product.html?id=${encodeURIComponent(item.slug || item.id || '')}`;

    const imageWrap = create('span', 'ai-agent-product-image');
    const image = create('img');
    image.src = item.image || '/mat-store.png';
    image.alt = item.title || 'MAT STORE product';
    image.loading = 'lazy';
    imageWrap.appendChild(image);

    const copy = create('span', 'ai-agent-product-copy');
    copy.appendChild(create('strong', '', item.title || 'MAT STORE Product'));
    copy.appendChild(create('span', '', `${item.formattedPrice || ''}${item.category ? ` · ${item.category}` : ''}`));

    link.append(imageWrap, copy);
    parent.appendChild(link);
  }

  function actionLabel(action = {}) {
    return String(action.label || 'Continue with MAT AI').slice(0, 120);
  }

  function renderAction(parent, action) {
    const button = create('button', 'ai-agent-action', actionLabel(action));
    button.type = 'button';
    button.dataset.agentAction = JSON.stringify(action);
    if (action.requiresConfirmation) button.dataset.confirmAction = 'true';
    parent.appendChild(button);
  }

  async function executeAction(action = {}) {
    if (!action || typeof action !== 'object') return;
    if (action.requiresConfirmation && !window.confirm(`MAT AI is ready to ${action.label || 'continue'}. Do you want to proceed?`)) return;
    if (action.type === 'navigate' && typeof action.url === 'string' && action.url.startsWith('/')) {
      window.location.assign(action.url);
      return;
    }
    if (action.type === 'currency' && /^[A-Z]{3}$/.test(String(action.currency || ''))) {
      localStorage.setItem('mat_currency', action.currency);
      const select = document.getElementById('currencySelect');
      if (select) { select.value = action.currency; select.dispatchEvent(new Event('change', { bubbles: true })); }
      window.MATApp?.toast?.(`Prices are now displayed in ${action.currency}.`);
      window.dispatchEvent(new CustomEvent('mat:currency', { detail: action.currency }));
      return;
    }
    if (action.type === 'add_to_cart' && action.productId) {
      try {
        const result = await api.get(`/products/${encodeURIComponent(action.productSlug || action.productId)}`);
        const product = result.product || result;
        if (!product?.id) throw new Error('That product is no longer available.');
        window.MATCart?.add(product, 1);
        window.MATCart?.openCart();
        window.MATApp?.toast?.(`${product.title} added to your cart.`);
      } catch (error) {
        addMessage('assistant', error.message || 'I could not add that item right now.');
      }
    }
  }

  function renderMessages() {
    const list = document.getElementById('matAiAgentMessages');
    if (!list) return;
    list.innerHTML = '';

    if (!state.messages.length) {
      const empty = create('div', 'ai-agent-empty');
      empty.appendChild(create('strong', '', 'Ask MAT AI anything.'));
      empty.appendChild(create('span', '', 'Find products, check value, improve pricing, or plan the next revenue move.'));
      list.appendChild(empty);
      return;
    }

    state.messages.forEach((message) => {
      const row = create('article', `ai-agent-message ${message.role}`);
      row.appendChild(create('p', '', message.content));
      if (message.suggestions?.length) {
        const products = create('div', 'ai-agent-products');
        message.suggestions.forEach((item) => renderSuggestion(products, item));
        row.appendChild(products);
      }
      if (message.actions?.length) {
        const actions = create('div', 'ai-agent-actions');
        message.actions.forEach((action) => renderAction(actions, action));
        row.appendChild(actions);
      }
      list.appendChild(row);
    });

    list.scrollTop = list.scrollHeight;
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    const button = document.getElementById('matAiAgentSend');
    const input = document.getElementById('matAiAgentInput');
    if (button) {
      button.disabled = state.busy;
      button.textContent = state.busy ? 'Thinking' : 'Send';
    }
    if (input) input.disabled = state.busy;
  }

  async function sendMessage(text, mode = currentMode()) {
    const message = String(text || '').trim();
    if (!message || state.busy) return;

    addMessage('user', message);
    setBusy(true);

    try {
      const result = await api.post('/ai/agent', {
        message,
        mode,
        context: pageContext()
      });
      addMessage('assistant', result.reply || 'I am ready to help with MAT STORE.', result.suggestions || [], result.actions || []);
    } catch (error) {
      addMessage('assistant', error.message || 'MAT AI could not answer right now. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  function buildAgent() {
    if (document.getElementById('matAiAgentRoot')) return;

    const root = create('div', 'ai-agent-root');
    root.id = 'matAiAgentRoot';

    const launcher = create('button', 'ai-agent-launcher');
    launcher.id = 'matAiAgentLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-controls', 'matAiAgentPanel');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.appendChild(create('span', 'ai-agent-mark', 'AI'));
    launcher.appendChild(create('span', '', 'MAT AI'));

    const panel = create('aside', 'ai-agent-panel');
    panel.id = 'matAiAgentPanel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'MAT AI');

    const header = create('header', 'ai-agent-header');
    const heading = create('div');
    heading.appendChild(create('span', 'eyebrow', 'Commerce assistant'));
    heading.appendChild(create('h2', '', 'MAT AI'));
    const close = create('button', 'ai-agent-icon', 'x');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close MAT AI');
    header.append(heading, close);

    const chips = create('div', 'ai-agent-chips');
    [
      ['Find a product', 'shopper', 'Find me the best value product for my needs.'],
      ['Improve prices', 'pricing', 'Check MAT STORE pricing and profit rules.'],
      ['Business growth', 'business', 'What should I improve next to make more sales?'],
      ['Catalog advice', 'importer', 'How should I review and publish private MAT STORE catalog products?']
    ].forEach(([label, mode, prompt]) => {
      const chip = create('button', '', label);
      chip.type = 'button';
      chip.dataset.agentPrompt = prompt;
      chip.dataset.agentMode = mode;
      chips.appendChild(chip);
    });

    const messages = create('div', 'ai-agent-messages');
    messages.id = 'matAiAgentMessages';
    messages.setAttribute('aria-live', 'polite');

    const form = create('form', 'ai-agent-form');
    form.id = 'matAiAgentForm';
    const input = create('textarea', 'ai-agent-input');
    input.id = 'matAiAgentInput';
    input.name = 'message';
    input.rows = 2;
    input.maxLength = 1200;
    input.placeholder = 'Ask for products, pricing, or business advice...';
    input.autocomplete = 'off';
    const send = create('button', 'ai-agent-send', 'Send');
    send.id = 'matAiAgentSend';
    send.type = 'submit';
    form.append(input, send);

    panel.append(header, chips, messages, form);
    root.append(launcher, panel);
    document.body.appendChild(root);

    launcher.addEventListener('click', () => setOpen(!state.open));
    close.addEventListener('click', () => setOpen(false));
    chips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-agent-prompt]');
      if (!chip) return;
      sendMessage(chip.dataset.agentPrompt, chip.dataset.agentMode);
    });
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-agent-action]');
      if (!button) return;
      try { executeAction(JSON.parse(button.dataset.agentAction || '{}')); } catch { addMessage('assistant', 'That action could not be prepared. Please try again.'); }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      input.value = '';
      sendMessage(value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });

    renderMessages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildAgent, { once: true });
  } else {
    buildAgent();
  }
})();
