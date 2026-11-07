import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';

// Authored through the actual doctor consumer. No language server is selected
// by the injected command-profile response; cancellation must stop before it.
const root = await createLspProviderTempRepo({ name: 'doctor-cancel-report' });
registerDefaultToolingProviders();
try {
  const initial = new AbortController();
  initial.abort();
  let calls = 0;
  await assert.rejects(runToolingDoctor({ repoRoot: root, buildRoot: root, strict: false,
    abortSignal: initial.signal }, ['pyright'], { resolveCommandProfile() { calls += 1; } }),
  { name: 'AbortError', code: 'ABORT_ERR' });
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(runToolingDoctor({ repoRoot: root, buildRoot: root, strict: false,
    scmConfig: { provider: 'none', annotate: { enabled: false } },
    toolingConfig: { enabledTools: ['pyright', 'clangd'] } }, ['pyright', 'clangd'], {
    signal: controller.signal,
    resolveCommandProfile(input) {
      assert.equal(input.signal.aborted, false);
      calls += 1;
      controller.abort();
      return { resolved: { cmd: 'must-not-launch', args: [] }, probe: { ok: true } };
    }
  }), { name: 'AbortError', code: 'ABORT_ERR' });
  assert.equal(calls, 1, 'cancellation after a synchronous probe stops handshake and later provider work');
  await assert.rejects(fs.access(path.join(root, 'tooling_doctor_report.json')), { code: 'ENOENT' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Cancelled tooling doctor work does not publish a completed report or start later providers');
