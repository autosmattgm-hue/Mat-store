function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: {
        message: 'API route not found.',
        status: 404
      }
    });
  }
  return next();
}

function errorHandler(error, req, res, next) {
  const status = error.status || error.statusCode || 500;
  const response = {
    error: {
      message: status >= 500 ? 'Something went wrong.' : error.message,
      status
    }
  };
  if (error.details) response.error.details = error.details;
  if (process.env.NODE_ENV !== 'production' && status >= 500) response.error.stack = error.stack;
  res.status(status).json(response);
}

module.exports = {
  notFound,
  errorHandler
};
