import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildIndex } from '../../../src/integrations/core/build-index.js';
import { getIndexDir } from '../../../src/shared/repo-paths.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { admitManagedReferenceFacts } from '../../../src/contracts/managed-reference-identities.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const cases = [
  { file: 'Dockerfile', language: 'dockerfile', text: 'FROM alpine:3 AS first\nRUN echo hello\nFROM busybox:1 AS second\nCOPY --from=first /a /b\n',
    witnesses: [['dependency', 'alpine:3', 'first'], ['dependency', 'busybox:1', 'second'], ['dependency', 'first', 'second']] },
  { file: 'schema.graphql', language: 'graphql', text: 'type Amber { alpha: Alpha }\ntype Bravo { bravo: Beta }\nquery Work { ...Frag }\nfragment Frag on Amber { alpha }\n',
    witnesses: [['type-reference', 'Alpha', 'Amber'], ['type-reference', 'Beta', 'Bravo'], ['fragment-reference', 'Frag', 'Work']] },
  { file: 'view.hbs', language: 'handlebars', text: '{{#*inline "first"}}{{alpha item}}{{lookupOnly}}{{/inline}}\n'
    + '{{#*inline "second"}}{{bravo item}}{{/inline}}\n{{> shared}}',
  witnesses: [['helper-invocation', 'alpha', 'first'], ['helper-invocation', 'bravo', 'second'], ['lookup', 'lookupOnly', 'first'], ['dependency', 'shared', null]] },
  { file: 'view.mustache', language: 'mustache', text: '{{#first}}{{alpha}}{{/first}}\n{{#second}}{{bravo}}{{/second}}\n{{> shared}}',
    witnesses: [['lookup', 'alpha', 'first'], ['lookup', 'bravo', 'second'], ['dependency', 'shared', null]] },
  { file: 'view.j2', language: 'jinja', text: '{% macro first(item) %}{{ alpha(item) }}{{ lookupOnly }}{% endmacro %}\n'
    + '{% macro second(item) %}{{ bravo(item) }}{% endmacro %}',
  witnesses: [['helper-invocation', 'alpha', 'first'], ['helper-invocation', 'bravo', 'second'], ['lookup', 'lookupOnly', 'first']] },
  { file: 'schema.proto', language: 'proto', text: 'syntax = "proto3";\nmessage Alpha {}\nmessage Beta {}\n'
    + 'message First { Alpha alpha = 1; }\nmessage Second { Beta beta = 1; }\n',
  witnesses: [['type-reference', 'Alpha', null], ['type-reference', 'Beta', null]] }
];
const { dir } = await prepareIsolatedTestCacheDir('managed-reference-core-publication');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
for (const test of cases) await fs.writeFile(path.join(repo, test.file), test.text);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: {
  threads: 1, indexing: { scm: { provider: 'none' }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, log: () => {} });
  const indexDir = getIndexDir(repo, 'code');
  const chunks = await loadChunkMeta(indexDir, { strict: true });
  const files = await loadJsonArrayArtifact(indexDir, 'file_relations', { strict: true });
  const callSites = await loadJsonArrayArtifact(indexDir, 'call_sites', { strict: true });
  for (const [artifact, rows] of [['chunk_meta', chunks], ['file_relations', files], ['call_sites', callSites]]) {
    const result = validateArtifact(artifact, rows); assert.equal(result.ok, true, result.errors?.join('; '));
  }
  assert.deepEqual(files.map(row => row.file).sort(), cases.map(test => test.file).sort(), 'all six actual custom routes reach publication');
  for (const test of cases) {
    const file = files.find(row => row.file === test.file), owned = chunks.filter(chunk => chunk.file === test.file);
    assert.ok(owned.length, test.file); assert.ok(owned.every(chunk => chunk.chunkUid));
    assert.equal(new Set(owned.map(chunk => chunk.chunkUid)).size, owned.length);
    const facts = admitManagedReferenceFacts(file.relations.managedReferenceFacts, test.language, { text: test.text });
    assert.ok(facts, test.file + ': the source-admitted fact envelope survives the actual Core pipeline');
    assert.equal(facts.source.textHash, createHash('sha256').update(test.text, 'utf16le').digest('hex'));
    assert.equal(Object.hasOwn(file.relations, 'calls'), false, 'canonical file_relations owns imports/exports/usages, not invocation rows');
    assert.equal(callSites.some(site => site.file === test.file), false);
    assert.ok(owned.every(chunk => !chunk.codeRelations?.calls?.length));
    for (const [kind, value, owner] of test.witnesses) {
      const match = entry => entry.kind === kind && entry.value === value && (entry.owner?.name ?? null) === owner;
      const original = facts.references.find(match); assert.ok(original, `${test.file}: ${kind}/${value}/${owner}`);
      if (test.language === 'proto') {
        assert.equal(original.source, null); assert.equal(original.owner, null);
        assert.ok(owned.every(chunk => !chunk.codeRelations?.referenceDetails?.some(match)), 'unlocated reflection does not invent lexical chunk ownership');
      } else {
        const projected = owned.flatMap(chunk => chunk.codeRelations?.referenceDetails || []).filter(match);
        assert.ok(projected.length, test.file + ': typed evidence survives persisted chunk_meta');
        for (const entry of projected) assert.deepEqual(entry, original, 'source ranges and semantic owners remain exact');
        assert.ok(owned.filter(chunk => chunk.codeRelations?.referenceDetails?.some(match)).every(chunk =>
          original.source.start >= chunk.start && original.source.end <= chunk.end));
      }
    }
    if (test.language === 'mustache') {
      assert.ok(!owned.find(chunk => chunk.name === 'first').codeRelations.referenceDetails.some(entry => entry.value === 'bravo'));
      assert.ok(!owned.find(chunk => chunk.name === 'second').codeRelations.referenceDetails.some(entry => entry.value === 'alpha'));
    }
    if (test.language === 'graphql') assert.ok(owned.find(chunk => chunk.name === 'type Amber').codeRelations.referenceDetails
      .some(entry => entry.value === 'Alpha' && entry.owner?.name === 'Amber'), 'display title never replaces semantic owner');
    if (test.language === 'jinja') assert.ok(!facts.references.some(entry => entry.kind === 'helper-invocation' && ['first', 'second'].includes(entry.value)));
    if (test.language === 'handlebars') assert.ok(!facts.references.some(entry => entry.kind === 'helper-invocation' && entry.value === 'inline'));
  }
  console.log(JSON.stringify({ routes: cases.map(test => test.language), publishedChunks: chunks.length,
    typedOccurrences: files.reduce((sum, row) => sum + row.relations.managedReferenceFacts.references.length, 0), callSites: callSites.length }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
