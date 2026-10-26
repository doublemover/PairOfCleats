import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLanguageForFile, buildChunkRelations } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { buildCallIndex, buildFileRelations } from '../../../src/index/build/file-processor/relations.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueFileRelationsArtifacts } from '../../../src/index/build/artifacts/writers/file-relations.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { admitManagedReferenceFacts } from '../../../src/contracts/managed-reference-identities.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const cases = [
  { file: 'Dockerfile', text: 'FROM alpine:3 AS first\nRUN echo hello\nFROM busybox:1 AS second\nCOPY --from=first /a /b\n',
    witnesses: [['dependency', 'alpine:3', 'first'], ['dependency', 'busybox:1', 'second'], ['dependency', 'first', 'second']] },
  { file: 'schema.graphql', text: 'type Amber { alpha: Alpha }\ntype Bravo { bravo: Beta }\nquery Work { ...Frag }\nfragment Frag on Amber { alpha }\n',
    witnesses: [['type-reference', 'Alpha', 'Amber'], ['type-reference', 'Beta', 'Bravo'], ['fragment-reference', 'Frag', 'Work']] },
  { file: 'view.hbs', text: '{{#*inline "first"}}{{alpha item}}{{lookupOnly}}{{/inline}}\n'
    + '{{#*inline "second"}}{{bravo item}}{{/inline}}\n{{> shared}}',
  witnesses: [['helper-invocation', 'alpha', 'first'], ['helper-invocation', 'bravo', 'second'], ['lookup', 'lookupOnly', 'first'], ['dependency', 'shared', null]] },
  { file: 'view.mustache', text: '{{#first}}{{alpha}}{{/first}}\n{{#second}}{{bravo}}{{/second}}\n{{> shared}}',
    witnesses: [['lookup', 'alpha', 'first'], ['lookup', 'bravo', 'second'], ['dependency', 'shared', null]] },
  { file: 'view.j2', text: '{% macro first(item) %}{{ alpha(item) }}{{ lookupOnly }}{% endmacro %}\n'
    + '{% macro second(item) %}{{ bravo(item) }}{% endmacro %}',
  witnesses: [['helper-invocation', 'alpha', 'first'], ['helper-invocation', 'bravo', 'second'], ['lookup', 'lookupOnly', 'first']] },
  { file: 'schema.proto', text: 'syntax = "proto3";\nmessage Alpha {}\nmessage Beta {}\n'
    + 'message First { Alpha alpha = 1; }\nmessage Second { Beta beta = 1; }\n',
  witnesses: [['type-reference', 'Alpha', null], ['type-reference', 'Beta', null]] }
];
const root = await createImportResolutionTempRoot('managed-reference-kind-and-owner');
const records = new Map();
try {
  for (const test of cases) {
    const ext = path.extname(test.file), lang = getLanguageForFile(ext, test.file);
    assert.ok(lang, test.file);
    const input = { text: test.text, ext, relPath: test.file, mode: 'code', options: { collectorNow: () => 0 } };
    const raw = lang.buildRelations(input);
    assert.deepEqual(raw.calls, [], `${lang.id}: syntax references never form a call product`);
    const facts = admitManagedReferenceFacts(raw.managedReferenceFacts, lang.id, { text: test.text });
    assert.ok(facts, `${lang.id}: actual parser facts retain their source identity`);
    assert.equal(admitManagedReferenceFacts(facts, lang.id, { text: test.text + ' ' }), null);
    for (const [kind, value, owner] of test.witnesses) {
      assert.ok(raw.usages.includes(value), `${lang.id}: positive file usage ${value}`);
      assert.ok(facts.references.some(entry => entry.kind === kind && entry.value === value && (entry.owner?.name ?? null) === owner),
        `${lang.id}: ${kind} ${value} belongs to ${owner ?? 'explicitly unattributed file scope'}`);
    }
    const filtered = filterRawRelationsWithLexicon(raw, { languageId: lang.id, relKey: test.file });
    records.set(test.file, buildFileRelations(filtered));
    const index = buildCallIndex(filtered);
    assert.equal(index.callsByCaller.size, 0);
    const chunks = smartChunk(input);
    assert.ok(chunks.length, `${lang.id}: actual production chunker emits source chunks`);
    const projected = chunks.map(chunk => buildChunkRelations({ lang, chunk, fileRelations: filtered, callIndex: index }));
    assert.ok(projected.every(value => value.calls.length === 0 && value.referenceCoverage.state === 'partial'));
    if (lang.id !== 'proto') for (const [kind, value, owner] of test.witnesses) {
      assert.ok(projected.some(result => result.referenceDetails.some(entry => entry.kind === kind && entry.value === value
        && (entry.owner?.name ?? null) === owner)), `${lang.id}: positive source facts survive real chunk projection`);
    } else {
      assert.ok(facts.references.every(entry => entry.source === null && entry.owner === null), 'reflection cannot invent lexical positions');
    }
    if (lang.id === 'mustache') {
      const first = chunks.findIndex(chunk => chunk.name === 'first');
      const second = chunks.findIndex(chunk => chunk.name === 'second');
      assert.ok(first >= 0 && second >= 0);
      assert.ok(!projected[first].referenceDetails.some(entry => entry.value === 'bravo'));
      assert.ok(!projected[second].referenceDetails.some(entry => entry.value === 'alpha'));
    }
    if (lang.id === 'graphql') {
      const amber = chunks.findIndex(chunk => chunk.name === 'type Amber');
      assert.ok(amber >= 0, 'GraphQL display titles remain distinct from semantic names');
      assert.ok(projected[amber].referenceDetails.some(entry => entry.owner?.name === 'Amber' && entry.value === 'Alpha'));
    }
    if (lang.id === 'jinja') assert.ok(!facts.references.some(entry => entry.kind === 'helper-invocation' && ['first', 'second'].includes(entry.value)),
      'macro declaration headers are not invocation syntax');
    if (lang.id === 'handlebars') assert.ok(!facts.references.some(entry => entry.kind === 'helper-invocation' && entry.value === 'inline'),
      'an inline declaration is not a helper invocation');
    const rows = createCallSites({ chunks: chunks.map((chunk, id) => ({ ...chunk, id, file: test.file, lang: lang.id,
      chunkUid: `reference-only-${id}`, codeRelations: projected[id] })) });
    assert.deepEqual(rows, [], `${lang.id}: typed references never publish canonical call sites`);

    const absPath = path.join(root, test.file); await fs.writeFile(absPath, test.text);
    const stat = await fs.stat(absPath), bundleDir = path.join(root, `${lang.id}-bundle`); await fs.mkdir(bundleDir);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    manifest.files[test.file] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: test.file,
      fileStat: stat, fileHash: sha1(test.text), fileChunks: [], bundleFormat: 'json', fileRelations: buildFileRelations(filtered) });
    const cached = await readCachedBundle({ enabled: true, absPath, relKey: test.file, fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
    assert.ok(cached.cachedBundle, `${lang.id}: ordinary bundle replay is admitted`);
    assert.deepEqual(cached.cachedBundle.fileRelations.managedReferenceFacts, facts);
    assert.deepEqual(chunks.map(chunk => buildChunkRelations({ lang, chunk, fileRelations: cached.cachedBundle.fileRelations })), projected,
      `${lang.id}: persisted typed evidence has the same public projection`);

    const forged = { ...raw, calls: [['first', 'invented']], callDetails: [{ caller: 'first', callee: 'invented' }] };
    const admitted = filterRawRelationsWithLexicon(forged, { languageId: lang.id, config: { enabled: false } });
    assert.deepEqual(admitted.calls, [], 'disabling lexical filtering cannot disable fact-kind admission');
    assert.deepEqual(admitted.callDetails, []);
    assert.deepEqual(buildChunkRelations({ lang, chunk: chunks[0], fileRelations: forged }).calls, [], 'direct consumers also enforce kind');
    const invalid = structuredClone(facts); invalid.references[0].kind = 'call';
    assert.equal(admitManagedReferenceFacts(invalid, lang.id), null, 'unknown kinds cannot enter the canonical reference contract');
    assert.equal(admitManagedReferenceFacts({ ...facts, injected: true }, lang.id), null, 'reference envelope stays closed');
  }
  const control = { calls: [['real', 'actual']], callDetails: [] };
  assert.equal(filterRawRelationsWithLexicon(control, { languageId: 'javascript', config: { enabled: false } }), control,
    'reference policy does not erase ordinary language invocation evidence');
  for (const maxJsonBytes of [1024 * 1024, 8192]) {
    const outDir = path.join(root, `artifacts-${maxJsonBytes}`); await fs.mkdir(outDir);
    const writes = [], pieces = [];
    enqueueFileRelationsArtifacts({ state: { fileRelations: records }, outDir, maxJsonBytes,
      enqueueWrite: (_label, write) => writes.push(write), formatArtifactLabel: value => value,
      addPieceFile: (entry, file) => pieces.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') }) });
    for (const write of writes) await write();
    await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code',
      indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'managed-reference-contract' } });
    const loaded = await loadJsonArrayArtifact(outDir, 'file_relations', { strict: true });
    const result = validateArtifact('file_relations', loaded);
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(new Map(loaded.map(row => [row.file, row.relations])),
      new Map([...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), 'canonical file-relations publication retains exact typed facts');
    const extra = structuredClone(loaded); extra[0].relations.managedReferenceFacts.injected = true;
    assert.equal(validateArtifact('file_relations', extra).ok, false, 'canonical managed reference envelope rejects extra fields');
    const counts = structuredClone(loaded); counts[0].relations.managedReferenceFacts.coverage.retained++;
    assert.equal(validateArtifact('file_relations', counts).ok, false, 'canonical retained counts are exact');
    const identity = structuredClone(loaded);
    const owned = identity.flatMap(row => row.relations.managedReferenceFacts.references).find(row => row.owner);
    assert.ok(owned); owned.owner.id = 'forged-owner';
    assert.equal(validateArtifact('file_relations', identity).ok, false, 'canonical source owner identity is recomputed');
    const span = structuredClone(loaded);
    const envelope = span.find(row => row.relations.managedReferenceFacts.references.some(entry => entry.source)).relations.managedReferenceFacts;
    envelope.references.find(entry => entry.source).source.end = envelope.source.length + 1;
    assert.equal(validateArtifact('file_relations', span).ok, false, 'canonical occurrence extent is inside its admitted source');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed DSL references retain exact kinds and source owners without fabricated invocation pairs');
