const fs = require('fs/promises');
const path = require('path');
const firestoreStore = require('./firestoreStore');

const sourceDatabaseDir = path.join(__dirname, '..', '..', 'database');
const databaseDir =
  process.env.MAT_DATABASE_DIR ||
  process.env.DATABASE_DIR ||
  (process.env.VERCEL ? path.join('/tmp', 'mat-store-database') : sourceDatabaseDir);
const locks = new Map();

const defaults = {
  users: [],
  products: [],
  orders: [],
  carts: [],
  abandonedCarts: [],
  reviews: [],
  notifications: [],
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
      canonicalBaseUrl: 'https://mat-store-dun.vercel.app'
    }
  }
};

function filePath(collection) {
  return path.join(databaseDir, `${collection}.json`);
}

function sourceFilePath(collection) {
  return path.join(sourceDatabaseDir, `${collection}.json`);
}

async function ensureCollection(collection) {
  await fs.mkdir(databaseDir, { recursive: true });
  const target = filePath(collection);
  try {
    await fs.access(target);
  } catch {
    try {
      await fs.copyFile(sourceFilePath(collection), target);
    } catch {
      await fs.writeFile(target, JSON.stringify(defaults[collection] ?? [], null, 2));
    }
  }
}

function cloneDefault(collection) {
  return JSON.parse(JSON.stringify(defaults[collection] ?? []));
}

async function localRead(collection) {
  await ensureCollection(collection);
  const raw = await fs.readFile(filePath(collection), 'utf8');
  if (!raw.trim()) return cloneDefault(collection);
  return JSON.parse(raw);
}

async function localWrite(collection, data) {
  await ensureCollection(collection);
  const tempFile = `${filePath(collection)}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
  await fs.rename(tempFile, filePath(collection));
  return data;
}

async function read(collection) {
  if (firestoreStore.enabled()) {
    const cloudData = await firestoreStore.read(collection);
    if (cloudData !== null && (!Array.isArray(cloudData) || cloudData.length)) return cloudData;
    try {
      return await localRead(collection);
    } catch {
      return cloneDefault(collection);
    }
  }
  return localRead(collection);
}

async function write(collection, data) {
  if (firestoreStore.enabled()) return firestoreStore.write(collection, data);
  return localWrite(collection, data);
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
  localRead,
  localWrite,
  usingFirestore: firestoreStore.enabled,
  databaseDir,
  sourceDatabaseDir
};
