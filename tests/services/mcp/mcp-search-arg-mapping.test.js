#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';
import { DEFAULT_MODEL_ID } from '../../../tools/dict-utils.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';

const searchDef = getToolDefs(DEFAULT_MODEL_ID).find((tool) => tool.name === 'search');
const schemaFields = Object.keys(searchDef?.inputSchema?.properties || {});
assert.ok(schemaFields.length > 0, 'search schema fields should exist');

const base = { repoPath: '/repo', query: 'needle' };

const containsSequence = (args, sequence) => {
  const idx = args.findIndex((value, i) => sequence.every((entry, j) => args[i + j] === entry));
  return idx !== -1;
};

const cases = [
  { label: 'mode', args: { mode: 'code' }, expect: ['--mode', 'code'] },
  { label: 'backend', args: { backend: 'sqlite' }, expect: ['--backend', 'sqlite'] },
  { label: 'ann true', args: { ann: true }, expect: ['--ann'] },
  { label: 'ann false', args: { ann: false }, expect: ['--no-ann'] },
  { label: 'top', args: { top: 5 }, expect: ['-n', '5'] },
  { label: 'context', args: { context: 3 }, expect: ['--context', '3'] },
  { label: 'type', args: { type: 'function' }, expect: ['--type', 'function'] },
  { label: 'author', args: { author: 'alice' }, expect: ['--author', 'alice'] },
  { label: 'import', args: { import: 'react' }, expect: ['--import', 'react'] },
  { label: 'calls', args: { calls: 'foo' }, expect: ['--calls', 'foo'] },
  { label: 'uses', args: { uses: 'bar' }, expect: ['--uses', 'bar'] },
  { label: 'signature', args: { signature: 'baz' }, expect: ['--signature', 'baz'] },
  { label: 'param', args: { param: 'qux' }, expect: ['--param', 'qux'] },
  { label: 'decorator', args: { decorator: 'dec' }, expect: ['--decorator', 'dec'] },
  { label: 'inferredType', args: { inferredType: 'T' }, expect: ['--inferred-type', 'T'] },
  { label: 'returnType', args: { returnType: 'R' }, expect: ['--return-type', 'R'] },
  { label: 'throws', args: { throws: 'E' }, expect: ['--throws', 'E'] },
  { label: 'reads', args: { reads: 'x' }, expect: ['--reads', 'x'] },
  { label: 'writes', args: { writes: 'y' }, expect: ['--writes', 'y'] },
  { label: 'mutates', args: { mutates: 'z' }, expect: ['--mutates', 'z'] },
  { label: 'alias', args: { alias: 'a' }, expect: ['--alias', 'a'] },
  { label: 'awaits', args: { awaits: 'aw' }, expect: ['--awaits', 'aw'] },
  { label: 'risk', args: { risk: 'r' }, expect: ['--risk', 'r'] },
  { label: 'riskTag', args: { riskTag: 'rt' }, expect: ['--risk-tag', 'rt'] },
  { label: 'riskSource', args: { riskSource: 'rs' }, expect: ['--risk-source', 'rs'] },
  { label: 'riskSink', args: { riskSink: 'rk' }, expect: ['--risk-sink', 'rk'] },
  { label: 'riskCategory', args: { riskCategory: 'rc' }, expect: ['--risk-category', 'rc'] },
  { label: 'riskFlow', args: { riskFlow: 'rf' }, expect: ['--risk-flow', 'rf'] },
  { label: 'branchesMin', args: { branchesMin: 2 }, expect: ['--branches', '2'] },
  { label: 'loopsMin', args: { loopsMin: 1 }, expect: ['--loops', '1'] },
  { label: 'breaksMin', args: { breaksMin: 1 }, expect: ['--breaks', '1'] },
  { label: 'continuesMin', args: { continuesMin: 1 }, expect: ['--continues', '1'] },
  { label: 'visibility', args: { visibility: 'public' }, expect: ['--visibility', 'public'] },
  { label: 'extends', args: { extends: 'Base' }, expect: ['--extends', 'Base'] },
  { label: 'async', args: { async: true }, expect: ['--async'] },
  { label: 'generator', args: { generator: true }, expect: ['--generator'] },
  { label: 'returns', args: { returns: true }, expect: ['--returns'] },
  { label: 'churnMin', args: { churnMin: 5 }, expect: ['--churn', '5'] },
  { label: 'chunkAuthor', args: { chunkAuthor: 'bob' }, expect: ['--chunk-author', 'bob'] },
  { label: 'modifiedAfter', args: { modifiedAfter: '2025-01-01' }, expect: ['--modified-after', '2025-01-01'] },
  { label: 'modifiedSince', args: { modifiedSince: 7 }, expect: ['--modified-since', '7'] },
  { label: 'lint', args: { lint: true }, expect: ['--lint'] },
  { label: 'path', args: { path: 'src/' }, expect: ['--path', 'src/'] },
  { label: 'file', args: { file: 'index.js' }, expect: ['--path', 'index.js'] },
  { label: 'ext', args: { ext: '.js' }, expect: ['--ext', '.js'] },
  { label: 'lang', args: { lang: 'javascript' }, expect: ['--lang', 'javascript'] },
  { label: 'branch', args: { branch: 'main' }, expect: ['--branch', 'main'] },
  { label: 'case', args: { case: true }, expect: ['--case'] },
  { label: 'caseFile', args: { caseFile: true }, expect: ['--case-file'] },
  { label: 'caseTokens', args: { caseTokens: true }, expect: ['--case-tokens'] },
  { label: 'meta', args: { meta: { key: 'value' } }, expect: ['--meta', 'key=value'] },
  { label: 'metaJson', args: { metaJson: { foo: 'bar' } }, expect: ['--meta-json', JSON.stringify({ foo: 'bar' })] }
];

for (const entry of cases) {
  const args = buildMcpSearchArgs({ ...base, ...entry.args });
  if (entry.expect && !containsSequence(args, entry.expect)) {
    throw new Error(`Expected ${entry.label} mapping: ${entry.expect.join(' ')}`);
  }
}

const outputFull = buildMcpSearchArgs({ ...base, output: 'full' });
assert.ok(!outputFull.includes('--compact'), 'output=full should omit --compact');

const outputCompact = buildMcpSearchArgs({ ...base, output: 'compact' });
assert.ok(outputCompact.includes('--compact'), 'output=compact should include --compact');

let unknownFailed = false;
try {
  buildMcpSearchArgs({ ...base, unknownField: 'nope' });
} catch {
  unknownFailed = true;
}
assert.ok(unknownFailed, 'unknown MCP search fields should be rejected');

console.log('MCP search arg mapping tests passed.');
