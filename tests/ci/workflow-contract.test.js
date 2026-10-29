#!/usr/bin/env node
import assert from 'node:assert/strict';
import { releaseWorkflowSourceErrors } from '../../tools/release/source-revision.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { normalizeEol } from '../../src/shared/eol.js';
import { escapeRegex } from '../../src/shared/text/escape-regex.js';

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
const pinnedNodeVersion = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
const pinnedPythonVersion = fs.readFileSync(path.join(ROOT, '.python-version'), 'utf8').trim();
assert.match(pinnedPythonVersion, /^3\.\d+\.\d+$/, '.python-version must select an exact stable Python 3 release');
if (!/^26\.\d+\.\d+$/.test(pinnedNodeVersion)) {
  console.error('.nvmrc must pin an exact Node 26 version.');
  process.exit(1);
}
const nodeVersionPattern = `node-version:\\s*['"]?${escapeRegex(pinnedNodeVersion)}['"]?`;
const nodeVersionRegex = new RegExp(nodeVersionPattern);
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
  const versions = Array.from(workflowText.matchAll(/node-version:\s*['"]?([^'"\s]+)['"]?/g), (match) => match[1]);
  if (!versions.length || versions.some((version) => version !== pinnedNodeVersion)) {
    console.error(`${label} must pin every Node setup to ${pinnedNodeVersion} from .nvmrc.`);
    process.exit(1);
  }
  const cacheVersions = Array.from(workflowText.matchAll(/key:\s*node-modules-[^\r\n]*?-node-(\d+\.\d+\.\d+)-/g), (match) => match[1]);
  if (cacheVersions.some((version) => version !== pinnedNodeVersion)) {
    console.error(`${label} node_modules cache keys must match Node ${pinnedNodeVersion}.`);
    process.exit(1);
  }
  for (const [jobName, job] of Object.entries(parse(workflowText).jobs || {})) {
    for (const step of job.steps || []) {
      if (step.id !== 'node-modules-cache') continue;
      const paths = String(step.with?.path || '').split(/\r?\n/u).map(value => value.trim());
      assert.ok(paths.includes('node_modules') && paths.includes('.cache/native-build/headers'),
        `${label} ${jobName}: cached native build projects must retain their selected import-library inputs`);
      assert.ok(String(step.with?.key).includes('-headers-v1-'),
        `${label} ${jobName}: incomplete historical dependency caches require a distinct key`);
    }
  }
};

const assertHiddenArtifactUploadsConfigured = ({ workflowText, label }) => {
  const uploadSteps = (workflowText.match(/uses:\s*actions\/upload-artifact@[^\s]+/g) || []).length;
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
  if (!new RegExp(`toolchain:\\s*${escapeRegex(pinnedRustToolchain)}`).test(workflowText)) {
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

const assertReleaseTagTriggerPresent = ({ workflowText, label }) => {
  if (!/push:\s*\n(?:\s*branches:\s*\[[^\n]+\]\s*\n)?\s*tags:\s*\n\s*-\s*'v\*'/.test(workflowText)) {
    console.error(`${label} must auto-trigger on release tags.`);
    process.exit(1);
  }
};

const assertReleaseWorkflowStructure = ({ workflowText, label }) => {
  workflowText = normalizeEol(workflowText);
  assert.deepEqual(releaseWorkflowSourceErrors(parse(workflowText)), [], `${label} must use the prepared immutable source revision in every downstream checkout.`);
  if (!/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*tag:\s*\n\s*description:[\s\S]*?required:\s*true/.test(workflowText)) {
    console.error(`${label} must require a tag for workflow_dispatch release promotions.`);
    process.exit(1);
  }
  const requiredPatterns = [
    /name:\s*Release/,
    /push:\s*\n\s*tags:\s*\n\s*-\s*'v\*'/,
    /workflow_dispatch:/,
    nodeVersionRegex,
    /tools\/release\/metadata\.js/,
    /tools\/release\/check\.js[\s\S]*--phases\s+changelog,contracts,toolchain/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+vscode,sublime[\s\S]*--phases\s+build/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+cli,api,mcp,indexer-service[\s\S]*--phases\s+boot,smoke/,
    /tools\/release\/check\.js[\s\S]*--surfaces\s+tui[\s\S]*--phases\s+build/,
    /tools\/release\/assemble-bundle\.js/,
    /tools\/release\/generate-trust-materials\.js/,
    /tools\/release\/readiness-gate\.js/,
    /tools\/release\/workflow-run-selection\.js/,
    /cargo install cargo-cyclonedx --locked/,
    /gh run list --workflow "\$workflow"/,
    /gh workflow run "\$workflow" --ref "\$target_ref"/,
    /RELEASE_GIT_SHA:\s*\$\{\{\s*needs\.prepare\.outputs\.release_git_sha\s*\}\}/,
    /RELEASE_REF:\s*\$\{\{\s*needs\.prepare\.outputs\.release_ref\s*\}\}/,
    /target_sha="\$\{RELEASE_GIT_SHA:-\$GITHUB_SHA\}"/,
    /wait_for_successful_run 'ci\.yml' 'dispatch'/,
    /wait_for_successful_run 'ci-long\.yml' 'dispatch'/,
    /gh run download "\$ci_run_id" -n ci-quality-artifacts-ubuntu/,
    /tools\/release\/readiness-gate\.js[\s\S]*--release-git-sha\s+\$\{\{\s*needs\.prepare\.outputs\.release_git_sha\s*\}\}/,
    /uses:\s*actions\/download-artifact@v8\b/,
    /uses:\s*actions\/upload-artifact@v7\b/,
    /uses:\s*actions\/attest-build-provenance@v4\b/,
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
  const jobBlocks = {
    attest: workflowText.match(/\n  attest:\n([\s\S]*?)\n  trust-materials:\n/)?.[1] || '',
    'release-bundle': workflowText.match(/\n  release-bundle:\n([\s\S]*?)\n  attest:\n/)?.[1] || '',
    'trust-materials': workflowText.match(/\n  trust-materials:\n([\s\S]*?)\n  publish:\n/)?.[1] || '',
    'readiness-gate': workflowText.match(/\n  readiness-gate:\n([\s\S]*)$/)?.[1] || ''
  };
  for (const [jobName, jobBlock] of Object.entries(jobBlocks)) {
    if (!jobBlock) {
      console.error(`${label} is missing job block for ${jobName}.`);
      process.exit(1);
    }
    if (jobName === 'attest') continue;
    if (!new RegExp(`${nodeVersionPattern}[\\s\\S]*cache:\\s*npm`).test(jobBlock)) {
      console.error(`${label} ${jobName} must enable npm cache in setup-node.`);
      process.exit(1);
    }
    if (!/- name:\s*Install deps[\s\S]*npm run bootstrap:ci/.test(jobBlock)) {
      console.error(`${label} ${jobName} must install dependencies before running Node-based release tooling.`);
      process.exit(1);
    }
  }
  const readinessBlock = jobBlocks['readiness-gate'];
  if (/gh workflow run "\$workflow" --ref "\$target_ref"/.test(readinessBlock)) {
    if (!/permissions:\s*\n\s*contents:\s*read\s*\n\s*actions:\s*write/.test(readinessBlock)) {
      console.error(`${label} readiness-gate must grant actions: write when it can dispatch CI workflows.`);
      process.exit(1);
    }
  }
  const readinessRunIdPurityPatterns = [
    /echo "dispatching \$workflow for \$target_ref \(\$target_sha\)" >&2/,
    /gh workflow run "\$workflow" --ref "\$target_ref" >&2/,
    /echo "waiting for \$workflow on \$target_sha \(\$result\)" >&2/,
    /echo "timed out waiting for \$workflow on \$target_sha" >&2/,
    /case "\$ci_run_id" in ''\|\*\[!0-9\]\*\)/,
    /case "\$ci_long_run_id" in ''\|\*\[!0-9\]\*\)/
  ];
  for (const pattern of readinessRunIdPurityPatterns) {
    if (!pattern.test(readinessBlock)) {
      console.error(`${label} readiness-gate must keep wait progress off run-id stdout and assert numeric run ids: ${pattern}`);
      process.exit(1);
    }
  }
  const prepareBlock = workflowText.match(/\n  prepare:\n([\s\S]*?)\n  build-node-packages:\n/)?.[1] || '';
  const verifyNodeBlock = workflowText.match(/\n  verify-node-packages:\n([\s\S]*?)\n  build-tui:\n/)?.[1] || '';
  const verifyTuiBlock = workflowText.match(/\n  verify-tui:\n([\s\S]*?)\n  release-bundle:\n/)?.[1] || '';
  const publishBlockMatch = workflowText.match(/\n  publish:\n([\s\S]*?)\n  readiness-gate:\n/);
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
  if (!/stageReleaseAssets\('dist\/release'\)/.test(publishBlock)) {
    console.error(`${label} publish job must stage validated downloads, bundle and trust assets.`);
    process.exit(1);
  }
  if (!/RELEASE_GIT_SHA:\s*\$\{\{\s*needs\.prepare\.outputs\.release_git_sha\s*\}\}/.test(publishBlock)) {
    console.error(`${label} publish job must bind publishing to the verified release git SHA.`);
    process.exit(1);
  }
  const publishTagBindingPatterns = [
    /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/tags\/\$RELEASE_TAG"/,
    /gh api "repos\/\$GITHUB_REPOSITORY\/git\/tags\/\$tag_object_sha"/,
    /\$\{current_tag_sha,,\}" != "\$\{RELEASE_GIT_SHA,,\}/,
    /release tag \$RELEASE_TAG points at \$current_tag_sha, not verified SHA \$RELEASE_GIT_SHA/,
    /gh release create "\$RELEASE_TAG" --verify-tag/
  ];
  for (const pattern of publishTagBindingPatterns) {
    if (!pattern.test(publishBlock)) {
      console.error(`${label} publish job must verify the release tag still points at the prepared SHA: ${pattern}`);
      process.exit(1);
    }
  }
  const stageOffset = publishBlock.indexOf("stageReleaseAssets('dist/release')");
  if (stageOffset < 0 || stageOffset > publishBlock.indexOf('gh release create')
    || !/mapfile -t upload_args[^\n]*plan\.uploadPaths/.test(publishBlock)
    || !/uses: actions\/checkout@v7[\s\S]*ref:\s*\$\{\{\s*needs\.prepare\.outputs\.release_git_sha\s*\}\}/.test(publishBlock)
    || !/uses: actions\/setup-node@v7/.test(publishBlock)
    || /file_path\}#/.test(publishBlock)) {
    console.error(`${label} publish job must validate unique asset basenames before release mutation and upload the staged plan.`);
    process.exit(1);
  }
  if (!/name:\s*release-prepare-docs[\s\S]*docs\/tooling\/doc-contract-drift\.json[\s\S]*docs\/tooling\/doc-contract-drift\.md/.test(prepareBlock)) {
    console.error(`${label} prepare job must upload doc drift artifacts in a dedicated artifact.`);
    process.exit(1);
  }
  if (!/id:\s*release-revision[\s\S]*git rev-parse HEAD[\s\S]*id:\s*release-metadata/.test(prepareBlock)) {
    console.error(`${label} prepare job must resolve the checked-out release SHA before generating metadata.`);
    process.exit(1);
  }
  if (!/RELEASE_GIT_SHA:\s*\$\{\{\s*steps\.release-revision\.outputs\.release_git_sha\s*\}\}[\s\S]*node tools\/release\/metadata\.js[\s\S]*--git-sha "\$RELEASE_GIT_SHA"/.test(prepareBlock)) {
    console.error(`${label} release metadata must be bound to the checked-out release SHA.`);
    process.exit(1);
  }
  if (!/name:\s*release-node-packages[\s\S]*path:\s*dist/.test(verifyNodeBlock)) {
    console.error(`${label} verify-node-packages must download packaged artifacts into dist.`);
    process.exit(1);
  }
  if (!/name:\s*release-tui-\$\{\{\s*matrix\.release_id\s*\}\}[\s\S]*path:\s*dist/.test(verifyTuiBlock)) {
    console.error(`${label} verify-tui must download build artifacts into dist.`);
    process.exit(1);
  }
  if (!/--runtime-target\s+\$\{\{\s*matrix\.release_id\s*\}\}/.test(verifyTuiBlock)) {
    console.error(`${label} verify-tui release reports must record the matrix runtime target.`);
    process.exit(1);
  }
  if (!/name:\s*release-trust-materials[\s\S]*path:\s*\|\s*[\r\n]+\s*dist\/release\/trust\b/.test(workflowText)) {
    console.error(`${label} trust materials artifact must preserve the trust directory root.`);
    process.exit(1);
  }
  for (const [jobName, jobBlock] of [
    ['attest', jobBlocks.attest],
    ['publish', publishBlock],
    ['readiness-gate', jobBlocks['readiness-gate']]
  ]) {
    if (!/name:\s*release-trust-materials[\s\S]*path:\s*dist\/release\/trust/.test(jobBlock)) {
      console.error(`${label} ${jobName} must download trust materials to dist/release/trust.`);
      process.exit(1);
    }
  }
  if (!/name:\s*release-prepare-docs[\s\S]*path:\s*dist\/release\/downloads\/release-prepare-docs/.test(jobBlocks['release-bundle'])) {
    console.error(`${label} release-bundle must download prepare doc drift artifacts.`);
    process.exit(1);
  }
  for (const releaseId of ['ubuntu', 'windows', 'macos']) {
    const pattern = new RegExp(`name:\\s*release-tui-${releaseId}[\\s\\S]*path:\\s*dist\\/release\\/downloads\\/release-tui-${releaseId}`);
    if (!pattern.test(jobBlocks['release-bundle'])) {
      console.error(`${label} release-bundle must download release-tui-${releaseId} by exact artifact name.`);
      process.exit(1);
    }
  }
  if (/pattern:\s*release-tui-\*/.test(jobBlocks['release-bundle'])) {
    console.error(`${label} release-bundle must not use the overlapping release-tui-* artifact pattern.`);
    process.exit(1);
  }
  if (!/name:\s*release-prepare-docs[\s\S]*path:\s*dist\/release\/downloads\/release-prepare-docs/.test(jobBlocks['readiness-gate'])) {
    console.error(`${label} readiness-gate must download prepare doc drift artifacts.`);
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

const minimumActionMajor = {
  'checkout': 7,
  'setup-node': 7,
  'setup-python': 7,
  'cache': 6,
  'upload-artifact': 6,
  'download-artifact': 7,
  'github-script': 9,
  'attest-build-provenance': 3
};
// GitHub expands job env before runner context exists. Step env may use it.
const assertJobEnvironmentContexts = (workflow, label) => {
  for (const [id, job] of Object.entries(workflow.jobs || {})) {
    for (const [key, value] of Object.entries(job.env || {})) {
      if (typeof value !== 'string') continue;
      for (const [, expression] of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const code = expression.replace(/'(?:[^']|'')*'/g, '');
        if (/\brunner\s*[.\[]/.test(code)) throw new Error(`${label}:${id}.env.${key}: runner context is unavailable in job env.`);
      }
    }
  }
};
const assertBootstrapPython = (workflow, label) => {
  for (const [id, job] of Object.entries(workflow.jobs || {})) {
    const steps = job.steps || [];
    const setup = steps.findIndex(step => step.uses?.startsWith('actions/setup-python@'));
    for (let index = 0; index < steps.length; index++) {
      if (!/npm run bootstrap(?::ci)?\b/.test(steps[index].run || '')) continue;
      assert.ok(setup >= 0 && setup < index, `${label}:${id} must select Python before native bootstrap`);
      assert.equal(steps[setup].with?.['python-version-file'], '.python-version');
      assert.ok([undefined, false, 'false'].includes(steps[setup].with?.['allow-prereleases']),
        `${label}:${id} must retain stable-only Python selection`);
      assert.equal(steps[index].env?.NODE_GYP_FORCE_PYTHON,
        '${{ steps.' + steps[setup].id + '.outputs.python-path }}',
        `${label}:${id} must bind preflight/node-gyp to the selected interpreter`);
    }
  }
};
const pythonBootstrapControl = {
  jobs: { fixture: { steps: [
    { id: 'python-runtime', uses: 'actions/setup-python@v7', with: { 'python-version-file': '.python-version' } },
    { run: 'npm run bootstrap:ci', env: { NODE_GYP_FORCE_PYTHON: '${{ steps.python-runtime.outputs.python-path }}' } }
  ] } }
};
assert.doesNotThrow(() => assertBootstrapPython(pythonBootstrapControl, 'positive'));
const missingPython = structuredClone(pythonBootstrapControl);
missingPython.jobs.fixture.steps.shift();
assert.throws(() => assertBootstrapPython(missingPython, 'negative'), /select Python before native bootstrap/);
const stalePython = structuredClone(pythonBootstrapControl);
stalePython.jobs.fixture.steps[1].env.NODE_GYP_FORCE_PYTHON = 'python';
assert.throws(() => assertBootstrapPython(stalePython, 'negative'), /bind preflight\/node-gyp/);
for (const expression of ['${{ runner.temp }}/home', '${{ runner[\'temp\'] }}/home']) {
  assert.throws(() => assertJobEnvironmentContexts({ jobs: { fixture: { env: { HOME: expression } } } }, 'negative'), /runner context is unavailable/);
}
assert.doesNotThrow(() => assertJobEnvironmentContexts({ jobs: { fixture: {
  env: { HOME: '${{ github.workspace }}/.tmp/home', LABEL: '${{ format(\'runner.temp\') }}' },
  steps: [{ env: { HOME: '${{ runner.temp }}/home' } }]
} } }, 'supported'));
// v9 adds getOctokit to the injected parameters and makes @actions/github ESM-only.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const githubScriptParameters = [
  'require', '__original_require__', 'github', 'octokit', 'getOctokit',
  'context', 'core', 'exec', 'glob', 'io'
];
const pinnedActionRefs = {
  checkout: '3d3c42e5aac5ba805825da76410c181273ba90b1',
  'github-script': '3a2844b7e9c422d3c10d287c895573f7108da1b3'
};
for (const fileName of fs.readdirSync(path.join(ROOT, '.github', 'workflows'))) {
  if (!fileName.endsWith('.yml')) continue;
  const workflowText = readWorkflow(fileName);
  for (const match of workflowText.matchAll(/uses:\s*actions\/([a-z-]+)@v(\d+)\b/g)) {
    const minimum = minimumActionMajor[match[1]];
    if (minimum && Number(match[2]) < minimum) {
      console.error(`${fileName}: actions/${match[1]} must use the supported major v${minimum} or newer.`);
      process.exit(1);
    }
  }
  const workflow = parse(workflowText);
  assertJobEnvironmentContexts(workflow, fileName);
  assertBootstrapPython(workflow, fileName);
  for (const job of Object.values(workflow.jobs || {})) {
    for (const step of job.steps || []) {
      const pinnedAction = step.uses?.match(/^actions\/(checkout|github-script)@([0-9a-f]{40})$/);
      if (pinnedAction && pinnedAction[2] !== pinnedActionRefs[pinnedAction[1]]) {
        throw new Error(`${fileName}: actions/${pinnedAction[1]} must pin the verified supported release.`);
      }
      if (!step.uses?.startsWith('actions/github-script@')) continue;
      const script = step.with?.script;
      if (typeof script !== 'string') throw new Error(`${fileName}: github-script requires a script.`);
      if (/(?:require|__original_require__)\s*\(\s*['"]@actions\/github(?:\/[^'"]*)?['"]/.test(script)) {
        throw new Error(`${fileName}: use the injected github/getOctokit instead of requiring @actions/github.`);
      }
      // Compile only: never execute API calls or other workflow effects in this contract.
      new AsyncFunction(...githubScriptParameters, script);
    }
  }
}

const ciWorkflow = readWorkflow('ci.yml');
const windowsJob = parse(ciWorkflow).jobs.windows;
const ownershipStepIndex = windowsJob.steps.findIndex(step => step.name === 'Windows subprocess ownership');
const ownershipCommand = windowsJob.steps[ownershipStepIndex]?.run || '';
if (ownershipStepIndex < 0 || ownershipStepIndex >= windowsJob.steps.findIndex(step => step.name === 'CI Suite')
  || !ownershipCommand.includes('shared\\/kill-tree\\.windows$')
  || !ownershipCommand.includes('shared\\/kill-tree\\.windows-orphan-descendant-fallback$')
  || !ownershipCommand.includes('shared\\/kill-tree-windows-snapshot$')
  || !ownershipCommand.includes('shared\\/subprocess\\/sync-timeout-kills-child-tree$')
  || !ownershipCommand.includes('shared\\/locks\\/windows-delete-pending$')
  || !ownershipCommand.includes('--jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false')) {
  throw new Error('Windows ownership must run its native snapshot, three lifecycle fixtures and native delete-pending control before the broad suite with strict bounds and zero retries.');
}
for (const platform of ['ubuntu', 'windows', 'macos']) {
  const steps = parse(ciWorkflow).jobs[platform].steps;
  const crash = steps.findIndex(step => step.name === 'Serial crash-log ownership and latency qualification');
  assert.ok(crash >= 0 && crash < steps.findIndex(step => step.name === 'CI Suite'),
    `${platform}: qualify crash-log ownership and serial latency before the broad suite`);
  const crashCommand = steps[crash].run;
  assert.ok(crashCommand.includes('terminal-ownership|state-write-contention|independent-sinks|boundary-controls')
    && crashCommand.includes('perf\\/crash-log-error-latency\\/')
    && crashCommand.includes('--jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false')
    && crashCommand.includes('--report-file .diagnostics/crash-log-qualification.json'),
  `${platform}: retain original crash ownership cases, raw latency receipts and strict serial bounds`);
  const crashUpload = steps.find(step => step.name === 'Upload quality artifacts');
  assert.ok(crashUpload.with.path.split(/\r?\n/u).includes('.diagnostics/crash-log-qualification.json'),
    `${platform}: upload the source-bound crash-log report and test logs`);
  const goSetup = steps.findIndex(step => step.name === 'Setup qualified Go SDK');
  const goVerify = steps.findIndex(step => step.name === 'Verify selected Go SDK');
  const goStartup = steps.findIndex(step => step.name === 'Qualify real Go language server startup');
  const shutdown = steps.findIndex(step => step.name === 'Serial LSP shutdown ownership qualification');
  assert.ok(shutdown >= 0 && shutdown < goStartup
    && steps[shutdown].run.includes('graceful-exit-after-transport-close\\/')
    && steps[shutdown].run.includes('handshake-admission-and-cancellation')
    && steps[shutdown].run.includes('--jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false')
    && steps[shutdown].run.includes('--report-file .diagnostics/lsp-shutdown-qualification.json')
    && crashUpload.with.path.split(/\r?\n/u).includes('.diagnostics/lsp-shutdown-qualification.json'),
  `${platform}: require serial graceful/forced LSP shutdown and retain exact ownership receipts before real server qualification`);
  const goProvision = steps.findIndex(step => step.name === 'Provision pinned Go language server for CI');
  const go = steps[goSetup];
  if (goSetup < 0 || goVerify <= goSetup
    || goVerify >= steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)')
    || go.uses !== 'actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e'
    || go.with?.['go-version'] !== '1.27.3' || go.with?.cache !== false
    || !steps[goVerify].run.includes('delete env.GOROOT')
    || !steps[goVerify].run.includes('GOTOOLCHAIN=local')
    || !steps[goVerify].run.includes('.diagnostics/go-sdk.json')
    || goProvision <= goVerify || goProvision >= steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)')
    || steps[goProvision].run !== 'node tools/ci/provision-gopls.js'
    || goStartup <= steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)')
    || goStartup >= steps.findIndex(step => step.name === 'CI Suite')
    || !steps[goStartup].run.includes('qualifyInstalledLspRuntime')
    || !steps[goStartup].run.includes('providerId: "gopls"')
    || !steps[goStartup].run.includes('dir: provision.toolingRoot')
    || !steps[goStartup].run.includes('fs.realpathSync(provision.command)')
    || !steps[goStartup].run.includes('receipt.binarySha256, provision.binarySha256')) {
    throw new Error(`${platform}: qualify the explicit compatible Go SDK before optional installs, bind its root, and retain the executable receipt.`);
  }
  const dotnetSetup = steps.findIndex(step => step.name === 'Setup qualified .NET SDK');
  const dotnetVerify = steps.findIndex(step => step.name === 'Verify selected .NET SDK');
  const csharpStartup = steps.findIndex(step => step.name === 'Qualify real Csharp language server startup');
  const csharpProvision = steps.findIndex(step => step.name === 'Provision pinned Csharp language server for CI');
  const dotnet = steps[dotnetSetup];
  if (dotnetSetup < 0 || dotnetVerify <= dotnetSetup
    || dotnetVerify >= steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)')
    || dotnet.uses !== 'actions/setup-dotnet@a98b56852c35b8e3190ac28c8c2271da59106c68'
    || dotnet.with?.['dotnet-version'] !== '10.0.403'
    || dotnet.env?.DOTNET_INSTALL_DIR !== '${{ runner.temp }}/poc-dotnet-sdk'
    || parse(ciWorkflow).jobs[platform].env?.DOTNET_GENERATE_ASPNET_CERTIFICATE !== 'false'
    || parse(ciWorkflow).jobs[platform].env?.DOTNET_CLI_HOME !== '${{ github.workspace }}/.tmp/ci/dotnet-cli-home'
    || parse(ciWorkflow).jobs[platform].env?.NUGET_PACKAGES !== '${{ github.workspace }}/.tmp/ci/nuget-packages'
    || !steps[dotnetVerify].run.includes('DOTNET_HOST_PATH=')
    || !steps[dotnetVerify].run.includes('DOTNET_ROOT_')
    || !steps[dotnetVerify].run.includes('.diagnostics/dotnet-sdk.json')
    || csharpStartup <= steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)')
    || csharpStartup >= steps.findIndex(step => step.name === 'CI Suite')
    || csharpProvision <= dotnetVerify || csharpProvision >= csharpStartup
    || steps[csharpProvision].run !== 'node tools/ci/provision-csharp-ls.js'
    || steps[csharpStartup].env?.PAIROFCLEATS_TRUSTED_REPOS !== "${{ format('[{0},{1}]', toJSON(github.workspace), toJSON(format('{0}/.diagnostics/.lsp-qualification/csharp-ls', github.workspace))) }}"
    || !steps[csharpStartup].run.includes('dir: provision.toolingRoot')
    || !steps[csharpStartup].run.includes('fs.realpathSync(provision.command)')
    || !steps[csharpStartup].run.includes('receipt.binarySha256, provision.binarySha256')
    || !steps[csharpStartup].run.includes('qualifyInstalledLspRuntime')
    || !steps[csharpStartup].run.includes('providerId: "csharp-ls"')) {
    throw new Error(`${platform}: qualify the isolated .NET SDK and real C# runtime, bind host/architecture roots, and prevent unrelated development-certificate generation.`);
  }
  const upload = steps.find(step => step.name === 'Upload quality artifacts');
  const paths = String(upload?.with?.path || '').trim().split(/\r?\n/).map(line => line.trim());
  const optional = steps.findIndex(step => step.name === 'Install optional LSP tools (best effort)');
  assert.ok(!/--tools\s+[^\s]*\bgopls\b/u.test(steps[optional].run), 'CI runtime setup cannot depend on the application\'s unqualified managed gopls build forecast');
  assert.ok(paths.includes('.diagnostics/gopls-provisioning.json'), 'CI must retain the separately provisioned Go server identity');
  assert.ok(paths.includes('.diagnostics/csharp-ls-provisioning.json'), 'CI must retain the separately provisioned Csharp server identity');
  assert.ok(!/--tools\s+[^\s]*\bcsharp-ls\b/u.test(steps[optional].run), 'Required Csharp setup cannot depend on an unqualified product install forecast');
  const phpSetup = steps.findIndex(step => step.name === 'Setup qualified PHP runtime');
  const phpVerify = steps.findIndex(step => step.name === 'Verify selected PHP runtime');
  const phpStartup = steps.findIndex(step => step.name === 'Qualify real PHPactor startup');
  const phpProvision = steps.findIndex(step => step.name === 'Provision pinned PHPactor for CI');
  if (platform === 'windows') {
    const declaration = steps.findIndex(step => step.name === 'Record PHPactor native platform limitation');
    const selected = /--tools\s+([^\s]+)/.exec(steps[optional].run)?.[1].split(',') || [];
    if (selected.includes('phpactor') || phpSetup !== -1 || phpStartup !== -1 || phpProvision !== -1
      || declaration <= optional || declaration >= steps.findIndex(step => step.name === 'CI Suite')
      || !steps[declaration].run.includes('"unsupported_platform"')
      || !steps[declaration].run.includes('tooling/install/phpactor-platform-contract')
      || !paths.includes('.diagnostics/phpactor-platform.json')) {
      throw new Error('Windows must declare the stock PHAR POSIX limitation and its actual guard owner, separately from supported-platform startup.');
    }
  } else {
    const setup = steps[phpSetup];
    if (phpSetup < 0 || phpVerify <= phpSetup || phpVerify >= optional
      || setup.uses !== 'shivammathur/setup-php@eb7c497e18156a6bbabfef1d3a82760b9eda3962'
      || setup.with?.['php-version'] !== '8.5.12' || setup.with?.coverage !== 'none' || setup.with?.tools !== 'none'
      || !String(setup.with?.extensions).split(/,\s*/).includes('posix')
      || !steps[phpVerify].run.includes('get_loaded_extensions()')
      || steps[optional].env?.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS !== '["https://release-assets.githubusercontent.com"]'
      || phpStartup <= optional || phpStartup >= steps.findIndex(step => step.name === 'CI Suite')
      || steps[phpStartup].env?.PAIROFCLEATS_TRUSTED_REPOS !== "${{ format('[{0},{1}]', toJSON(github.workspace), toJSON(format('{0}/.diagnostics/.lsp-qualification/phpactor', github.workspace))) }}"
      || phpProvision <= phpVerify || phpProvision >= phpStartup
      || steps[phpProvision].run !== 'node tools/ci/provision-phpactor.js'
      || steps[phpProvision].env?.PAIROFCLEATS_DOWNLOAD_REDIRECT_ORIGINS !== '["https://release-assets.githubusercontent.com"]'
      || !steps[phpStartup].run.includes('dir: provision.toolingRoot')
      || !steps[phpStartup].run.includes('fs.realpathSync(provision.command)')
      || !steps[phpStartup].run.includes('receipt.binarySha256, provision.binarySha256')
      || !paths.includes('.diagnostics/phpactor-provisioning.json')
      || !steps[phpStartup].run.includes('qualifyInstalledLspRuntime')
      || !steps[phpStartup].run.includes('providerId: "phpactor"')
      || !steps[phpStartup].env?.XDG_CACHE_HOME?.startsWith('${{ runner.temp }}/')
      || !paths.includes('.diagnostics/php-sdk.json') || !paths.includes('.diagnostics/phpactor-startup.json')) {
      throw new Error(`${platform}: select and verify PHP/POSIX before delivery, scope the existing redirect approval to installation, and require real PHPactor shutdown/exit evidence.`);
    }
  }
  if (upload?.if !== 'always()' || !paths.includes('.testLogs/**/*.log')
    || !paths.includes('.testLogs/**/*.failure.json') || !paths.includes('.diagnostics/go-sdk.json')
    || !paths.includes('.diagnostics/gopls-startup.json') || !paths.includes('.diagnostics/serial-native-lifecycle.json')
    || !paths.includes('.diagnostics/dotnet-sdk.json') || !paths.includes('.diagnostics/csharp-ls-startup.json')) {
    throw new Error(`${platform}: quality artifacts must preserve every raw attempt and failure receipt, including retry-masked failures.`);
  }
  if (platform === 'windows' && !paths.includes('.diagnostics/windows-subprocess-ownership.json')) {
    throw new Error('Windows quality artifacts must retain the early ownership result even when the broad suite does not run.');
  }
}
const gateJob = parse(ciWorkflow).jobs.gate;
const gateCommand = gateJob.steps.find((step) => step.name === 'Gate lane')?.run || '';
if (/--allow-timeouts/.test(gateCommand) || !/--timeout-ms 30000/.test(gateCommand)
  || gateJob.steps.find((step) => step.name === 'Upload gate artifacts')?.if !== 'always()') {
  console.error('The mandatory gate must reject bounded timeouts and always retain acceptance receipts.');
  process.exit(1);
}
assertWorkflowScriptsExist({ workflowText: ciWorkflow, label: 'CI workflow' });
assertNodePinned({ workflowText: ciWorkflow, label: 'CI workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: ciWorkflow, label: 'CI workflow' });
assertWorkflowDispatchPresent({ workflowText: ciWorkflow, label: 'CI workflow' });
assertReleaseTagTriggerPresent({ workflowText: ciWorkflow, label: 'CI workflow' });
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
assertReleaseTagTriggerPresent({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });
assertCommandSurfaceAuditPresent({ workflowText: ciLongWorkflow, label: 'CI-long workflow' });

const releaseWorkflow = readWorkflow('release.yml');
assertWorkflowScriptsExist({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertNodePinned({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertReleaseWorkflowStructure({ workflowText: releaseWorkflow, label: 'Release workflow' });
assertReleaseWorkflowStructure({ workflowText: normalizeEol(releaseWorkflow).replaceAll('\n', '\r\n'), label: 'CRLF release workflow' });

console.log('workflow contract test passed (ci, ci-long, nightly, release)');
