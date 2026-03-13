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

const nightlyWorkflow = readWorkflow('nightly.yml');
assertWorkflowScriptsExist({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertNodePinned({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });
assertHiddenArtifactUploadsConfigured({ workflowText: nightlyWorkflow, label: 'Nightly workflow' });

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

console.log('workflow contract test passed (ci, ci-long, nightly)');
