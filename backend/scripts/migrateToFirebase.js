const store = require('../database/jsonStore');

const collections = ['settings', 'users', 'products', 'orders', 'carts', 'abandonedCarts', 'reviews', 'notifications'];

async function migrate() {
  if (!store.usingFirestore()) {
    throw new Error('Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
  }

  for (const collection of collections) {
    const data = await store.localRead(collection);
    const count = Array.isArray(data) ? data.length : 1;
    console.log(`Migrating ${collection}: ${count} record${count === 1 ? '' : 's'}`);
    await store.write(collection, data);
  }

  console.log('Firebase migration complete.');
}

migrate().catch((error) => {
  console.error(`Firebase migration failed: ${error.message}`);
  process.exit(1);
});
