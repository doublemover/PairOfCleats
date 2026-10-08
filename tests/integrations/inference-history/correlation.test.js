import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await fs.realpath(await makeTempDir('poc-history-correlation-'));
const repoRoot = path.join(root, 'repo');
const vaultRoot = path.join(root, 'vault');
const sourcePath = path.join(root, 'synthetic.json');
await fs.mkdir(repoRoot);
await fs.mkdir(vaultRoot, { mode: 0o700 });
const git = (args) => spawnSubprocessSync('git', ['-C', repoRoot, ...args], {
  timeoutMs: 3000, outputMode: 'string', maxOutputBytes: 64 * 1024
}).stdout.trim();
try {
  git(['init', '-q']);
  await fs.writeFile(path.join(repoRoot, 'render.js'), 'export const render = () => 1;\n');
  git(['add', 'render.js']);
  git(['-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'Add renderer']);
  const oid = git(['rev-parse', 'HEAD']);
  await fs.writeFile(path.join(repoRoot, 'tasks.md'), `- [x] IH-101 Render preparation ${oid}\n- [ ] IH-102 unrelated\n`);
  const raw = [{ id: 'conversation', current_node: 'node', mapping: {
    node: { id: 'node', parent: null, children: [], message: { id: 'message', author: { role: 'assistant' },
      content: { content_type: 'text', parts: [`Reported completion ${oid} and IH-101. Unverified deadbeef.`] } } }
  } }];
  await fs.writeFile(sourcePath, JSON.stringify(raw));
  const access = { allowed: true, principalId: 'alice', tenantId: 'tenant', ownerType: 'individual',
    ownerId: 'alice', sourceScope: 'chatgpt', policyEpoch: '1' };
  const request = { requestContext: 'trusted-session', partition: 'own' };
  let codeAllowed = true;
  const codeAccess = () => codeAllowed ? { policyEpoch: '1', repositories: [
    { repositoryId: 'synthetic/renderer', root: repoRoot, markdownPaths: ['tasks.md'] }
  ] } : { policyEpoch: '2', repositories: [] };
  const service = createInferenceHistoryService({ vaultRoot, verifyPrivateVault: () => true,
    resolveImportSource: () => ({ path: sourcePath, policyEpoch: '1' }),
    resolveAccess: ({ requestContext }) => requestContext === 'trusted-session' ? access : null,
    resolveCodeAccess: codeAccess });
  await service.importExport({ ...request, sourcePath });
  const [hit] = (await service.search({ ...request, query: 'completion' })).hits;
  const result = await service.correlate({ ...request, sourceRef: hit.sourceRef });
  const commit = result.relations.find((row) => row.kind === 'references_commit');
  assert.equal(commit.oid, oid);
  assert.equal(commit.state, 'verified_object');
  assert.equal(commit.repositoryId, 'synthetic/renderer');
  assert.equal(commit.implementationClaim, false);
  assert.match(commit.authorTime, /^\d{4}-/);
  const markdown = result.relations.find((row) => row.kind === 'markdown_reference');
  assert.equal(markdown.line, 1);
  assert.equal(markdown.path, 'tasks.md');
  assert.ok(markdown.mentions.includes('IH-101'));
  assert.match(markdown.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.unresolvedCommitMentions, ['deadbeef']);
  assert.equal(result.instructionAuthority, 'none');

  const subdirectory = path.join(repoRoot, 'subdir');
  await fs.mkdir(subdirectory);
  const subtree = createInferenceHistoryService({ vaultRoot, verifyPrivateVault: () => true,
    resolveAccess: () => access, resolveCodeAccess: () => ({ policyEpoch: '1', repositories: [
      { repositoryId: 'synthetic/subtree', root: subdirectory, markdownPaths: [] }
    ] }) });
  await assert.rejects(subtree.correlate({ ...request, sourceRef: hit.sourceRef }),
    { code: 'ERR_INFERENCE_HISTORY_CODE_SCOPE' });
  codeAllowed = false;
  assert.deepEqual((await service.correlate({ ...request, sourceRef: hit.sourceRef })).relations, []);
  let checks = 0;
  const revokedCode = createInferenceHistoryService({ vaultRoot, verifyPrivateVault: () => true, resolveAccess: () => access,
    resolveCodeAccess: () => ({ policyEpoch: String(++checks), repositories: [] }) });
  await assert.rejects(revokedCode.correlate({ ...request, sourceRef: hit.sourceRef }),
    { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  const noHistoryAccess = createInferenceHistoryService({ vaultRoot, resolveAccess: () => null, resolveCodeAccess: codeAccess });
  await assert.rejects(noHistoryAccess.correlate({ ...request, sourceRef: hit.sourceRef }),
    { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  console.log('Inference history exact Git and Markdown evidence correlation passed.');
} finally { await rmDirRecursive(root); }
