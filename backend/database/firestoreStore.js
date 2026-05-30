const crypto = require('crypto');
const config = require('../config');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const FIRESTORE_ROOT = 'https://firestore.googleapis.com/v1';
const ARRAY_COLLECTIONS = new Set(['users', 'products', 'orders', 'carts', 'abandonedCarts', 'reviews', 'notifications']);
const locks = new Map();

let tokenCache = {
  accessToken: '',
  expiresAt: 0
};

function enabled() {
  return Boolean(config.firebase?.projectId && config.firebase?.clientEmail && config.firebase?.privateKey);
}

function collectionPrefix() {
  return String(config.firebase?.collectionPrefix || 'mat_store')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mat_store';
}

function collectionName(collection) {
  return `${collectionPrefix()}_${String(collection || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function documentKey(item, index) {
  const raw =
    item?.id ||
    item?.productId ||
    item?.orderNumber ||
    item?.email ||
    item?.sessionId ||
    `${index}`;
  return String(raw);
}

function documentId(key) {
  return crypto.createHash('sha1').update(String(key)).digest('hex');
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function privateKey() {
  return String(config.firebase.privateKey || '')
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');
}

function databasePath() {
  return `projects/${encodeURIComponent(config.firebase.projectId)}/databases/(default)/documents`;
}

function collectionUrl(collection) {
  return `${FIRESTORE_ROOT}/${databasePath()}/${collectionName(collection)}`;
}

function documentName(collection, id) {
  return `${databasePath()}/${collectionName(collection)}/${id}`;
}

function metaDocumentName(collection) {
  return `${databasePath()}/${collectionPrefix()}_meta/${collection}`;
}

function encodePayload(value, index = 0, key = '') {
  return {
    json: { stringValue: JSON.stringify(value ?? null) },
    key: { stringValue: String(key || '') },
    index: { integerValue: String(index) },
    updatedAt: { timestampValue: new Date().toISOString() }
  };
}

function decodePayload(document) {
  const json = document?.fields?.json?.stringValue;
  if (!json) return null;
  return JSON.parse(json);
}

async function accessToken() {
  if (!enabled()) throw new Error('Firebase Admin credentials are not configured.');
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && tokenCache.expiresAt - 60 > now) return tokenCache.accessToken;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: config.firebase.clientEmail,
      scope: FIRESTORE_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey());
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Firebase authentication failed.');
  }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600)
  };
  return tokenCache.accessToken;
}

async function firestoreRequest(url, options = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.error_description || data.error || 'Firestore request failed.';
    throw new Error(message);
  }
  return data;
}

async function listDocuments(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(collectionUrl(collection));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await firestoreRequest(url.toString(), { method: 'GET' });
    docs.push(...(data.documents || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function commit(writes) {
  for (let index = 0; index < writes.length; index += 450) {
    const chunk = writes.slice(index, index + 450);
    if (chunk.length) {
      await firestoreRequest(`${FIRESTORE_ROOT}/${databasePath()}:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes: chunk })
      });
    }
  }
}

async function read(collection) {
  if (!enabled()) return null;
  if (!ARRAY_COLLECTIONS.has(collection)) {
    const url = `${FIRESTORE_ROOT}/${metaDocumentName(collection)}`;
    try {
      const document = await firestoreRequest(url, { method: 'GET' });
      return decodePayload(document);
    } catch (error) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('not_found') || message.includes('not found')) return null;
      throw error;
    }
  }

  const documents = await listDocuments(collection);
  return documents
    .map((document) => ({
      index: Number(document.fields?.index?.integerValue || 0),
      value: decodePayload(document)
    }))
    .filter((entry) => entry.value !== null)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.value);
}

async function write(collection, data) {
  if (!enabled()) return data;
  if (!ARRAY_COLLECTIONS.has(collection)) {
    await commit([
      {
        update: {
          name: metaDocumentName(collection),
          fields: encodePayload(data, 0, collection)
        }
      }
    ]);
    return data;
  }

  const existing = await listDocuments(collection);
  const nextIds = new Set();
  const writes = [];
  const rows = Array.isArray(data) ? data : [];

  rows.forEach((item, index) => {
    const key = documentKey(item, index);
    const id = documentId(key);
    nextIds.add(id);
    writes.push({
      update: {
        name: documentName(collection, id),
        fields: encodePayload(item, index, key)
      }
    });
  });

  existing.forEach((document) => {
    const id = String(document.name || '').split('/').pop();
    if (id && !nextIds.has(id)) writes.push({ delete: document.name });
  });

  await commit(writes);
  return data;
}

async function update(collection, mutator, readWithFallback = read) {
  const previousLock = locks.get(collection) || Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const chainedLock = previousLock.then(() => currentLock);
  locks.set(collection, chainedLock);

  await previousLock;
  try {
    const data = await readWithFallback(collection);
    const next = await mutator(data);
    await write(collection, next);
    return next;
  } finally {
    releaseLock();
    if (locks.get(collection) === chainedLock) locks.delete(collection);
  }
}

module.exports = {
  enabled,
  read,
  write,
  update,
  collectionName
};
