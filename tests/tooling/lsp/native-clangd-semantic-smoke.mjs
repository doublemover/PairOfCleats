// Explicit live acceptance: node this-file.mjs <absolute-clangd-path>.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { runNativeSemanticProviders } from '../../../src/index/semantic/native-provider-pass.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
const binary = process.argv[2];
assert.ok(binary && path.isAbsolute(binary), 'Supply an absolute clangd path');
const fixture = await createRecoveryFixture();
try {
  const policy = normalizeSemanticConfig({ enabled: true, languages: ['c'], enrichment: { bindings: 'eager' } });
  const state = { chunks: [], semanticFactsByFile: new Map(), semanticDiskAccount: fixture.account };
  const runtime = { root: fixture.root, buildRoot: fixture.root, semanticPolicy: policy,
    scheduler: { schedule: async (lane, _resources, fn) => { assert.equal(lane, 'relations'); return fn(); } } };
  for (const [file, text] of [['library.h', 'int helper(int x);\n'], ['main.c', '#include "library.h"\nint run(void) { return helper(2); }\n']]) {
    const bytes = Buffer.from(text); await fs.writeFile(path.join(fixture.root, file), bytes);
    const facts = await collectFileSemanticFacts({ ...fixture.options, bytes, text, language: 'c', relPath: file, repositoryNamespace: fixture.root, policy });
    state.semanticFactsByFile.set(file, createSemanticFactsRef({ source: facts.source, partitions: [facts.partition],
      syntaxPartitionId: facts.partition.partitionId, storage: { generation: fixture.generation, relativePath: 'semantic' }, coverage: facts.coverage }));
  }
  const file = path.join(fixture.root, 'main.c');
  await fs.writeFile(path.join(fixture.root, 'compile_commands.json'), JSON.stringify([{ directory: fixture.root, file,
    arguments: ['clang', '-x', 'c', '-std=c17', '-fsyntax-only', file] }]));
  const logs = [];
  const result = await runNativeSemanticProviders({ state, runtime, signal: AbortSignal.timeout(20000), log: value => logs.push(value),
    toolingConfig: { enabledTools: ['clangd'], cache: { enabled: false }, clangd: { cmd: binary,
      args: ['--background-index=false', '--clang-tidy=false', '--enable-config=false', '--query-driver=', '-j=1', '--log=error'],
      compileCommandsDir: fixture.root, autoInferIncludeRoots: false, timeoutMs: 5000, retries: 0,
      signatureHelpEnabled: false, semanticTokensEnabled: false, referencesEnabled: false, inlayHintsEnabled: false } } });
  assert.equal(result.ran, true);
  const partitions = [...state.semanticFactsByFile.values()].flatMap(facts => facts.partitions), store = fixture.store(partitions), edges = [];
  for (const part of partitions) for await (const row of store.iterateRows(part.partitionId, 'semantic_edges')) if (row.kind === 'callTarget') edges.push(row);
  assert.equal(edges.length, 1, 'live clangd cross-file definition with no legacy targets: ' + logs.join('\n'));
  assert.equal(edges[0].certainty, 'exact-static');
  const target = state.semanticFactsByFile.get('library.h'); assert.equal(edges[0].to.partitionId, target.syntaxPartitionId);
  console.log(JSON.stringify({ server: execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim(),
    binarySha256: createHash('sha256').update(await fs.readFile(binary)).digest('hex'),
    nativeOnly: true, legacyTargets: 0, crossFileCallTargets: edges.length, sourcePinned: true, backgroundIndex: false }));
} finally { await __testLspSessionPool.reset(); await fixture.cleanup(); }
