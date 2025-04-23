const STATIC_KW = ['.php', '.xmlrpc', 'wp-', '.env', '.git', '.bak', 'shell'];
const STATUS_IDX = ['200', '403', '404', '500'];

function extractFeatures(req) {
  const uri = req.path.toLowerCase();
  const pathLen = uri.length;

  const kwHits = STATIC_KW.reduce(
    (count, kw) => count + (uri.includes(kw) ? 1 : 0), 0
  );

  const statusIdx = STATUS_IDX.indexOf(String(req.res?.statusCode || 200));
  const rt = parseFloat(req.headers['x-response-time'] || '0');
  const burst = 0;
  const total404 = 0;

  return [pathLen, kwHits, statusIdx, rt, burst, total404];
}

module.exports = { extractFeatures };
