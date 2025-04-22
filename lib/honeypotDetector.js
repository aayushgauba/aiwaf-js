let field;
module.exports = {
  init(o) { field = o.HONEYPOT_FIELD; },
  isTriggered(req) { return req.body && req.body[field]; }
};