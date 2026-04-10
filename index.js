// aiwaf‑js/index.js
const createExpressMiddleware = require('./lib/wafMiddleware');
const createFastifyPlugin = require('./lib/fastifyPlugin');
const createHapiPlugin = require('./lib/hapiPlugin');
const createKoaMiddleware = require('./lib/koaMiddleware');
const createNestMiddleware = require('./lib/nestMiddleware');

module.exports = createExpressMiddleware;
module.exports.fastify = createFastifyPlugin;
module.exports.hapi = createHapiPlugin;
module.exports.koa = createKoaMiddleware;
module.exports.nest = createNestMiddleware;
