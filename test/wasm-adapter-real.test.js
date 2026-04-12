describe('WASM adapter integration (real package)', () => {
  it('loads aiwaf-wasm and validates headers with a plain object', async () => {
    jest.resetModules();
    jest.dontMock('aiwaf-wasm');

    let validateHeaders;
    await new Promise(resolve => {
      jest.isolateModules(() => {
        ({ validateHeaders } = require('../lib/wasmAdapter'));
        resolve();
      });
    });

    const result = await validateHeaders(
      { accept: 'text/html', 'user-agent': 'Mozilla/5.0' },
      { requiredHeaders: ['accept', 'user-agent'], minScore: 3 }
    );

    expect(result).toBeNull();
  });
});
