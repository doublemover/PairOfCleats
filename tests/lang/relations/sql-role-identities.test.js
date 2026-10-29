import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildFileRelations, stripFileRelations } from '../../../src/index/build/file-processor/relations.js';
import { enqueueFileRelationsArtifacts } from '../../../src/index/build/artifacts/writers/file-relations.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { buildCrossFileFingerprint } from '../../../src/index/type-inference-crossfile/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { SQL_RELATION_PRODUCER_VERSION } from '../../../src/lang/sql/version.js';
import { SQL_RELATION_EVIDENCE_SCHEMA } from '../../../src/contracts/schemas/sql-relations.js';

applyTestEnv();
const route = getLanguageForFile('.sql', 'query.sql');
const options = { sql: { dialect: 'postgresql' }, treeSitter: { enabled: false } };
const records = new Map();
const sources = new Map();
const extract = async (text, file) => {
  const input = { text, relPath: file, ext: '.sql', options };
  const context = await route.prepare(input);
  const relations = route.buildRelations({ ...input, context });
  const projected = buildFileRelations(relations, file);
  records.set(file, projected);
  sources.set(file, text);
  assert.equal(stripFileRelations(relations).sqlRelationEvidence, undefined, 'file evidence is not duplicated on every chunk');
  return relations;
};
const names = result => result.sqlRelationEvidence.occurrences.filter(row => row.role === 'relation-use').map(row => row.parts).sort();
const first = await extract('SELECT u.id FROM public.users AS u;', 'first.sql');
assert.equal(SQL_RELATION_EVIDENCE_SCHEMA.properties.producerVersion.const, SQL_RELATION_PRODUCER_VERSION);
assert.equal(first.sqlRelationEvidence.producerVersion, SQL_RELATION_PRODUCER_VERSION);
assert.equal(validateArtifact('file_relations', [{ file: 'first.sql', relations: records.get('first.sql') }]).ok, true);
const oldProducer = structuredClone(records.get('first.sql'));
oldProducer.sqlRelationEvidence.producerVersion = String(Number(SQL_RELATION_PRODUCER_VERSION) - 1);
assert.equal(validateArtifact('file_relations', [{ file: 'first.sql', relations: oldProducer }]).ok, false,
  'canonical synchronization does not admit a historical producer');
const renamed = await extract('SELECT account.id FROM public.users AS account;', 'renamed.sql');
assert.deepEqual(names(first), [['public', 'users']]); assert.deepEqual(names(renamed), names(first));
assert.deepEqual(first.usages, ['public.users']); assert.deepEqual(renamed.usages, first.usages);
assert.ok(first.sqlRelationEvidence.occurrences.some(row => row.role === 'column-qualifier' && row.parts[0] === 'u'));
assert.ok(first.sqlRelationEvidence.occurrences.some(row => row.role === 'query-alias' && row.alias === 'u'));
assert.equal(first.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-use').decodedNameId,
  renamed.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-use').decodedNameId);
assert.notEqual(first.sqlRelationEvidence.textHash, renamed.sqlRelationEvidence.textHash);
assert.notEqual(first.sqlRelationEvidence.occurrences[0].occurrenceId, renamed.sqlRelationEvidence.occurrences[0].occurrenceId);
const schemas = await extract('SELECT a.id, b.id FROM public.users a JOIN app.users b ON a.id = b.id;', 'schemas.sql');
assert.deepEqual(names(schemas), [['app', 'users'], ['public', 'users']]);
const literal = await extract('SELECT id FROM "public.users";', 'literal.sql');
assert.deepEqual(names(literal), [['public.users']]); assert.deepEqual(literal.usages, ['"public.users"']);
assert.notEqual(literal.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-use').decodedNameId,
  first.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-use').decodedNameId);
const oddName = ' odd[na`me].x ';
const odd = await extract(`CREATE TABLE public."${oddName}" (id integer); SELECT t.id FROM public."${oddName}" AS t;`, 'odd.sql');
assert.deepEqual(names(odd), [['public', oddName]]);
const declaration = odd.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-declaration');
assert.deepEqual(declaration.parts, ['public', oddName]);
assert.equal(declaration.decodedNameId, odd.sqlRelationEvidence.occurrences.find(row => row.role === 'relation-use').decodedNameId);
assert.deepEqual(odd.usages, [`public."${oddName}"`]);
assert.ok(odd.exports.some(name => name.includes(oddName)), 'native/lexical declaration preservation remains meaningful');
const cte = await extract('WITH users AS (SELECT id FROM public.actual) SELECT users.id FROM users;', 'cte.sql');
assert.deepEqual(names(cte), [['public', 'actual']]);
assert.ok(cte.sqlRelationEvidence.occurrences.some(row => row.role === 'cte-reference-candidate' && row.parts[0] === 'users'));
assert.ok(cte.sqlRelationEvidence.coverage.reasons.cte_scope_conservative);
const derived = await extract('SELECT sq.id FROM (SELECT id FROM public.users) AS sq;', 'derived.sql');
assert.deepEqual(names(derived), [['public', 'users']]);
assert.ok(derived.sqlRelationEvidence.occurrences.some(row => row.role === 'derived-binding'));
assert.ok(!derived.usages.includes('sq'));
const altered = await extract('ALTER TABLE public.users RENAME TO renamed_users;', 'altered.sql');
assert.deepEqual(names(altered), [['public', 'users']], 'an ALTER target is a relation; a new name inside its action is not another usage');
const empty = await extract('SELECT 1;', 'empty.sql');
assert.deepEqual(empty.usages, []); assert.equal(empty.sqlRelationEvidence.coverage.recognition, 'recognized-empty');
const failed = await extract('SELECT {{ dynamic }} FROM users;', 'failed.sql');
assert.deepEqual(failed.usages, []); assert.equal(failed.sqlRelationEvidence.coverage.recognition, 'unavailable');
assert.ok(failed.sqlRelationEvidence.coverage.reasons.parser_failed);
const oversizedInput = '/*' + 'x'.repeat(512 * 1024) + '*/ SELECT id FROM users;';
const oversized = await extract(oversizedInput, 'oversized.sql');
assert.equal(oversized.sqlRelationEvidence.textHash, null, 'oversized input is not claimed as an admitted parser snapshot');
assert.ok(oversized.sqlRelationEvidence.coverage.reasons.source_budget);

const root = resolveTestCachePath(process.cwd(), `sql-role-identities-${randomUUID()}`);
try {
  const bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir, { recursive: true });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  for (const relKey of ['first.sql', 'literal.sql', 'odd.sql', 'cte.sql', 'derived.sql', 'failed.sql']) {
    const text = sources.get(relKey), absPath = path.join(root, relKey); await fs.writeFile(absPath, text);
    const stat = await fs.stat(absPath), relations = records.get(relKey);
    manifest.files[relKey] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey,
      fileStat: stat, fileHash: sha1(text), fileChunks: [], bundleFormat: 'json', fileRelations: relations });
    const { cachedBundle } = await readCachedBundle({ enabled: true, absPath, relKey, fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
    assert.deepEqual(cachedBundle.fileRelations.sqlRelationEvidence, relations.sqlRelationEvidence);
    assert.deepEqual(cachedBundle.fileRelations.usages, relations.usages);
    const fingerprint = value => buildCrossFileFingerprint({ chunks: [], fileRelations: new Map([[relKey, value]]), enableTypeInference: true });
    assert.equal(fingerprint(cachedBundle.fileRelations), fingerprint(relations), 'the actual usage-cache input retains source and role identity after bundle replay');
  }
  for (const maxJsonBytes of [1024 * 1024, 8192]) {
    const outDir = path.join(root, String(maxJsonBytes)); await fs.mkdir(outDir, { recursive: true });
    const writes = [], pieces = [];
    enqueueFileRelationsArtifacts({ state: { fileRelations: records }, outDir, maxJsonBytes,
      enqueueWrite: (_label, write) => writes.push(write), formatArtifactLabel: value => value,
      addPieceFile: (entry, file) => pieces.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') }) });
    for (const write of writes) await write();
    assert.ok(pieces.some(row => row.name === (maxJsonBytes === 8192 ? 'file_relations_meta' : 'file_relations')),
      'both ordinary JSON and actual sharded publication paths are exercised');
    await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code',
      indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'sql-role-identities' } });
    const loaded = await loadJsonArrayArtifact(outDir, 'file_relations', { strict: true });
    const validation = validateArtifact('file_relations', loaded);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    const restored = new Map(loaded.map(row => [row.file, row.relations]));
    assert.deepEqual(restored, new Map([...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    const fingerprint = fileRelations => buildCrossFileFingerprint({ chunks: [], fileRelations, enableTypeInference: true });
    assert.equal(fingerprint(restored), fingerprint(records), 'the actual usage-cache consumer sees the same persisted typed inputs');
    const bare = new Map([...restored].map(([file, row]) => { const { sqlRelationEvidence, ...legacy } = row; return [file, legacy]; }));
    assert.notEqual(fingerprint(restored), fingerprint(bare), 'historical empty arrays cannot stand in for extraction qualification');
    const corrupt = structuredClone(loaded); corrupt[0].relations.sqlRelationEvidence.occurrences[0].role = 'any-table-property';
    assert.equal(validateArtifact('file_relations', corrupt).ok, false, 'typed roles remain an artifact contract');
    const forged = structuredClone(loaded); forged[0].relations.sqlRelationEvidence.occurrences[0].parts = ['invented'];
    assert.equal(validateArtifact('file_relations', forged).ok, false, 'changing decoded parts cannot retain an old occurrence/name identity');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Registered SQL relation roles preserve decoded names, namespace segments, source occurrences and durable qualification.');
