import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolvePyrightHealthIdentity } from '../../../src/index/tooling/pyright-health-identity.js';
import { resolvePyrightWorkspaceConfigPreflight } from '../../../src/index/tooling/preflight/pyright-workspace-config.js';
import { resolvePyrightRequestPlan, persistPyrightPlannerHealth } from '../../../src/index/tooling/pyright-planner.js';
import { persistPyrightRuntimeHealth } from '../../../src/index/tooling/pyright-runtime-health.js';
import { createLspProviderTempRepo, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

// Authored context/quarantine consumer case; no feature/server checks executed.
const root = await createLspProviderTempRepo({ name: 'pyright-health-source-context', files: [
  { path: 'pyproject.toml', content: '[project]\nname="health-fixture"\n' },
  { path: 'pyrightconfig.json', content: '{"typeCheckingMode":"basic"}' },
  { path: 'mode.txt', content: 'stall-document-symbol' },
  { path: 'launch.mjs', content: `import fs from 'node:fs'; import { spawn } from 'node:child_process';
const child = spawn(process.execPath, [${JSON.stringify(resolveLspStubServerPath())}, '--mode', fs.readFileSync('mode.txt', 'utf8').trim()], { stdio: 'inherit' });
child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n` }
] });
const restoreExecution = grantFixtureRepositoryExecution(root);
const document = { virtualPath: 'src/core.py', containerPath: 'src/core.py', languageId: 'python', effectiveExt: '.py',
  text: 'def greet(name: str, count: int) -> str:\n    return name\n', docHash: 'unchanged-claimed-hash' };
const target = { virtualPath: document.virtualPath, languageId: 'python', symbolHint: { name: 'greet', kind: 'function' },
  virtualRange: { start: 0, end: document.text.length }, chunkRef: { chunkUid: 'ck64:v1:test:pyright-context', chunkId: 'greet',
    file: document.virtualPath, range: { start: 0, end: document.text.length } } };
const config = { enabledTools: ['pyright'], pyright: { cmd: process.execPath, args: [path.join(root, 'launch.mjs')],
  timeoutMs: 500, documentSymbolTimeoutMs: 150, hoverEnabled: false, retries: 0, breakerThreshold: 1 } };
const run = () => runToolingProviders({ repoRoot: root, buildRoot: root, strict: true, toolingConfig: config,
  cache: { enabled: false } }, { documents: [document], targets: [target], kinds: ['types'] });
registerDefaultToolingProviders();
try {
  const failed = await run();
  assert.equal(failed.diagnostics.pyright.health.nextState, 'degraded_hard');
  const quarantined = await run();
  assert.equal(quarantined.diagnostics.pyright.health.state, 'quarantined_for_run');
  await fs.writeFile(path.join(root, 'mode.txt'), 'pyright');
  document.text += '# same path, new source bytes\n';
  const changedSource = await run();
  assert.equal(changedSource.diagnostics.pyright.health.state, 'warming');
  assert.equal(changedSource.byChunkUid.has(target.chunkRef.chunkUid), true, 'edited source recovers through the actual provider consumer');
  await fs.writeFile(path.join(root, 'mode.txt'), 'stall-document-symbol');
  assert.equal((await run()).diagnostics.pyright.health.nextState, 'degraded_hard');
  await fs.writeFile(path.join(root, 'mode.txt'), 'pyright');
  await fs.writeFile(path.join(root, 'pyrightconfig.json'), '{"typeCheckingMode":"strict"}');
  const changedConfig = await run();
  assert.equal(changedConfig.diagnostics.pyright.health.state, 'warming');
  assert.equal(changedConfig.diagnostics.pyright.health.nextState, 'healthy');
  assert.equal(changedConfig.byChunkUid.has(target.chunkRef.chunkUid), true, 'config repair changes quarantine scope without a path edit');
  const aborted = new AbortController(); aborted.abort();
  const signal = aborted.signal;
  for (const operation of [
    () => resolvePyrightHealthIdentity({ repoRoot: root, documents: [document], command: process.execPath, signal }),
    () => resolvePyrightWorkspaceConfigPreflight({ ctx: { repoRoot: root }, abortSignal: signal }),
    () => resolvePyrightRequestPlan({ repoRoot: root, documents: [document], targets: [target], signal }),
    () => persistPyrightPlannerHealth({ repoRoot: root, workspaceRootRel: '.', signal }),
    () => persistPyrightRuntimeHealth({ repoRoot: root, workspaceRootRel: '.', record: {}, signal })
  ]) await assert.rejects(operation, { code: 'ABORT_ERR' });
} finally {
  restoreExecution();
  await cleanupLspTestRuntime({ reason: 'pyright_health_source_context', strict: true });
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Pyright quarantine follows actual source/config/runtime identity and health I/O preserves cancellation');
