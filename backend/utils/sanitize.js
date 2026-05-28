function sanitizeString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeEmail(value) {
  return sanitizeString(value, 254).toLowerCase();
}

function sanitizeUrl(value) {
  const input = sanitizeString(value, 2048);
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function sanitizeObject(input, schema) {
  const output = {};
  for (const [key, rule] of Object.entries(schema)) {
    const value = input?.[key];
    if (rule === 'string') output[key] = sanitizeString(value);
    if (rule === 'email') output[key] = sanitizeEmail(value);
    if (rule === 'url') output[key] = sanitizeUrl(value);
    if (rule === 'number') output[key] = Number.isFinite(Number(value)) ? Number(value) : 0;
    if (rule === 'array') output[key] = Array.isArray(value) ? value : [];
    if (rule === 'boolean') output[key] = Boolean(value);
  }
  return output;
}

module.exports = {
  sanitizeString,
  sanitizeEmail,
  sanitizeUrl,
  sanitizeObject
};
