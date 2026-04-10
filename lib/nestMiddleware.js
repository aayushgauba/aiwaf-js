const createExpressMiddleware = require('./wafMiddleware');

module.exports = function createNestMiddleware(opts = {}) {
  const middleware = createExpressMiddleware(opts);

  return class AIWAFNestMiddleware {
    use(req, res, next) {
      return middleware(req, res, next);
    }
  };
};
