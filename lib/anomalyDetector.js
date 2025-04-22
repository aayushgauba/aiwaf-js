// lib/anomalyDetector.js

const { IsolationForest } = require('./isolationForest');
let model;
let trained = false;

module.exports = {
  /**
   * Initialize a fresh forest instance.
   * @param {Object} opts
   * @param {number} opts.nTrees      Number of trees to build (default 100)
   * @param {number} opts.sampleSize  Subsample size per tree (default 256)
   */
  init({ nTrees = 100, sampleSize = 256 } = {}) {
    model = new IsolationForest({ nTrees, sampleSize });
    trained = false;
  },

  /**
   * Train the isolation forest on feature vectors.
   * @param {Array<Array<number>>} data  Array of feature vectors.
   */
  train(data) {
    if (!model) this.init();      // ensure model initialized
    model.fit(data);
    trained = true;
  },

  /**
   * Check if a request is anomalous.
   * @param {Object} req  Express request object
   * @returns {boolean}   true if anomalous, false otherwise
   */
  isAnomalous(req) {
    if (!trained) return false;
    // build your feature vector here; add more features as needed
    const feat = [
      req.path.length,  // path length
      0,                // placeholder: keyword hits
      0,                // placeholder: status code index
      0,                // placeholder: response time
      0,                // placeholder: burst count
      0                 // placeholder: total 404s
    ];
    return model.isAnomaly(feat);
  }
};
