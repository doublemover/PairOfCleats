#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, extractTypeScriptDocMeta } from '../../../src/lang/typescript.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { runSearchCli } from '../../../src/retrieval/cli.js';

// Real compiler/provider + production metadata projection, persisted as a tiny
// compatible index. No model, full repository build, or hand-authored type facts.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-compiler-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  const text = [
    'interface Promise<T> { readonly value: T }',
    'export class Base {}',
    'export class Derived extends Base {}',
    'export function target(flag: boolean) { return flag; }',
    'export function caller(flag: boolean) { return target(flag); }',
    'export function shape(flag: boolean) { return { ok: flag, count: 1 }; }',
    'export function union(flag: boolean): boolean | string { return flag ? "yes" : false; }',
    'export function wrapper(flag: boolean): Promise<boolean> { return { value: flag }; }',
    'export function literal(): true { return true; }'
  ].join('\n');
  await fs.writeFile(path.join(root, 'main.ts'), text);
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { noLib: true, types: [], strict: true }, files: ['main.ts']
  }));
  const parsed = buildTypeScriptChunks(text, { ext: '.ts', parser: 'typescript' });
  assert.ok(parsed.some(chunk => chunk.kind === 'ClassDeclaration' && chunk.name === 'Derived'));
  const relations = buildTypeScriptRelations(text, parsed, { ext: '.ts' });
  const chunks = parsed.map((chunk, id) => ({
    ...chunk, id, file: 'main.ts', lang: 'typescript', ext: '.ts', chunkUid: `ck:compiler:${chunk.name}`,
    docmeta: extractTypeScriptDocMeta(chunk),
    codeRelations: { calls: relations.calls.filter(([caller]) => caller === chunk.name) }
  }));
  const toolingDocuments = {
    documents: [{ virtualPath: '.vfs/main.ts', containerPath: 'main.ts', effectiveExt: '.ts', languageId: 'typescript', text }],
    targets: chunks.filter(chunk => chunk.kind === 'FunctionDeclaration').map(chunk => ({
      languageId: 'typescript', virtualPath: '.vfs/main.ts', virtualRange: { start: chunk.start, end: chunk.end },
      chunkRef: { chunkUid: chunk.chunkUid, file: chunk.file, start: chunk.start, end: chunk.end },
      symbolHint: { name: chunk.name, kind: 'function' }
    }))
  };
  const stats = await runToolingPass({
    rootDir: root, buildRoot: root, chunks, entryByUid: new Map(), log: () => {}, toolingDocuments,
    toolingConfig: { enabledTools: ['typescript'], cache: { enabled: false },
      typescript: { resolveOrder: ['global'], typeRepresentation: 'legacy' } }
  });
  assert.equal(stats.toolingProvidersExecuted, 1);
  assert.equal(stats.toolingProvidersContributed, 1);
  assert.equal(stats.toolingRequestFailures, 0);
  assert.equal(stats.toolingRequestTimeouts, 0);
  for (const chunk of chunks) chunk.metaV2 = buildMetaV2({ chunk, docmeta: chunk.docmeta });
  const byName = name => chunks.find(chunk => chunk.name === name);
  assert.equal(byName('target').metaV2.types.tooling.returns[0].type, 'boolean');
  assert.equal(byName('target').metaV2.types.tooling.returns[0].source, 'tooling');
  assert.ok(byName('target').docmeta.tooling.sources.some(source => source.provider === 'typescript'));
  const shapeType = byName('shape').metaV2.types.tooling.returns[0].type;
  assert.match(shapeType, /ok: boolean/);
  assert.match(shapeType, /count: number/);
  const indexDir = await createCompatibilityIndex(root, { compatibilityKey: 'compiler-filter-fixture', profileId: 'default' });
  // Strip the compatibility docmeta carrier from one actual compiler result to
  // prove persisted metaV2.types.tooling remains a first-class fact source.
  delete byName('caller').docmeta;
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunks));
  const search = args => runSearchCli(['--repo', root, '--mode', 'code', '--backend', 'memory',
    '--json', '--compact', '--no-comments', '--top', '100', ...args], { emitOutput: false, exitOnError: false });
  const booleans = await search(['--return-type', 'boolean']);
  assert.deepEqual(booleans.code.map(hit => hit.name), ['target', 'caller']);
  for (const hit of booleans.code) {
    assert.equal(hit.filterEvidence.returnType.match, 'type-expression-exact');
    assert.deepEqual(hit.filterEvidence.returnType.facts.map(fact => fact.source), ['tooling']);
    assert.equal(hit.filterEvidence.returnType.facts[0].type, 'boolean');
  }
  assert.equal(booleans.pagination.coverage, 'indexed-metadata');
  assert.match(booleans.pagination.coverageNote, /Missing compiler facts are not inferred/);
  assert.deepEqual((await search(['--return-type', shapeType])).code.map(hit => hit.name), ['shape']);
  assert.deepEqual((await search(['--return-type', 'Promise<boolean>'])).code.map(hit => hit.name), ['wrapper']);
  assert.deepEqual((await search(['--return-type', 'true'])).code.map(hit => hit.name), ['literal']);
  assert.deepEqual((await search(['--type', 'ClassDeclaration'])).code.map(hit => hit.name), ['Base', 'Derived']);
  assert.deepEqual((await search(['--extends', 'Base'])).code.map(hit => hit.name), ['Derived']);
  // These calls come from the existing syntax relation owner, not resolved
  // compiler symbol/dispatch equivalence. Only the recorded callee is matched.
  assert.deepEqual((await search(['--calls', 'target'])).code.map(hit => hit.name), ['caller']);
  assert.equal((await search(['--return-type', 'MissingType'])).pagination.total, 0);
  console.log('persisted actual compiler facts filter-only test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
