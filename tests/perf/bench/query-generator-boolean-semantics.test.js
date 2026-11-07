import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { queryLiteral, queryAnd, queryOr, queryNot, admitGeneratedQuery } from '../../../tools/bench/query-expression.js';
import { generateWeightedQuerySet } from '../../../tools/bench/query-generator.js';
import { parseQueryInput, annotateQueryAst } from '../../../src/retrieval/query-parse.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
import { readQueryInputPlan } from '../../../tools/shared/query-file-utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { BENCH_QUERY_WORKLOAD_VERSION } from '../../../src/contracts/benchmark-query-workload.js';

const or = admitGeneratedQuery(queryOr(queryLiteral('middleware'), queryLiteral('createRouter')));
assert.equal(parseQueryInput(or.query).ast.type, 'or');
assert.equal(or.queryShape.observedClass, 'or');
const exclusion = admitGeneratedQuery(queryAnd(queryLiteral('createRouter'), queryNot(queryLiteral('retry'))));
const eligible = (query, chunks) => {
  const queryAst = annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, { enablePhraseNgrams: false });
  const matcher = createQueryAstHelpers({ queryAst }).matchesQueryAst;
  return chunks.flatMap((chunk, id) => matcher({ chunkMeta: chunks }, id, chunk, false) ? [id] : []);
};
assert.deepEqual(eligible(or.query, [
  { tokens: ['middleware'] }, { tokens: ['create', 'router'] }, { tokens: ['unrelated'] }
]), [0, 1], 'OR must admit either independently authored branch, not require the whole phrase');
assert.deepEqual(eligible(exclusion.query, [
  { tokens: ['create', 'router'] }, { tokens: ['create', 'router', 'retry'] }, { tokens: ['retry'] }
]), [0], 'the negative leaf must reject a positive-name hit containing the risk term');
for (const value of ['middleware OR createRouter', 'createRouter -retry', 'a-b']) {
  const literal = admitGeneratedQuery(queryLiteral(value, { phrase: true }));
  const ast = parseQueryInput(literal.query).ast;
  assert.equal(ast.type, 'phrase');
  assert.equal(ast.value, value);
  assert.equal(literal.queryShape.counts.or, 0);
  assert.equal(literal.queryShape.counts.not, 0);
}
for (const value of ['C:\\cache\\code', 'say "hello"', "don't retry", 'createRouter(config): Router']) {
  const literal = admitGeneratedQuery(queryLiteral(value));
  assert.equal(parseQueryInput(literal.query).ast.value, value, 'supported delimiters/backslashes round-trip literally');
}
const dotted = admitGeneratedQuery(queryLiteral('Namespace.Service.createRouter'));
assert.equal(parseQueryInput(dotted.query).ast.value, 'Namespace.Service.createRouter');
assert.equal(parseQueryInput(dotted.query).ast.type, 'term');
assert.throws(() => queryLiteral('both "double" and \'single\' delimiters'), { code: 'ERR_BENCH_QUERY_LITERAL' });
assert.throws(() => queryNot(queryOr(queryLiteral('a'), queryLiteral('b'))), { code: 'ERR_BENCH_QUERY_STRUCTURE' });

const chunks = [
  { name: 'createRouter', kind: 'function', language: 'javascript', docmeta: {
    signature: 'createRouter(config): Router', returnType: 'Router', doc: 'routing middleware validate lookup fallback timeout', risk: { tags: ['retry', 'auth'] } } },
  { name: 'registerPlugin', kind: 'function', language: 'javascript', docmeta: {
    signature: 'registerPlugin(name): Plugin', returnType: 'Plugin', doc: 'register plugins validate lifecycle retry hooks', risk: { tags: ['retry', 'lifecycle'] } } }
];
const observed = { or: 0, not: 0, phrase: 0 };
for (const seed of ['operators-a', 'operators-b', 'operators-c']) {
  const input = { chunks, count: 40, seed, intentWeights: 'symbol=1,type=1,api=3,behavior=1', adversarialRatio: 0.5 };
  const generated = generateWeightedQuerySet(input);
  assert.deepEqual(generated, generateWeightedQuerySet(input));
  assert.equal(generated.generation.emittedCount, generated.querySet.length);
  for (const entry of generated.querySet) {
    const ast = parseQueryInput(entry.query).ast;
    const counts = { term: 0, phrase: 0, and: 0, or: 0, not: 0 };
    const visit = node => { counts[node.type]++; if (node.left) visit(node.left);
      if (node.right) visit(node.right); if (node.child) visit(node.child); };
    visit(ast);
    assert.deepEqual(entry.queryShape.counts, counts, 'shape counts must describe parsed operators, not the adversarial label');
    observed.or += counts.or; observed.not += counts.not; observed.phrase += counts.phrase;
  }
}
assert.ok(observed.or > 0 && observed.not > 0 && observed.phrase > 0, 'generated workloads need real Boolean and literal coverage');
const rejected = generateWeightedQuerySet({ chunks: [{ ...chunks[0], docmeta: {
  ...chunks[0].docmeta, signature: 'both "double" and \'single\'' } }], count: 40, seed: 'unsupported-literals',
intentWeights: 'api=1,symbol=0,type=0,behavior=0', adversarialRatio: 0.5 });
assert.ok(rejected.generation.rejections.count > 0);
assert.ok(rejected.generation.rejections.samples.length <= 16);
assert.ok(rejected.querySet.every(row => parseQueryInput(row.query).ast));

const { dir } = await prepareIsolatedTestCacheDir('generated-query-workload-admission');
try {
  const file = path.join(dir, 'workload.json');
  const rows = [or, exclusion].map((entry, index) => ({ ...entry, intentClass: 'api', variant: 'adversarial', weight: 1, index }));
  const payload = { schemaVersion: BENCH_QUERY_WORKLOAD_VERSION, kind: 'bench-query-workload', querySet: rows, queries: rows.map(row => row.query), count: 2,
    generation: { schemaVersion: BENCH_QUERY_WORKLOAD_VERSION, requestedCount: 2, emittedCount: 2, complete: true } };
  await fs.writeFile(file, JSON.stringify(payload));
  const plan = await readQueryInputPlan(file);
  assert.deepEqual(plan.cases.map(row => row.query), [or.query, exclusion.query]);
  assert.equal(plan.source.producer.qualification, 'producer-declared');
  assert.equal(plan.source.producer.complete, true);
  await fs.writeFile(file, JSON.stringify({ ...payload, queries: [or.query, 'substituted'] }));
  await assert.rejects(readQueryInputPlan(file), { code: 'ERR_QUERY_INPUT' });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('generated Boolean query intent, production parse and independent eligibility test passed');
