const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'by',
  'for',
  'from',
  'in',
  'mat',
  'of',
  'on',
  'or',
  'store',
  'the',
  'to',
  'with'
]);

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(/\s+/)
    .filter((term) => term && (term.length > 1 || /^[0-9]+$/.test(term)) && !STOP_WORDS.has(term));
}

function uniqueTerms(value = '') {
  return [...new Set(tokenize(value))].slice(0, 12);
}

function hasTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^| )${escaped}( |$)`).test(text)) return true;
  if (/^[0-9]+$/.test(term)) return false;
  if (term.length < 4) return false;
  return text.split(/\s+/).some((token) => token.length >= 4 && (token.startsWith(term) || term.startsWith(token)));
}

function hasOrderedTermsNear(text, terms, maxGap = 3) {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start] !== terms[0]) continue;
    let cursor = start;
    let matched = true;
    for (let termIndex = 1; termIndex < terms.length; termIndex += 1) {
      let nextIndex = -1;
      for (let index = cursor + 1; index <= Math.min(tokens.length - 1, cursor + maxGap + 1); index += 1) {
        if (tokens[index] === terms[termIndex]) {
          nextIndex = index;
          break;
        }
      }
      if (nextIndex < 0) {
        matched = false;
        break;
      }
      cursor = nextIndex;
    }
    if (matched) return true;
  }
  return false;
}

function queryNeedsTitleMatch(normalizedQuery = '', terms = []) {
  if (terms.length > 1) return true;
  return /\b(iphone|ipad|macbook|galaxy|pixel|phone|smartphone|laptop|notebook|computer|pc|tv|television|monitor|tablet|camera|airpods?|earbuds?|earphones?|headphones?|headsets?|speaker|soundbar|watch|smartwatch|controller|console|ps5|xbox|drone|fryer|air\s*fryer|lamp|light|resin|shoe|shoes|sneaker|sneakers|boot|boots|bag|wallet|dress|jacket|shirt|hoodie|ring|necklace|bracelet|perfume|fragrance|cream|serum|makeup|toy|charger|cable|case|cover)\b/i.test(normalizedQuery);
}

function productCoreText(product = {}) {
  const details = product.marketplaceDetails || {};
  const specs = Array.isArray(details.specs)
    ? details.specs.flatMap((item) => [item.name, item.value])
    : [];
  const about = Array.isArray(details.about) ? details.about : [];
  return normalizeText([
    product.title,
    product.description,
    product.shortDescription,
    product.category,
    product.supplierName,
    product.supplierProductCode,
    product.seo?.title,
    product.seo?.description,
    details.brand,
    details.badge,
    ...about,
    ...specs
  ].filter(Boolean).join(' '));
}

function scoreProduct(query, product = {}) {
  const terms = uniqueTerms(query);
  const phrase = normalizeText(query);
  if (!terms.length) return { score: 0, matchedTerms: [], terms, relevant: true };

  const title = normalizeText(product.title || '');
  const core = productCoreText(product);
  const matchedTerms = terms.filter((term) => hasTerm(core, term));
  const matchedTitleTerms = terms.filter((term) => hasTerm(title, term));
  const ratio = matchedTerms.length / terms.length;

  let score = 0;
  if (phrase && title.includes(phrase)) score += 90;
  if (phrase && core.includes(phrase)) score += 55;
  score += matchedTitleTerms.length * 18;
  score += matchedTerms.length * 8;
  if (matchedTitleTerms.length === terms.length) score += 35;
  if (matchedTerms.length === terms.length) score += 20;
  if (String(product.supplierName || '').toLowerCase()) score += 2;

  const normalizedQuery = normalizeText(query);
  const queryIsPhoneModel = /\b(iphone|galaxy|pixel)\s+[0-9a-z]+\b/i.test(normalizedQuery);
  const accessoryPattern = /\b(case|cover|protector|glass|charger|cable|screen|lens|battery|adapter|remote|control|connector|replacement|keyboard|caps|stand|mount|bag|sleeve|interface|tips?|ear\s*tips?|earbuds?\s*tips?|earplugs?|skin|shell|strap|band|dock|holder|cleaner|cleaning|tool|kit|pouch|parts?|usb|flash|thumb|drive)\b/i;
  const queryWantsAccessory = accessoryPattern.test(normalizedQuery);
  const queryWantsCoreDevice = /\b(iphone|galaxy|pixel|phone|smartphone|laptop|notebook|computer|tv|television|monitor|tablet|camera|airpods?|earbuds?|earphones?|headphones?|headsets?|speaker|soundbar|watch|smartwatch|console|drone)\b/i.test(normalizedQuery);
  const queryWantsAudioDevice = /\b(airpods?|earbuds?|earphones?|headphones?|headsets?)\b/i.test(normalizedQuery);
  const accessoryTitle = /\b(case|cover|protector|glass|charger|cable|screen|lens|film|tempered|hydrogel|remote|control|connector|adapter|replacement|keyboard|caps|stand|mount|bag|sleeve|interface|tips?|ear\s*tips?|earbuds?\s*tips?|earplugs?|skin|shell|strap|band|dock|holder|cleaner|cleaning|tool|kit|pouch|parts?|usb|flash|thumb|drive)\b/i.test(title);
  const editorialTitle = /\b(review|guide|news|announces?|announced|introduces?|launched?|launch|sale|ahead\s+of\s+launch|comprehensive|experience|rumors?|leaks?|premiere|premiera|oglasza|ogłasza|stellt|neues|vor)\b/i.test(title);
  const blockedAccessory = queryWantsCoreDevice && !queryWantsAccessory && accessoryTitle;
  const blockedEditorial = queryWantsCoreDevice && !queryWantsAccessory && editorialTitle;
  const phoneModel = normalizeText(query).match(/\b(iphone|galaxy|pixel)\s+([0-9a-z]+)\b/i);
  const phoneModelMatched = !phoneModel || hasOrderedTermsNear(core, [phoneModel[1], phoneModel[2]], 3);
  if (blockedAccessory) score -= 180;
  if (editorialTitle) score -= 120;
  if (queryWantsAudioDevice && !queryWantsAccessory) {
    if (accessoryTitle) score -= 120;
    else if (/\b(airpods?|earbuds?|earphones?|headphones?|headsets?|wireless|bluetooth|noise|anc|audio)\b/i.test(title)) score += 55;
  }
  if (queryIsPhoneModel && !queryWantsAccessory) {
    if (accessoryTitle) score -= 110;
    else if (/\b(unlocked|smartphone|phone|original|genuine|rom|gb|pro|max)\b/i.test(title)) score += 55;
  }

  const requiredMatches = terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.7);
  const requiredTitleMatches = terms.length <= 1 ? 1 : Math.min(2, terms.length);
  const titleMatchOk = !queryNeedsTitleMatch(normalizedQuery, terms)
    || (phrase && title.includes(phrase))
    || matchedTitleTerms.length >= requiredTitleMatches;
  const relevant = matchedTerms.length >= requiredMatches
    && score >= (terms.length <= 2 ? 16 : 22)
    && titleMatchOk
    && (!queryIsPhoneModel || phoneModelMatched)
    && !blockedAccessory
    && !blockedEditorial;
  return { score, matchedTerms, terms, ratio, relevant };
}

function productMatchesQuery(query, product = {}) {
  return scoreProduct(query, product).relevant;
}

module.exports = {
  normalizeText,
  productCoreText,
  productMatchesQuery,
  scoreProduct,
  uniqueTerms
};
