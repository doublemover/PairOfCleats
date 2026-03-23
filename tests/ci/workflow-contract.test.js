#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagePath = path.join(ROOT, 'package.json');
const runSuitePath = path.join(ROOT, 'tools', 'ci', 'run-suite.js');

if (!fs.existsSync(packagePath)) {
  console.error(`Missing package.json: ${packagePath}`);
  process.exit(1);
}
if (!fs.existsSync(runSuitePath)) {
  console.error(`Missing CI runner: ${runSuitePath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = pkg.scripts || {};
const nodeVersionRegex = /node-version:\s*['"]?24\.13\.0['"]?/;
const rustToolchainPath = path.join(ROOT, 'crates', 'pairofcleats-tui', 'rust-toolchain.toml');
const rustToolchainText = fs.readFileSync(rustToolchainPath, 'utf8');
const pinnedRustToolchain = rustToolchainText.match(/channel\s*=\s*"([^"]+)"/)?.[1] || '';
if (!pinnedRustToolchain) {
  console.error(`Unable to resolve pinned Rust toolchain from ${rustToolchainPath}`);
  process.exit(1);
}

const assertWorkflowScriptsExist = ({ workflowText, label }) => {
  const scriptMatches = new Set();
  const scriptRegex = /npm run\s+([A-Za-z0-9:_-]+)/g;
  let match;
  while ((match = scriptRegex.exec(workflowText)) !== null) {
    scriptMatches.add(match[1]);
  }
  const missingScripts = Array.from(scriptMatches).filter((name) => !(name in scripts));
  if (missingScripts.length) {
    console.error(`${label} references missing scripts: ${missingScripts.join(', ')}`);
    process.exit(1);
  }
};

const assertNodePinned = ({ workflowText, label }) => {
  if (!nodeVersionRegex.test(workflowText)) {
    console.error(`${label} does not pin Node 24.13.0`);
    process.exit(1);
  }
};

const assertHiddenArtifactUploadsConfigured = ({ workflowText, label }) => {
  const uploadSteps = (workflowText.match(/uses:\s*actions\/upload-artifact@v4/g) || []).length;
  if (uploadSteps <= 0) return;
  const includeHidden = (workflowText.match(/include-hidden-files:\s*true/g) || []).length;
  if (includeHidden < uploadSteps) {
    console.error(
      `${label} must set include-hidden-files: true for every upload-artifact step `
      + `(${includeHidden}/${uploadSteps}).`
    );
    process.exit(1);
  }
};

const assertRustValidationPresent = ({ workflowText, label }) => {
  const requiredPatterns = [
    /uses:\s*dtolnay\/rust-toolchain@stable/,
    /components:\s*rustfmt,\s*clippy/,
    /cargo fmt --check/,
    /cargo check --locked/,
    /cargo test --locked/,
    /cargo clippy --locked -- -D warnings/
  ];
  for (const pattern of requiredPatterns) {
    if (!pattern.test(workflowText)) {
      console.error(`${label} is missing required Rust validation: ${pattern}`);
      process.exit(1);
    }
  }
  if (!new RegExp(`toolchain:\\s*${pinnedRustToolchain.replace(/\./g, '\\.')}`).test(workflowText)) {
    console.error(`${label} is missing required Rust validation: toolchain ${pinnedRustToolchain}`);
    process.exit(1);
  }
};

const assertGeneratedFreshnessGatePresent = ({ workflowText, label }) => {
  if (!/node\s+tools\/docs\/generated-surfaces\.js\s+--check-freshness/.test(workflowText)) {
    console.error(`${label} is missing generated surfaces freshness enforcement`);
    process.exit(1);
  }
};

const assertCommandSurfaceAuditPresent = ({ workflowText, label }) => {
  if (
    !/node\s+tools\/ci\/check-command-surface\.js/.test(workflowText)
    && !/node\s+tools\/ci\/run-suite\.js/.test(workflowText)
  ) {
    console.error(`${label} is missing command surface audit enforcement`);
    process.exit(1);
  }
};

const assertWorkflowDispatchPresent = ({ workflowText, label }) => {
  if (!/workflow_dispatch:/m.test(workflowText)) {
    console.error(`${label} must support workflow_dispatch.`);
    process.exit(1);
  }
};

const assertReleaseWorkflowStructure = ({ workflowText, label }) => {
  const checkoutRefs = workflowText.match(/uses:\s*actions\/checkout@v4[\s\S]*?ref:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref\s*\}\}/g) || [];
  if (checkoutRefs.length < 8) {
    console.error(`${label} must pin manual release checkouts to the requested tag ref in every checkout-based job.`);
    process.exit(1);
  }
  const requiredPatterns = [
    /name:\s*Release/,
    /push:\s*\n\s*tags:\s*\n\s*-\s*'v\*'/,
    /workflow_dispatch:/,
    /node-version:\s*['"]?24\.13\.0['"]?/,
    /tools\/release\/metadata\.js/,
    /tools\/release\/check\.js[\s\S]*--phases\s+changelog,contracts,toolchain/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+vscode,sublime[\s\S]*--phases\s+build/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+cli,api,mcp,indexer-service[\s\S]*--phases\s+boot,smoke/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+tui[\s\S]*--phases\s+build/,
    /tools\/release\/assemble-bundle\.js/,
    /tools\/release\/generate-trust-materials\.js/,
    /tools\/release\/readiness-gate\.js/,
    /cargo install cargo-cyclonedx --locked/,
    /gh run list --workflow "\$workflow"/,
    /gh workflow run "\$workflow" --ref "\$target_ref"/,
    /RELEASE_GIT_SHA:\s*\$\{\{\s*needs\.prepare\.outputs\.release_git_sha\s*\}\}/,
    /RELEASE_REF:\s*\$\{\{\s*needs\.prepare\.outputs\.release_ref\s*\}\}/,
    /target_sha="\$\{RELEASE_GIT_SHA:-\$GITHUB_SHA\}"/,
    /wait_for_successful_run 'ci\.yml' 'dispatch'/,
    /wait_for_successful_run 'ci-long\.yml' 'dispatch'/,
    /gh run download "\$ci_run_id" -n ci-quality-artifacts-ubuntu/,
    /uses:\s*actions\/download-artifact@v4/,
    /uses:\s*actions\/upload-artifact@v4/,
    /uses:\s*actions\/attest-build-provenance@v2/,
    /environment:\s*release/,
    /gh release create/,
    /gh release upload/
  ];
  for (const pattern of requiredPatterns) {
    if (!pattern.test(workflowText)) {
      console.error(`${label} is missing required release automation contract: ${pattern}`);
      process.exit(1);
    }
  }
  const publishBlockMatch = workflowText.match(/\n  publish:\n([\s\S]*)$/);
  const publishBlock = publishBlockMatch ? publishBlockMatch[1] : '';
  if (!publishBlock) {
    console.error(`${label} is missing publish job block.`);
    process.exit(1);
  }
  if (!/needs:[\s\S]*readiness-gate/.test(publishBlock)) {
    console.error(`${label} publish job must depend on readiness-gate.`);
    process.exit(1);
  }
  const forbiddenPatterns = [
    /tools\/package-vscode\.js/,
    /tools\/package-sublime\.js/,
    /tools\/tui\/build\.js/,
    /npm run bootstrap:ci/
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(publishBlock)) {
      console.error(`${label} rebuilds artifacts during publish, which violates promotion-only release flow.`);
      process.exit(1);
    }
  }
  if (!/find dist\/release\/downloads dist\/release\/bundle dist\/release\/trust -type f \| sort/.test(publishBlock)) {
    console.error(`${label} publish job must upload trust materials alongside the release bundle.`);
    process.exit(1);
  }
};

const readWorkflow = (name) => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', name);
  if (!fs.existsSync(workflowPath)) {
    console.error(`Missing workflow: ${workflowPath}`);
    process.exit(1);
  }
  return fs.readFileSync(workflowPath, 'utf8');
};

const ciWorkflow = readWorkflow('ci.yml');
assertWorkflowScriptsExist({ workflowText: ciWorkflow, label: 'CI workflow' });
assertNodePinned({ workflowText: ciWorkflow, label: 'CI workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: ciWorkflow, label: 'CI workflow' });
assertWorkflowDispatchPresent({ workflowText: ciWorkflow, label: 'CI workflow' });
assertRustValidationPresent({ workflowText: ciWorkflow, label: 'CI workflow' });
assertGeneratedFreshnessGatePresent({ workflowText: ciWorkflow, label: 'CI workflow' });
assertCommandSurfaceAuditPresent({ workflowText: ciWorkflow, label: 'CI workflow' });

const nightlyWorkflow = readWorkflow('nightly.yml');
assertWorkflowScriptsExist({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertNodePinned({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertRustValidationPresent({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertCommandSurfaceAuditPresent({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });

const ciLongWorkflow = readWorkflow('ci-long.yml');
assertWorkflowScriptsExist({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });
assertNodePinned({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });
if (!/node\s+tools\/ci\/run-suite\.js/.test(ciLongWorkflow)) {
  console.error('CI-long workflow does not invoke tools/ci/run-suite.js');
  process.exit(1);
}
if (!/--lane\s+ci-long/.test(ciLongWorkflow)) {
  console.error('CI-long workflow does not pass --lane ci-long');
  process.exit(1);
}
if (!/push:\s*\n\s*tags:\s*\n\s*-\s*'v\*'/.test(ciLongWorkflow)) {
  console.error('CI-long workflow must auto-trigger on release tags.');
  process.exit(1);
}
assertCommandSurfaceAuditPresent({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });

const releaseWorkflow = readWorkflow('release.yml');
assertWorkflowScriptsExist({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertNodePinned({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertReleaseWorkflowStructure({ workflowText: releaseWorkflow, label: 'Release workflow' });

console.log('workflow contract test passed (ci, ci-long, nightly, release)');
