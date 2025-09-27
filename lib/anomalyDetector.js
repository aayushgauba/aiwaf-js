const fs = require('fs');
const path = require('path');
const { IsolationForest } = require('./isolationForest');

let model;
let trained = false;
let modelMetadata = null;

const modelPath = path.join(__dirname, '..', 'resources', 'model.json');

try {
  const data = fs.readFileSync(modelPath, 'utf-8');
  const modelData = JSON.parse(data);
  
  // Handle both old format (direct model) and new format (with metadata)
  if (modelData.metadata) {
    modelMetadata = modelData.metadata;
    model = IsolationForest.fromJSON(modelData);
    console.log(`Pretrained anomaly model loaded (${modelMetadata.samplesCount} samples, created: ${modelMetadata.createdAt})`);
  } else {
    // Old format - direct model data
    model = IsolationForest.fromJSON(modelData);
    console.log('Pretrained anomaly model loaded (legacy format)');
  }
  
  trained = true;
} catch (err) {
  console.warn('Failed to load pretrained model:', err.message);
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

  // Expects a feature vector: [pathLen, kwHits, statusIdx, responseTime, burst, total404]
  isAnomalous(features, threshold = 0.5) {
    if (!trained) {
      console.warn('Anomaly detector not trained yet');
      return false;
    }
    
    try {
      return model.isAnomaly(features, threshold);
    } catch (err) {
      console.warn('Error in anomaly detection:', err.message);
      return false;
    }
  },

  getModelInfo() {
    return {
      trained,
      metadata: modelMetadata,
      threshold: 0.5
    };
  }
};