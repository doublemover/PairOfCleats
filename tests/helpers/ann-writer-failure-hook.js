import fs from 'node:fs';
import { registerHooks } from 'node:module';

// Explicit --import fixture only; ordinary application entry points never load it.
const runner = new URL('../../tools/build/embeddings/runner.js', import.meta.url).href;
const backends = new URL('../../tools/build/embeddings/backends.js', import.meta.url).href;
const targets = new Map([
  [new URL('../../tools/build/embeddings/hnsw.js', import.meta.url).href, 'writeHnswIndex'],
  [new URL('../../tools/build/embeddings/lancedb.js', import.meta.url).href, 'writeLanceDbIndex']
]);
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (process.env.POC_FIXTURE_ANN_FAIL === '1' && context.parentURL === backends && targets.has(result.url)) {
      return { ...result, url: `${result.url}?fixture-writer-failure` };
    }
    return result;
  },
  load(url, context, next) {
    if (url === runner && process.env.POC_FIXTURE_ANN_ORIGINAL_RUNNER) {
      return { format: 'module', shortCircuit: true,
        source: fs.readFileSync(process.env.POC_FIXTURE_ANN_ORIGINAL_RUNNER, 'utf8') };
    }
    if (url.endsWith('?fixture-writer-failure')) {
      const original = url.slice(0, -'?fixture-writer-failure'.length);
      return { format: 'module', shortCircuit: true, source: `
        export * from ${JSON.stringify(original)};
        export async function ${targets.get(original)}() { throw new Error('fixture: native writer failure'); }
      ` };
    }
    return next(url, context);
  }
});
