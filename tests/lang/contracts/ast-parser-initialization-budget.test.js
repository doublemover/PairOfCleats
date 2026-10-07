import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createGraphqlStructureParser } from '../../../src/shared/graphql-ast.js';
import { createHandlebarsStructureParser } from '../../../src/shared/handlebars-ast.js';
import { createDockerfileStructureParser } from '../../../src/shared/dockerfile-ast.js';
import { createGraphqlImportCollector } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { createHandlebarsImportCollector } from '../../../src/index/language-registry/import-collectors/handlebars.js';
import { createDockerfileImportCollector } from '../../../src/index/language-registry/import-collectors/dockerfile.js';
import { createGraphqlManagedAdapter, createHandlebarsManagedAdapter, createDockerfileManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const require = createRequire(import.meta.url);
const routes = [
  { id: 'graphql', module: require('graphql'), method: 'parse', factory: createGraphqlStructureParser,
    collector: createGraphqlImportCollector, adapter: createGraphqlManagedAdapter,
    source: '#import "dependency.graphql"\ntype Real { field: String }', imports: ['dependency.graphql'], exports: ['Real'] },
  { id: 'handlebars', module: require(fileURLToPath(import.meta.resolve('@handlebars/parser'))), method: 'parseWithoutProcessing',
    factory: createHandlebarsStructureParser, collector: createHandlebarsImportCollector, adapter: createHandlebarsManagedAdapter,
    source: '{{> dependency}}{{#*inline "Real"}}Content{{/inline}}', imports: ['dependency'], exports: ['Real'] },
  { id: 'dockerfile', module: require('dockerfile-ast').DockerfileParser, method: 'parse', factory: createDockerfileStructureParser,
    collector: createDockerfileImportCollector, adapter: createDockerfileManagedAdapter,
    source: 'FROM dependency AS Real', imports: ['dependency', 'Real'], exports: ['Real'] }
];
for (const route of routes) {
  for (const mode of ['imports', 'relations']) {
    let clock = 0;
    let loads = 0;
    let parses = 0;
    const parseStructure = route.factory({ initializationNow: () => clock, loadParser: () => {
      loads += 1;
      clock += 60; // Deterministic setup cost, no busy waits or actual timer sleeps.
      return { ...route.module, [route.method]: (...args) => {
        parses += 1;
        clock += 5;
        return route.module[route.method](...args);
      } };
    } });
    const options = { collectorNow: () => clock, collectorScanBudget: { maxMs: 30 }, collectorDiagnostics: [] };
    if (mode === 'imports') assert.deepEqual(route.collector({ parseStructure })(route.source, options), route.imports);
    else assert.deepEqual(route.adapter({ parseStructure }).buildRelations({ text: route.source, options }).exports, route.exports);
    const setup = parseStructure.initialize();
    assert.deepEqual(setup, { scope: 'application-once', available: true, reason: null, elapsedMs: 60 });
    assert.equal(parseStructure.initialize(), setup, 'setup cost is recorded once, not erased or repeated');
    assert.equal(loads, 1);
    assert.equal(parses, 1, 'import/relation owners share the same parsed model');
    assert.ok(!options.collectorDiagnostics.some((row) => row.reasons?.includes('scan_time')));
  }
  for (const expiration of ['parsing', 'extraction']) for (const mode of ['imports', 'relations']) {
    let clock = 0;
    const parseStructure = route.factory({ initializationNow: () => clock, loadParser: () => {
      clock += 60;
      return { ...route.module, [route.method]: (...args) => {
        clock += expiration === 'parsing' ? 31 : 5;
        return route.module[route.method](...args);
      } };
    } });
    const diagnostics = [];
    const options = { collectorNow: () => {
      if (expiration === 'extraction') clock += 10;
      return clock;
    }, collectorScanBudget: { maxMs: 30 }, collectorDiagnostics: diagnostics };
    if (mode === 'imports') assert.deepEqual(route.collector({ parseStructure })(route.source, options), []);
    else {
      const result = route.adapter({ parseStructure }).buildRelations({ text: route.source, options });
      assert.deepEqual(result.exports, []);
      assert.deepEqual(result.usages, []);
    }
    assert.ok(diagnostics.some((row) => row.reasons.includes('scan_time')), `${route.id} ${expiration} deadline remains effective`);
    assert.equal(parseStructure.initialize().elapsedMs, 60);
  }
}
const failed = createGraphqlStructureParser({ loadParser: () => { throw new Error('Controlled missing dependency'); } });
assert.equal(failed.initialize().reason, 'parser-unavailable');
assert.equal(failed('type A { field: String }').reason, 'parser-unavailable');
let overLimitLoads = 0;
const bounded = createGraphqlStructureParser({ loadParser: () => { overLimitLoads += 1; } });
assert.equal(bounded('x'.repeat(786433)).reason, 'source-limit');
assert.equal(overLimitLoads, 0, 'direct parser input admission precedes setup');
console.log('One-time app parser setup is measured separately; parsing/extraction still obey document scan deadlines');
