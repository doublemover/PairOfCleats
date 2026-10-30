#!/usr/bin/env node
// Authored actual operational/preflight consumer fixture. The existing helper
// explicitly selects and trusts benign Swift command fixtures; no Swift vendor
// runtime, network dependency or real workspace hook is qualified here.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { prepareSourcekitWorkspace } from '../../../tools/tooling/prepare-sourcekit.js';
import { ensureSourcekitPackageResolutionPreflight } from '../../../src/index/tooling/preflight/sourcekit-package-resolution.js';

const fixture = await createSourcekitPreflightFixture({ root: process.cwd(), name: 'sourcekit-explicit-operational-prepare', includeDependencies: true });
try {
  const swiftCommand = path.join(fixture.binDir, process.platform === 'win32' ? 'swift.cmd' : 'swift');
  const { ctx } = fixture.contextFor([]);
  const dependencies = { getConfig: () => ctx.toolingConfig };
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    const input = { repoRoot: fixture.tempRoot, swiftCommand };
    const preview = await prepareSourcekitWorkspace(input, dependencies);
    assert.equal(preview.applied, false); assert.equal(preview.execution, 'none'); assert.equal(preview.state, 'planned-not-probed');
    assert.equal(preview.passivePreflight.reasonCode, 'sourcekit_package_resolution_required');
    assert.equal(preview.consumerQualified, false);
    assert.equal(await countNonEmptyLines(fixture.counterPath), 0, 'preview cannot create a resolving operation plan or execute the selected Swift command');
    await assert.rejects(fs.stat(fixture.markerPath), { code: 'ENOENT' });
    const prepared = await prepareSourcekitWorkspace({ ...input, apply: true }, dependencies);
    assert.equal(prepared.ok, true); assert.equal(prepared.state, 'prepared'); assert.equal(prepared.applied, true);
    assert.equal(prepared.preflight.state, 'ready'); assert.equal(prepared.consumerQualified, false);
    assert.match(prepared.operationPlanIdentity, /^[a-f0-9]{64}$/);
    assert.equal(await countNonEmptyLines(fixture.counterPath), 1, 'only the explicitly selected operational apply resolves fixture packages');
    const saved = JSON.parse(JSON.stringify(prepared));
    assert.equal(saved.operationPlan, undefined, 'reports expose identity without serializing in-process workspace authority');
    const passive = await ensureSourcekitPackageResolutionPreflight({ repoRoot: fixture.tempRoot, log: () => {},
      sourcekitConfig: { preflightFailOpen: true }, resolutionPlan: saved });
    assert.equal(passive.blockSourcekit, true);
    assert.equal(passive.reasonCode, 'sourcekit_operation_plan_invalid');
    assert.equal(await countNonEmptyLines(fixture.counterPath), 1, 'saved operational output cannot authorize a later workspace load/resolve');
    await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
      const denied = await prepareSourcekitWorkspace(input, dependencies);
      assert.equal(denied.state, 'blocked'); assert.equal(denied.blockers[0].code, 'sourcekit_workspace_trust_required');
      await assert.rejects(prepareSourcekitWorkspace({ ...input, apply: true }, dependencies), { code: 'ERR_SOURCEKIT_OPERATION_PLAN' });
    });
    const cancelled = new AbortController(); const reason = new Error('fixture prepare cancelled before observation'); cancelled.abort(reason);
    await assert.rejects(prepareSourcekitWorkspace({ ...input, apply: true, signal: cancelled.signal }, dependencies), error => error === reason);
    await assert.rejects(prepareSourcekitWorkspace({ ...input, swiftCommand: 'swift', apply: true }, dependencies), /absolute exact repository/);
    assert.equal(await countNonEmptyLines(fixture.counterPath), 1, 'denied/cancelled/relative selections execute no fallback command');
  });
} finally { await fixture.restorePath(); }
console.log('SourceKit preparation forwards current in-process authority only after explicit apply; preview, saved output and revoked trust remain passive.');
