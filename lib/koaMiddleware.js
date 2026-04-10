const createExpressMiddleware = require('./wafMiddleware');

function createExpressLikeResponse(ctx) {
  const res = {
    locals: {},
    on: (...args) => ctx.res.on(...args),
    get statusCode() {
      return ctx.status;
    },
    set statusCode(code) {
      ctx.status = code;
    },
    status(code) {
      ctx.status = code;
      res._handled = true;
      return res;
    },
    json(payload) {
      ctx.type = 'application/json';
      ctx.body = payload;
      res._handled = true;
      return res;
    },
    send(payload) {
      ctx.body = payload;
      res._handled = true;
      return res;
    }
  };
  return res;
}

module.exports = function createKoaMiddleware(opts = {}) {
  const middleware = createExpressMiddleware(opts);

  return async (ctx, next) => {
    const res = createExpressLikeResponse(ctx);
    const req = ctx.req;
    req.path = ctx.path;
    req.url = ctx.url;
    req.headers = ctx.headers;
    req.ip = ctx.ip || req.socket?.remoteAddress;

    await new Promise(resolve => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      const maybePromise = middleware(req, res, finish);
      if (res._handled) {
        finish();
      }
      Promise.resolve(maybePromise).then(finish).catch(finish);
    });

    if (ctx.body !== undefined) {
      return;
    }

    await next();
  };
};
