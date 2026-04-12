const { IsolationForest } = require('../lib/isolationForest');

describe('wasmAdapter', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses wasm validation helpers when available', async () => {
    const fitSpy = jest.fn();
    const retrainSpy = jest.fn();
    jest.doMock('aiwaf-wasm', () => ({
      default: jest.fn(async () => {}),
      validate_headers: jest.fn(() => null),
      validate_url: jest.fn(() => 'url_bad'),
      validate_content: jest.fn(() => ({ ok: false, reason: 'content_bad' })),
      validate_recent: jest.fn(() => false),
      AiwafIsolationForest: class {
        constructor() {}
        fit(data) { fitSpy(data); }
        retrain(data) { retrainSpy(data); }
        anomaly_score() { return 0.7; }
      }
    }));

    const {
      createIsolationForest,
      validateHeaders,
      validateUrl,
      validateContent,
      validateRecent
    } = require('../lib/wasmAdapter');

    const model = await createIsolationForest({ nTrees: 10, sampleSize: 8, threshold: 0.5 });
    expect(model.__aiwafWasm).toBe(true);
    model.fit([[0.1, 0.2, 0.3]]);
    model.retrain([[0.2, 0.1, 0.4]]);
    expect(fitSpy).toHaveBeenCalledTimes(1);
    expect(retrainSpy).toHaveBeenCalledTimes(1);
    expect(model.isAnomaly([0.1, 0.2, 0.3])).toBe(true);

    expect(await validateHeaders({ accept: 'text/html' })).toBeNull();
    expect(await validateUrl('http://example.com')).toBe('url_bad');
    expect(await validateContent('payload')).toBe('content_bad');
    expect(await validateRecent([{ path: '/', status: 200 }])).toBe('wasm_recent_invalid');
  });

  it('falls back to JS isolation forest when wasm is unavailable', async () => {
    jest.doMock('aiwaf-wasm', () => {
      throw new Error('not installed');
    });

    const { createIsolationForest } = require('../lib/wasmAdapter');
    const model = await createIsolationForest({ nTrees: 10, sampleSize: 8 });
    expect(model).not.toHaveProperty('__aiwafWasm', true);
    expect(typeof model.fit).toBe('function');
    expect(typeof model.anomalyScore).toBe('function');
  });
});
