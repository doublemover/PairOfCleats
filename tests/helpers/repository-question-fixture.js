import { DatabaseSync } from 'node:sqlite';
import { createSemanticServingFixture } from './semantic-serving-fixture.js';
import { openPublishedSemanticStore } from '../../src/semantic/published-store.js';
import { createSqliteSemanticStore } from '../../src/semantic/sqlite-store.js';
import { ingestSemanticPartition } from '../../src/storage/sqlite/semantic/ingest.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../src/storage/sqlite/semantic/schema.js';
import { writeSqliteIndexFormat } from '../../src/storage/sqlite/index-format.js';
import { SCHEMA_VERSION } from '../../src/storage/sqlite/schema.js';
import { SOURCE_ORDER_META_KEY, SOURCE_ORDER_VERSION } from '../../src/semantic/source-order.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { REPOSITORY_QUESTION_VERSION } from '../../src/contracts/schemas/repository-question.js';
import { describeQuestionWorld } from '../../src/semantic/questions/current-reader-profile.js';

/** Synthetic retained facts with matching literal/source spans. Real partition,
 * index, registration and SQLite ingestors own every physical representation.
 * Extraction correctness has its own language fixtures; no parser is mocked here.
 */
export const createRepositoryQuestionFixture = async ({ scalar = { type: 'number', representation: '0' },
  secondScalar = { type: 'number', representation: '1' }, operandFlags = [] } = {}) => {
  const display = value => value.type === 'string' ? JSON.stringify(value.representation) : value.representation;
  const firstPrefix = 'parseRequest(1, ', secondPrefix = 'other(1, ';
  const firstText = firstPrefix + display(scalar) + ');', secondText = secondPrefix + display(secondScalar) + ');';
  const sourceText = firstText + ' ' + secondText + ' function parseRequest(){} function other(){} function parseRequest(){}';
  const spans = { first: [0, firstText.length], second: [firstText.length + 1, firstText.length + 1 + secondText.length],
    literal: [firstPrefix.length, firstPrefix.length + display(scalar).length],
    secondLiteral: [firstText.length + 1 + secondPrefix.length, firstText.length + 1 + secondPrefix.length + display(secondScalar).length] };
  let canonicalRows, ref;
  const fixture = await createSemanticServingFixture({ sourceText, buildRows: input => {
    ref = localId => ({ partitionId: input.partitionId, localId });
    const node = (id, kind, span, data) => ({ family: 'node', row: { id, kind, span, scope: null, data } });
    const invocation = { astKind: 'CallExpression', operation: null, invocationKind: 'call', syntacticArgumentCount: 2, flags: [] };
    const declaration = nameId => ({ nameId, declarationKind: 'function', flags: [], initializer: null, typeSyntax: null });
    const declarationSpan = name => {
      const start = sourceText.indexOf('function ' + name); return [start, start + ('function ' + name + '(){}').length];
    };
    const edge = (id, from, to, contextKey) => ({ family: 'edge', row: { id, kind: 'callTarget', from: ref(from), to: ref(to),
      callSite: ref(from), operandOrdinal: null, contextKey, condition: null, evidence: null, certainty: 'modeled' } });
    canonicalRows = [node(0, 'expression', spans.first, { ...invocation }), node(1, 'expression', spans.second, { ...invocation }),
      node(2, 'declaration', declarationSpan('parseRequest'), declaration(0)), node(3, 'declaration', declarationSpan('other'), declaration(1)),
      node(4, 'literal', spans.literal, { literalKind: scalar.type, textRef: { span: spans.literal }, scalar }),
      node(5, 'literal', spans.secondLiteral, { literalKind: secondScalar.type, textRef: { span: spans.secondLiteral }, scalar: secondScalar }),
      node(6, 'occurrence', [0, 12], { nameId: 0, roles: ['call'], expression: ref(0), flags: [] }),
      node(7, 'occurrence', [spans.second[0], spans.second[0] + 5], { nameId: 1, roles: ['call'], expression: ref(1), flags: [] }),
      node(8, 'declaration', [sourceText.lastIndexOf('function parseRequest'), sourceText.length], declaration(0)),
      { family: 'lookup', row: { id: 0, kind: 'name', value: 'parseRequest' } },
      { family: 'lookup', row: { id: 1, kind: 'name', value: 'other' } },
      { family: 'operand', row: { parent: ref(0), slot: 'argument', ordinal: 1, child: ref(4), flags: operandFlags } },
      { family: 'operand', row: { parent: ref(1), slot: 'argument', ordinal: 1, child: ref(5), flags: [] } },
      edge(0, 0, 2, 'direct-context'), edge(1, 6, 8, 'compiler-context'), edge(2, 1, 3, 'other-call-context'),
      edge(3, 6, 2, 'duplicate-candidate-context')];
    return canonicalRows;
  } });
  let native;
  try {
    const opened = await openPublishedSemanticStore({ indexDir: fixture.indexDir, repoRoot: fixture.root,
      generation: fixture.generation, requireQueryIndex: true });
    const artifact = opened.store;
    native = new DatabaseSync(':memory:');
    const db = { prepare: sql => native.prepare(sql), exec: sql => native.exec(sql),
      pragma: name => Object.values(native.prepare('PRAGMA ' + name).get())[0], get inTransaction() { return native.isTransaction; } };
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
    db.exec('BEGIN');
    await ingestSemanticPartition({ db, store: artifact, descriptor: fixture.partition });
    db.prepare('INSERT OR REPLACE INTO index_format_meta VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
    db.prepare('INSERT OR REPLACE INTO index_format_meta VALUES (?,?)').run(SOURCE_ORDER_META_KEY, SOURCE_ORDER_VERSION);
    db.exec('COMMIT');
    const sqlite = createSqliteSemanticStore({ db, repoRoot: fixture.root, indexPath: ':memory:', generation: fixture.generation,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, manifest: fixture.manifest });
    const scan = { sourcePaths: ['original.js'], invocationKind: 'call' };
    const world = describeQuestionWorld(artifact, scan);
    const question = { schemaVersion: REPOSITORY_QUESTION_VERSION, world, semantics: 'retained-facts',
      bind: [{ id: 'c', sort: 'Invocation', scan }, { id: 'd', sort: 'Declaration' }, { id: 'a', sort: 'Literal' }],
      where: { all: [{ id: 'target', predicate: 'recordedTargetCandidate', args: ['$c', '$d'] },
        { id: 'name', predicate: 'declaredNameEquals', args: ['$d', 'parseRequest'] },
        { id: 'argument', predicate: 'operandAt', args: ['$c', 'argument', 1, '$a'] },
        { id: 'zero', predicate: 'parserLiteralEquals', args: ['$a', { type: 'number', representation: '0' }] }] },
      select: ['$c', '$d', '$a'], distinctBy: ['$c', '$d', '$a'], order: { kind: 'source-order' } };
    const request = { schemaVersion: REPOSITORY_QUESTION_VERSION, repoRoot: fixture.root, generation: fixture.generation, mode: 'execute', question };
    return { ...fixture, artifact, sqlite, db, canonicalRows, request, ref,
      cleanup: async () => { native.close(); await fixture.cleanup(); } };
  } catch (error) { native?.close(); await fixture.cleanup(); throw error; }
};
