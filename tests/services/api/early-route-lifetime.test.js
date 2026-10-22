import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
globalThis.__routeLifetimeEvents = [];
globalThis.__routeLifetimeOperation = async signal => { globalThis.__routeLifetimeEvents.push(signal); return {}; };
const validators = {
  'semantic-query.js': 'assertSemanticQuery', 'semantic-find.js': 'assertSemanticFind',
  'semantic-trace.js': 'assertSemanticTrace', 'semantic-explain.js': 'assertSemanticExplain',
  'semantic-enrichment.js': 'assertSemanticEnrichment', 'runtime-query.js': 'assertRuntimeQuery', 'runtime-claims.js': 'assertRuntimeClaims',
  'graph-evidence.js': 'assertGraphEvidence'
};
const runners = {
  'graph-evidence.js': ['runGraphEvidence', 'classifyGraphEvidenceError'],
  'semantic-detail.js': ['runSemanticDetail', 'classifySemanticDetailError'],
  'semantic-find.js': ['runSemanticFind'], 'semantic-trace.js': ['runSemanticTrace'],
  'semantic-explain.js': ['runSemanticExplain'], 'semantic-enrichment.js': ['runSemanticEnrichment', 'classifySemanticEnrichmentError'],
  'runtime-evidence.js': ['runRuntimeEvidenceLookup', 'runRuntimeFamilyDiscovery', 'classifyRuntimeEvidenceError'],
  'runtime-claims.js': ['runRuntimeCaptureComparison', 'runRuntimeDerivedClaimLookup']
};
const hooks = registerHooks({ load(url, context, next) {
  const name = url.split('/').at(-1);
  if (url.includes('/contracts/validators/') && validators[name]) return { format: 'module', shortCircuit: true,
    source: `export const ${validators[name]} = () => {};` };
  if (url.includes('/integrations/tooling/') && runners[name]) return { format: 'module', shortCircuit: true,
    source: runners[name].map(exportName => exportName.startsWith('classify')
      ? `export const ${exportName} = error => ({status:500,message:error.message});`
      : `export const ${exportName} = async (_request, context) => globalThis.__routeLifetimeOperation(context.signal);`).join('\n') };
  return next(url, context);
} });
try {
  const specs = [['semantic', 'handleSemanticDetailRoute'], ['semantic-find', 'handleSemanticFindRoute'],
    ['graph-evidence', 'handleGraphEvidenceRoute'],
    ['semantic-trace', 'handleSemanticTraceRoute'], ['semantic-explain', 'handleSemanticExplainRoute'],
    ['semantic-enrichment', 'handleSemanticEnrichmentRoute'], ['runtime-evidence', 'handleRuntimeEvidenceRoute']];
  for (const [file, exported] of specs) {
    const handler = (await import(`../../../tools/api/router/${file}.js`))[exported];
    for (const seam of ['entry', 'body', 'repository', 'operation', 'healthy']) {
      const req = new EventEmitter(), res = new EventEmitter();
      let writes = 0;
      res.writeHead = () => { writes++; }; res.end = () => { res.writableEnded = true; };
      const disconnect = () => { res.destroyed = true; res.emit('close'); };
      if (seam === 'entry') disconnect();
      globalThis.__routeLifetimeEvents = [];
      globalThis.__routeLifetimeOperation = async signal => {
        globalThis.__routeLifetimeEvents.push(signal);
        if (seam === 'operation') disconnect();
        return {};
      };
      await handler({ req, res, operation: 'families', parseJsonBody: async () => {
        if (seam === 'body') disconnect(); return { repoRoot: 'authored' };
      }, resolveRepo: async () => { if (seam === 'repository') disconnect(); return 'authored'; } });
      assert.equal(globalThis.__routeLifetimeEvents.length, ['healthy', 'operation'].includes(seam) ? 1 : 0, `${file}:${seam}`);
      if (seam === 'operation') assert.equal(globalThis.__routeLifetimeEvents[0].aborted, true);
      assert.equal(writes, seam === 'healthy' ? 1 : 0);
      assert.equal(req.listenerCount('aborted'), 0);
      assert.equal(res.listenerCount('close'), 0);
      assert.equal(res.listenerCount('error'), 0);
    }
  }
} finally { hooks.deregister(); delete globalThis.__routeLifetimeOperation; delete globalThis.__routeLifetimeEvents; }
console.log('early semantic and runtime route lifetimes passed');
