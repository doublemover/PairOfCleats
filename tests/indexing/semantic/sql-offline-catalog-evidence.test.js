import assert from 'node:assert/strict';
import { collectOfflineSqlCatalogEvidence, SQL_CATALOG_PROVIDER_DECLARATION } from '../../../src/index/tooling/sql-catalog-evidence.js';
import { qualifySqlSelectRanges } from '../../../src/index/tooling/sql-source-qualifier.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

const definitions = [
  { schema: 'public', name: 'users', columns: ['id', 'name'], text: 'CREATE TABLE public.users (id integer, name text);' },
  { schema: 'app', name: 'users', columns: ['id', 'secret'], text: 'CREATE TABLE app.users (id integer, secret text);' },
  { schema: 'public', name: 'teams', columns: ['id'], text: 'CREATE TABLE public.teams (id integer);' },
  { schema: 'public', name: 'Users', columns: ['Name'], text: 'CREATE TABLE public."Users" ("Name" text);' },
  { schema: 'public', name: 'session_temp', columns: ['id'], temporary: true, text: 'CREATE TEMP TABLE session_temp (id integer);' }
];
const schema = '-- 🧭 original migration\n' + definitions.map(value => value.text).join('\n');
const queries = [
  { filename: 'plain.sql', text: 'SELECT id FROM users;' },
  { filename: 'ambiguous.sql', text: 'SELECT id, u.id FROM users AS u JOIN teams AS t ON u.id = t.id;' },
  { filename: 'quoted.sql', text: 'SELECT "Name" FROM "Users";' },
  { filename: 'temporary.sql', text: 'SELECT id FROM session_temp;' },
  { filename: 'template.sql', text: 'SELECT {{ dynamic }} FROM users;' },
  { filename: 'nested.sql', text: 'WITH a AS (SELECT id FROM users) SELECT id FROM a;' }
];
const f = await createSourceLinkedEvidenceFixture([{ filename: 'schema.sql', language: 'sql', text: schema },
  ...queries.map(value => ({ ...value, language: 'sql' }))]);
try {
  assertProviderDeclaration(SQL_CATALOG_PROVIDER_DECLARATION);
  const schemaSource = f.sources.get('schema.sql').source;
  const witness = span => ({ path: 'schema.sql', sourceUnitId: schemaSource.sourceUnitId, sourceHash: schemaSource.byteHash, span });
  const snapshot = searchPath => {
    const tables = definitions.map(definition => {
      const line = schema.indexOf(definition.text), quoted = definition.name === 'Users';
      const tableName = quoted ? '"Users"' : definition.name, nameStart = schema.indexOf(tableName, line);
      return { schema: definition.schema, name: definition.name, temporary: definition.temporary === true,
        source: witness([nameStart, nameStart + tableName.length]), columns: definition.columns.map(column => {
          const token = column === 'Name' ? '"Name"' : column, start = schema.indexOf(token, nameStart + tableName.length);
          return { name: column, source: witness([start, start + token.length]) };
        }) };
    });
    const input = { schemaVersion: 1, generation: f.generation,
      context: { dialect: 'postgresql', serverVersion: '17-fixture-not-executed', searchPath,
        extensions: [], migrationIdentity: semanticHash('fixture.sql-migrations.v1', { hash: schemaSource.byteHash }) }, tables };
    return { ...input, identity: semanticHash('tooling.sql-offline-catalog.v1', input) };
  };
  const catalog = snapshot(['public', 'app']);
  const options = { catalog, expectedCatalogIdentity: catalog.identity, expectedContext: catalog.context, generation: f.generation,
    documents: f.sources, queryPaths: queries.map(value => value.filename), configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) };
  const report = collectOfflineSqlCatalogEvidence(options);
  const plain = report.results.find(value => value.path === 'plain.sql');
  assert.equal(plain.references.find(value => value.family === 'sqlTable').catalogObject.schema, 'public');
  assert.equal(plain.references.find(value => value.family === 'sqlColumn').state, 'resolved');
  const swapped = snapshot(['app', 'public']);
  const app = collectOfflineSqlCatalogEvidence({ ...options, catalog: swapped, expectedCatalogIdentity: swapped.identity, expectedContext: swapped.context });
  assert.equal(app.results.find(value => value.path === 'plain.sql').references.find(value => value.family === 'sqlTable').catalogObject.schema, 'app');
  assert.notEqual(app.identity, report.identity, 'search_path changes cannot reuse the same derived report');
  const ambiguous = report.results.find(value => value.path === 'ambiguous.sql');
  assert.ok(ambiguous.references.some(value => value.family === 'sqlColumn' && value.reason === 'ambiguous_column' && value.candidates.length === 2));
  assert.ok(ambiguous.references.some(value => value.name === 'u.id' && value.state === 'resolved'));
  const quoted = report.results.find(value => value.path === 'quoted.sql');
  assert.equal(quoted.references.find(value => value.family === 'sqlTable').catalogObject.name, 'Users');
  assert.equal(quoted.references.find(value => value.family === 'sqlColumn').state, 'resolved');
  assert.ok(report.results.find(value => value.path === 'temporary.sql').references.some(value => value.reason === 'temporary_object_context_unknown'));
  assert.equal(report.results.find(value => value.path === 'template.sql').reason, 'syntax_or_dialect_unsupported');
  assert.ok(report.results.find(value => value.path === 'nested.sql').diagnostics.some(value => value.code === 'query_scope_unsupported'));
  const ranges = qualifySqlSelectRanges('SELECT id FROM users WHERE name = $$ FROM hidden JOIN bogus $$;');
  assert.deepEqual(ranges[0].tables.map(value => value.parts), [['users']], 'quoted strings cannot introduce table heads');
  const stale = structuredClone(catalog); stale.tables[0].source.sourceHash = 'f'.repeat(64);
  const { identity: _identity, ...staleIdentity } = stale; stale.identity = semanticHash('tooling.sql-offline-catalog.v1', staleIdentity);
  assert.throws(() => collectOfflineSqlCatalogEvidence({ ...options, catalog: stale, expectedCatalogIdentity: stale.identity }), { code: 'ERR_SQL_CATALOG_EVIDENCE' });
  assert.throws(() => collectOfflineSqlCatalogEvidence({ ...options, expectedContext: swapped.context }), { code: 'ERR_SQL_CATALOG_EVIDENCE' });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const partition = written.output.partitions.find(value => value.sourceUnitId === plain.sourceUnitId);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.ok(detail.navigationCandidates.some(value => value.family === 'sqlColumn' && value.path === 'schema.sql'));
  assert.equal(detail.report.coverage.databaseConnected, false);
  assert.equal(detail.report.coverage.migrationsExecuted, false);
  assert.equal(detail.partial, true);
  console.log('offline PostgreSQL catalog/search_path/ambiguity/source witnesses through canonical evidence detail');
} finally { await f.cleanup(); }
