import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseJinjaTemplateStructure } from '../../../src/shared/jinja-template-structure.js';
import { collectJinjaImports } from '../../../src/index/language-registry/import-collectors/jinja.js';

// Identical semantic witnesses from the lexical contract, under production clocks.
for (const [source, limits] of [
  ['{% include "first" %}\n{% block Real %}{{value}}{% endblock %}\n{% include "excluded" %}', { maxLines: 2 }],
  ['{% include "first" %}{% include "second" %}', { maxMatches: 1 }],
  ['{% include "first" %}{% include "second" %}', { maxTokens: 1 }]
]) {
  const model = parseJinjaTemplateStructure(source);
  const started = performance.now();
  const imports = collectJinjaImports(source, { collectorScanBudget: { ...limits, maxMs: 0 } });
  console.log(JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), limits,
    node: process.version, platform: process.platform, reason: model.reason, metrics: model.metrics,
    importMs: performance.now() - started, imports }));
  assert.equal(model.reason, null);
  assert.equal(model.metrics.localLimitMs, 30);
  assert.ok(model.metrics.elapsedMs < 30);
  assert.deepEqual(imports, ['first']);
}
console.log('Serial Jinja production parser deadline and line/match/token witnesses passed');
