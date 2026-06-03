const config = require('../config');
const { cleanProductTitle } = require('../utils/productTitle');

function fallbackLuxuryCopy(product) {
  const title = cleanProductTitle(product.title || 'Curated MAT STORE Find');
  const category = product.category || 'luxury';

  return {
    title: title.slice(0, 140),
    description:
      product.description ||
      `A carefully sourced ${category} piece refined for MAT STORE customers, selected for elevated everyday style, clean presentation, and dependable store value.`,
    shortDescription: `Luxury-curated ${category} selection with premium MAT STORE presentation.`,
    category: inferCategory(`${title} ${product.description || ''}`),
    tags: ['mat-ai-curated', 'premium', 'mat-store', category].filter(Boolean),
    seoTitle: `${title} | MAT STORE`,
    seoDescription: `Shop ${title} at MAT STORE with secure checkout, curated styling, and premium customer support.`,
    luxuryAngle: 'MAT AI-polished merchandising, elevated imagery, premium pricing, and trust-focused conversion copy.'
  };
}

function inferCategory(text) {
  const value = String(text || '').toLowerCase();
  const rules = [
    ['fashion', ['dress', 'jacket', 'shirt', 'coat', 'denim', 'apparel', 'hoodie']],
    ['electronics', ['phone', 'watch', 'speaker', 'headphone', 'camera', 'laptop', 'charger']],
    ['beauty', ['serum', 'cream', 'perfume', 'skin', 'beauty', 'fragrance']],
    ['accessories', ['bag', 'sunglasses', 'wallet', 'belt', 'jewelry', 'ring']],
    ['shoes', ['shoe', 'sneaker', 'boot', 'heel', 'loafer']],
    ['gadgets', ['smart', 'wireless', 'device', 'portable']],
    ['luxury items', ['gold', 'leather', 'signature', 'atelier', 'premium']]
  ];
  const match = rules.find(([, keywords]) => keywords.some((keyword) => value.includes(keyword)));
  return match ? match[0] : 'trending products';
}

function safeJsonParse(value) {
  try {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function chatCompletion(options = {}) {
  const messages = Array.isArray(options.messages) ? options.messages : [];
  if (!messages.length) {
    return {
      provider: 'local-fallback',
      model: 'local-fallback',
      content: ''
    };
  }

  if (!config.nvidia.apiKey) {
    return {
      provider: 'local-fallback',
      model: 'local-fallback',
      content: ''
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 25000));

  try {
    const response = await fetch(config.nvidia.baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.nvidia.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.model || config.nvidia.model,
        messages,
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.55,
        top_p: Number.isFinite(Number(options.topP)) ? Number(options.topP) : 0.9,
        frequency_penalty: Number.isFinite(Number(options.frequencyPenalty)) ? Number(options.frequencyPenalty) : 0,
        presence_penalty: Number.isFinite(Number(options.presencePenalty)) ? Number(options.presencePenalty) : 0,
        max_tokens: Math.min(1800, Math.max(120, Math.floor(Number(options.maxTokens || 700)))),
        stream: false
      })
    });

    if (!response.ok) {
      return {
        provider: 'mat-ai-fallback',
        model: config.nvidia.model,
        content: '',
        status: response.status
      };
    }

    const data = await response.json();
    return {
      provider: 'mat-ai',
      model: data?.model || config.nvidia.model,
      content: String(data?.choices?.[0]?.message?.content || '').trim(),
      usage: data?.usage || null
    };
  } catch (error) {
    return {
      provider: 'mat-ai-fallback',
      model: config.nvidia.model,
      content: '',
      error: error.name === 'AbortError' ? 'MAT AI request timed out.' : 'MAT AI request failed.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function enhanceProduct(product) {
  if (!config.nvidia.apiKey) {
    return {
      provider: 'local-fallback',
      ...fallbackLuxuryCopy(product)
    };
  }

  const prompt = `You are MAT AI, the merchandising engine for MAT STORE, an ultra-premium ecommerce marketplace.
Return strict JSON only with keys: title, description, shortDescription, category, tags, seoTitle, seoDescription, luxuryAngle.
Create elegant, conversion-focused, truthful ecommerce copy without unsupported claims.
Keep the title as the real supplier product name. Do not prefix the product title with MAT or MAT STORE.
Do not mention external marketplaces, source websites, supplier names, seller platforms, or vendor origin in customer-facing copy. Use MAT STORE as the visible store identity.
Product source data: ${JSON.stringify(product).slice(0, 5000)}`;

  const response = await chatCompletion({
    messages: [
      { role: 'system', content: 'You write luxury marketplace merchandising copy. Return valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.35,
    maxTokens: 900,
    timeoutMs: 12000
  });

  if (!response.content) {
    return {
      provider: response.provider || 'mat-ai-fallback',
      ...fallbackLuxuryCopy(product)
    };
  }

  const parsed = safeJsonParse(response.content);

  const fallback = fallbackLuxuryCopy(product);
  const realTitle = cleanProductTitle(product.title || fallback.title, fallback.title);
  const title = realTitle;

  return {
    provider: response.provider || 'mat-ai',
    ...fallback,
    ...(parsed || {}),
    title,
    seoTitle: `${cleanProductTitle(parsed?.seoTitle || title, title)} | MAT STORE`
  };
}

module.exports = {
  chatCompletion,
  enhanceProduct,
  inferCategory
};
