#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareBenchmarkPrerequisites, isPreparedBenchmarkRootCurrent,
  buildBenchmarkPrerequisiteReadiness } from '../../../tools/bench/language/prerequisites.js';
import { classifyBenchTask } from '../../../tools/bench/language/verdict.js';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prerequisites-'));
try {
  assert.equal(parseBenchLanguageArgs(['--list']).argv.provision, true);
  const parsed = parseBenchLanguageArgs(['--no-provision', '--strict-prerequisites', '--list']);
  assert.equal(parsed.argv.provision, false, 'the negative CLI flag actually disables installation');
  assert.equal(parsed.argv['strict-prerequisites'], true);
  const good = path.join(root, 'mixed');
  fs.mkdirSync(good);
  const events = [];
  const plans = [{ repoPath: good, repoLabel: 'mixed', task: { repo: 'owner/mixed', language: 'go' } },
    { repoPath: good, repoLabel: 'mixed-again', task: { repo: 'owner/mixed', language: 'yaml' } },
    { repoPath: path.join(root, 'missing'), repoLabel: 'missing', task: { repo: 'owner/missing' } }];
  const lifecycle = {
    async ensureRepoPresent({ repoPath }) { events.push(`clone:${repoPath}`); return { ok: repoPath === good, failureReason: 'clone' }; },
    async prepareRepoWorkspace({ repoPath }) { events.push(`checkout:${repoPath}`); return { ok: true, checkout: { partialReady: true } }; }
  };
  const phase = await prepareBenchmarkPrerequisites({ executionPlans: plans, lifecycle,
    async checkPrerequisites({ autoInstall, strict, plan }) {
      assert.equal(autoInstall, true, 'provisioning is enabled by default');
      assert.equal(strict, false);
      events.push(`install-and-verify:${plan.repoPath}`);
      return { languages: ['go', 'yaml'], readiness: buildBenchmarkPrerequisiteReadiness({
        requestedProviderIds: ['lsp-gopls'], doctor: { providers: [{ id: 'lsp-gopls', enabled: true,
          available: false, status: 'warn', checks: [{ name: 'workspace', status: 'warn', message: 'no module' }] }] } }) };
    } });
  assert.equal(phase.preparedRepos.size, 2, 'one physical checkout is prepared once across nominated language groups');
  assert.deepEqual(events, [`clone:${good}`, `checkout:${good}`, `install-and-verify:${good}`, `clone:${plans[2].repoPath}`]);
  assert.equal(phase.report.measured, false);
  assert.equal(phase.report.campaignBlocked, false);
  assert.equal(phase.preparedRepos.get(good).prerequisite.readiness.state, 'degraded');
  assert.equal(phase.preparedRepos.get(good).workspace.checkout.partialReady, true, 'tool admission preserves partial submodules');
  assert.equal(phase.preparedRepos.get(plans[2].repoPath).prerequisite, null, 'a top-level failure cannot be measured as ready');
  assert.equal(isPreparedBenchmarkRootCurrent(good, phase.preparedRepos.get(good)), true);
  fs.renameSync(good, `${good}-old`);
  fs.symlinkSync(`${good}-old`, good, 'dir');
  assert.equal(isPreparedBenchmarkRootCurrent(good, phase.preparedRepos.get(good)), false, 'replacement path fails admission');
  const doctor = { providers: [{ id: 'lsp-rust-analyzer', enabled: true, available: false, status: 'warn',
    checks: [{ name: 'rust_workspace_trust_required', status: 'warn', message: 'exact grant required' }] }] };
  const installation = { items: [{ id: 'rust-analyzer', state: 'installed-and-verified', required: true }] };
  assert.equal(buildBenchmarkPrerequisiteReadiness({ doctor, installation,
    requestedProviderIds: ['lsp-rust-analyzer'] }).state, 'degraded', 'install does not make denied workspace ready');
  assert.equal(buildBenchmarkPrerequisiteReadiness({ doctor, installation, strict: true,
    requestedProviderIds: ['lsp-rust-analyzer'] }).state, 'blocked');
  assert.equal(classifyBenchTask({ diagnostics: { countsByType: { prerequisite_incomplete: 1 } } }).resultClass,
    'passed_with_degradation', 'limited coverage cannot produce a clean benchmark verdict');
  const strictPhase = await prepareBenchmarkPrerequisites({ executionPlans: [plans[0]], lifecycle, strict: true,
    checkPrerequisites: async () => ({ readiness: buildBenchmarkPrerequisiteReadiness({ doctor, installation,
      strict: true, requestedProviderIds: ['lsp-rust-analyzer'] }) }) });
  assert.equal(strictPhase.report.campaignBlocked, true, 'strict missing coverage gates the campaign before measurement');
  assert.equal(buildBenchmarkPrerequisiteReadiness({ assets: [{ id: 'backend', required: true, state: 'failed' }] }).state, 'blocked');
  let checked = 0;
  const planned = await prepareBenchmarkPrerequisites({ executionPlans: [plans[0]], lifecycle, dryRun: true,
    checkPrerequisites() { checked += 1; throw new Error('dry run must not install or probe'); } });
  assert.equal(checked, 0);
  assert.equal(planned.preparedRepos.get(good).prerequisite.readiness.state, 'planned');
  const failedCheck = await prepareBenchmarkPrerequisites({ executionPlans: [plans[0]], lifecycle,
    checkPrerequisites() { throw new Error('invalid repository configuration'); } });
  assert.equal(failedCheck.preparedRepos.get(good).prerequisite.readiness.state, 'blocked');
  assert.match(failedCheck.preparedRepos.get(good).prerequisite.readiness.items[0].reason, /invalid repository configuration/u);
  await assert.rejects(prepareBenchmarkPrerequisites({ executionPlans: [plans[0]], lifecycle,
    checkPrerequisites() { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; } }), /cancelled/u);
  console.log('Default provisioning precedes measurement; partial/strict/core admission and replaced-root controls pass.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
