#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionDir = path.join(root, 'extensions', 'vscode');
const manifestPath = path.join(extensionDir, 'package.json');
const entryPath = path.join(extensionDir, 'extension.js');
const packagingScriptPath = path.join(root, 'tools', 'package-vscode.js');
const determinismSpecPath = path.join(root, 'docs', 'specs', 'editor-packaging-determinism.md');
const contractPath = path.join(root, 'docs', 'tooling', 'editor-config-contract.json');
const guidePath = path.join(root, 'docs', 'guides', 'editor-integration.md');

for (const target of [manifestPath, entryPath, packagingScriptPath, determinismSpecPath, contractPath, guidePath]) {
  if (!fs.existsSync(target)) {
    console.error(`VS Code extension test missing required file: ${target}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const guide = fs.readFileSync(guidePath, 'utf8');

const activationEvents = new Set(manifest.activationEvents || []);
const expectedCommands = new Map([
  ['pairofcleats.search', 'PairOfCleats: Search'],
  ['pairofcleats.setup', 'PairOfCleats: Setup'],
  ['pairofcleats.bootstrap', 'PairOfCleats: Bootstrap'],
  ['pairofcleats.doctor', 'PairOfCleats: Tooling Doctor'],
  ['pairofcleats.configDump', 'PairOfCleats: Config Dump'],
  ['pairofcleats.indexHealth', 'PairOfCleats: Index Health'],
  ['pairofcleats.codeMap', 'PairOfCleats: Code Map'],
  ['pairofcleats.architectureCheck', 'PairOfCleats: Architecture Check'],
  ['pairofcleats.impact', 'PairOfCleats: Impact Analysis'],
  ['pairofcleats.suggestTests', 'PairOfCleats: Suggest Tests'],
  ['pairofcleats.workspaceManifest', 'PairOfCleats: Workspace Manifest'],
  ['pairofcleats.workspaceStatus', 'PairOfCleats: Workspace Status'],
  ['pairofcleats.workspaceBuild', 'PairOfCleats: Workspace Build'],
  ['pairofcleats.workspaceCatalog', 'PairOfCleats: Workspace Catalog'],
  ['pairofcleats.showWorkflowStatus', 'PairOfCleats: Workflow Status'],
  ['pairofcleats.rerunLastWorkflow', 'PairOfCleats: Rerun Last Workflow'],
  ['pairofcleats.showRecentWorkflows', 'PairOfCleats: Recent Workflows'],
  ['pairofcleats.reopenLastResults', 'PairOfCleats: Reopen Last Results'],
  ['pairofcleats.showSearchHistory', 'PairOfCleats: Search History'],
  ['pairofcleats.groupResultsBySection', 'PairOfCleats: Group Results by Section'],
  ['pairofcleats.groupResultsByFile', 'PairOfCleats: Group Results by File'],
  ['pairofcleats.groupResultsByQuery', 'PairOfCleats: Group Results by Query'],
  ['pairofcleats.openResultHit', 'PairOfCleats: Open Result Hit'],
  ['pairofcleats.revealResultHit', 'PairOfCleats: Reveal Result Hit'],
  ['pairofcleats.copyResultPath', 'PairOfCleats: Copy Result Path'],
  ['pairofcleats.rerunResultSet', 'PairOfCleats: Rerun Result Set']
]);
for (const commandId of expectedCommands.keys()) {
  if (!activationEvents.has(`onCommand:${commandId}`)) {
    console.error(`VS Code extension activation event missing for ${commandId}.`);
    process.exit(1);
  }
}

const commands = manifest.contributes?.commands || [];
for (const [commandId, title] of expectedCommands.entries()) {
  const command = commands.find((cmd) => cmd.command === commandId);
  if (!command) {
    console.error(`VS Code extension command missing: ${commandId}.`);
    process.exit(1);
  }
  if (command.title !== title) {
    console.error(`VS Code extension command title drifted for ${commandId}.`);
    process.exit(1);
  }
}

const explorerViews = manifest.contributes?.views?.explorer || [];
if (!explorerViews.some((view) => view.id === 'pairofcleats.resultsExplorer')) {
  console.error('VS Code extension explorer view missing pairofcleats.resultsExplorer.');
  process.exit(1);
}

const settings = contract?.settings?.vscode || {};
const keyMap = {
  cliPathKey: 'pairofcleats',
  cliArgsKey: 'pairofcleats',
  modeKey: 'pairofcleats',
  backendKey: 'pairofcleats',
  annKey: 'pairofcleats',
  maxResultsKey: 'pairofcleats',
  contextLinesKey: 'pairofcleats',
  fileKey: 'pairofcleats',
  pathKey: 'pairofcleats',
  langKey: 'pairofcleats',
  extKey: 'pairofcleats',
  typeKey: 'pairofcleats',
  caseSensitiveKey: 'pairofcleats',
  envKey: 'pairofcleats',
  extraSearchArgsKey: 'pairofcleats'
};

const expectedSettings = Object.entries(keyMap)
  .map(([contractKey, prefix]) => `${prefix}.${settings[contractKey]}`)
  .filter(Boolean);
const configProps = manifest.contributes?.configuration?.properties || {};
for (const prop of expectedSettings) {
  if (!configProps[prop]) {
    console.error(`VS Code extension config missing ${prop}.`);
    process.exit(1);
  }
}

const guideSettings = new Set(
  Array.from(guide.matchAll(/- `([^`]+)`/g), (match) => match[1]).filter((entry) => entry.startsWith('pairofcleats.'))
);
for (const prop of expectedSettings) {
  if (!guideSettings.has(prop)) {
    console.error(`VS Code editor guide missing ${prop}.`);
    process.exit(1);
  }
}

const modeEnum = configProps['pairofcleats.searchMode']?.enum || [];
if (!modeEnum.includes('extracted-prose')) {
  console.error('VS Code searchMode enum missing extracted-prose.');
  process.exit(1);
}

const backendEnum = configProps['pairofcleats.searchBackend']?.enum || [];
for (const value of ['', 'auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb', 'tantivy']) {
  if (!backendEnum.includes(value)) {
    console.error(`VS Code searchBackend enum missing ${value || '<empty>'}.`);
    process.exit(1);
  }
}

if (configProps['pairofcleats.env']?.type !== 'object') {
  console.error('VS Code env setting must be an object.');
  process.exit(1);
}

console.log('VS Code extension tests passed');
