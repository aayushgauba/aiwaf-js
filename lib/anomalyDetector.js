const fs = require('fs');
const path = require('path');
const { IsolationForest } = require('./isolationForest');

let model;
let trained = false;

const modelPath = path.join(__dirname, '..', 'resources', 'model.json');

try {
  const data = fs.readFileSync(modelPath, 'utf-8');
  model = IsolationForest.fromJSON(JSON.parse(data));
  trained = true;
  console.log('✅ Pretrained anomaly model loaded.');
} catch (err) {
  console.warn('⚠️ Failed to load pretrained model:', err);
}

module.exports = {
  init(opts = {}) {
    if (!model) {
      model = new IsolationForest({ nTrees: opts.nTrees || 100, sampleSize: opts.sampleSize || 256 });
    }
  },

  train(data) {
    model.fit(data);
    trained = true;
  },

  // ✅ Now expects a vector, not a request
  isAnomalous(features, threshold = 0.5) {
    if (!trained) return false;
    return model.isAnomaly(features, threshold);
  }
};