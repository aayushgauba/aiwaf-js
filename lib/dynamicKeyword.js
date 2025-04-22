// lib/dynamicKeyword.js
let opts, counts;

module.exports = {
  init(o = {}) {
    // normalize option name
    const topN = o.dynamicTopN ?? o.DYNAMIC_TOP_N ?? 10;
    opts = { dynamicTopN: topN };
    counts = {};
  },

  learn(path) {
    const segments = path.split('/').filter(s => s.length > 3);
    segments.forEach(s => {
      counts[s] = (counts[s] || 0) + 1;
    });
  },

  check(path) {
    // only block segments whose count exceeds the threshold
    return Object.entries(counts)
      .find(([seg, cnt]) => cnt > opts.dynamicTopN && path.includes(seg))
      ?. [0]  // return the segment string
    || null;
  }
};
