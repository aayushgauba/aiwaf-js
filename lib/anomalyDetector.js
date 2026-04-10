const { IsolationForest } = require('./isolationForest');
const modelStore = require('./modelStore');

let model;
let trained = false;
let modelMetadata = null;
let loadStarted = false;

async function loadModel(opts = {}) {
  if (loadStarted) return;
  loadStarted = true;
  try {
    const modelData = await modelStore.load(opts);
    if (!modelData) return;

    if (modelData.metadata) {
      modelMetadata = modelData.metadata;
      model = IsolationForest.fromJSON(modelData);
      trained = true;
      console.log(`Pretrained anomaly model loaded (${modelMetadata.samplesCount} samples, created: ${modelMetadata.createdAt})`);
      return;
    }

    model = IsolationForest.fromJSON(modelData);
    trained = true;
    console.log('Pretrained anomaly model loaded (legacy format)');
  } catch (err) {
    console.warn('Failed to load pretrained model:', err.message);
  }
}

module.exports = {
  init(opts = {}) {
    loadModel(opts);
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
