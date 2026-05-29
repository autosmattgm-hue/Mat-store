const { randomUUID } = require('crypto');
const store = require('../database/jsonStore');
const { sanitizeString } = require('../utils/sanitize');
const HttpError = require('../utils/httpError');

function publicReview(review = {}) {
  return {
    id: review.id,
    productId: review.productId,
    name: review.name,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    verified: Boolean(review.verified),
    createdAt: review.createdAt
  };
}

function reviewStats(reviews = []) {
  const published = reviews.filter((review) => review.status === 'published');
  const count = published.length;
  const rating = count
    ? Math.round((published.reduce((sum, review) => sum + Number(review.rating || 0), 0) / count) * 10) / 10
    : 0;
  const breakdown = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: published.filter((review) => Number(review.rating) === stars).length
  }));
  return { rating, count, breakdown };
}

async function resolveProductId(idOrSlug) {
  const products = await store.read('products');
  const product = products.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
  return product?.id || idOrSlug;
}

async function listProductReviews(productId, options = {}) {
  const resolvedProductId = await resolveProductId(productId);
  const reviews = await store.read('reviews');
  const limit = Math.min(80, Math.max(1, Number(options.limit || 24)));
  return (reviews || [])
    .filter((review) => review.productId === resolvedProductId && review.status === 'published')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit)
    .map(publicReview);
}

async function productReviewSummary(productId) {
  const resolvedProductId = await resolveProductId(productId);
  const reviews = await store.read('reviews');
  const productReviews = (reviews || []).filter((review) => review.productId === resolvedProductId);
  return reviewStats(productReviews);
}

async function createReview(productId, payload = {}, user = null) {
  const products = await store.read('products');
  const product = products.find((item) => item.id === productId || item.slug === productId);
  if (!product) throw new HttpError(404, 'Product not found.');

  const rating = Math.max(1, Math.min(5, Math.round(Number(payload.rating || 0))));
  if (!rating) throw new HttpError(400, 'Rating is required.');
  const name = sanitizeString(payload.name || user?.name || 'MAT STORE Customer', 80);
  const email = sanitizeString(payload.email || user?.email || '', 254).toLowerCase();
  const title = sanitizeString(payload.title || '', 120);
  const comment = sanitizeString(payload.comment || '', 1000);
  if (comment.length < 8) throw new HttpError(400, 'Review comment is too short.');

  const review = {
    id: randomUUID(),
    productId: product.id,
    userId: user?.id || null,
    name,
    email,
    rating,
    title: title || `${rating}-star review`,
    comment,
    verified: Boolean(user?.id),
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  let stats = { rating: product.rating || 0, count: product.reviewsCount || 0 };
  await store.update('reviews', (reviews) => [review, ...(reviews || [])]);
  await store.update('products', async (productsList) => {
    const reviews = await store.read('reviews');
    const summary = reviewStats(reviews.filter((entry) => entry.productId === product.id));
    return productsList.map((item) => item.id === product.id
      ? (() => {
          const existingReviews = item.marketplaceDetails?.reviews || {};
          const externalCount = Math.max(0, Math.floor(Number(existingReviews.externalCount ?? existingReviews.count ?? 0)));
          const externalRating = Number(existingReviews.externalRating ?? existingReviews.rating ?? item.rating ?? 0);
          const combinedCount = externalCount + summary.count;
          const combinedRating = combinedCount
            ? Math.round((((externalRating * externalCount) + (summary.rating * summary.count)) / combinedCount) * 10) / 10
            : summary.rating || item.rating || 4.8;
          stats = { rating: combinedRating, count: combinedCount, localCount: summary.count };
          return {
            ...item,
            rating: combinedRating,
            reviewsCount: combinedCount,
            localReviewsCount: summary.count,
            marketplaceDetails: {
              ...(item.marketplaceDetails || {}),
              reviews: {
                ...existingReviews,
                externalCount,
                externalRating,
                localCount: summary.count,
                rating: combinedRating,
                count: combinedCount,
                summary: summary.count ? 'Verified MAT STORE customer feedback is available.' : existingReviews.summary || ''
              }
            },
            updatedAt: new Date().toISOString()
          };
        })()
      : item);
  });

  return { review: publicReview(review), stats };
}

module.exports = {
  createReview,
  listProductReviews,
  productReviewSummary,
  publicReview
};
