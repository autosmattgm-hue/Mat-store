const fs = require('fs/promises');
const path = require('path');

const databaseDir = path.join(__dirname, '..', '..', 'database');
const locks = new Map();

const defaults = {
  users: [],
  products: [],
  orders: [],
  carts: [],
  abandonedCarts: [],
  settings: {
    pricing: {
      defaultMarkupPercent: 40,
      hardToFindMarkupPercent: 50,
      maxResponsibleMarkupPercent: 70,
      fixedMargin: 0,
      rounding: 0.99
    },
    currencies: {
      base: 'USD',
      supported: ['USD', 'EUR', 'GBP', 'GMD', 'NGN', 'CAD', 'AED']
    },
    seo: {
      siteName: 'MAT STORE',
      canonicalBaseUrl: 'http://localhost:3000'
    }
  }
};

function filePath(collection) {
  return path.join(databaseDir, `${collection}.json`);
}

async function ensureCollection(collection) {
  await fs.mkdir(databaseDir, { recursive: true });
  const target = filePath(collection);
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, JSON.stringify(defaults[collection] ?? [], null, 2));
  }
}

async function read(collection) {
  await ensureCollection(collection);
  const raw = await fs.readFile(filePath(collection), 'utf8');
  if (!raw.trim()) return defaults[collection] ?? [];
  return JSON.parse(raw);
}

async function write(collection, data) {
  await ensureCollection(collection);
  const tempFile = `${filePath(collection)}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
  await fs.rename(tempFile, filePath(collection));
  return data;
}

async function update(collection, mutator) {
  const previousLock = locks.get(collection) || Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  const chainedLock = previousLock.then(() => currentLock);
  locks.set(collection, chainedLock);

  await previousLock;
  try {
    const data = await read(collection);
    const next = await mutator(data);
    await write(collection, next);
    return next;
  } finally {
    releaseLock();
    if (locks.get(collection) === chainedLock) locks.delete(collection);
  }
}

module.exports = {
  read,
  write,
  update,
  databaseDir
};
