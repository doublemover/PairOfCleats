#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getEditorCommandSpecs } from '../../../src/shared/runtime-capability-manifest.js';

const root = process.cwd();
const extensionDir = path.join(root, 'extensions', 'vscode');
const manifestPath = path.join(extensionDir, 'package.json');
const entryPath = path.join(extensionDir, 'extension.js');
const packagingScriptPath = path.join(root, 'tools', 'package-vscode.js');
const determinismSpecPath = path.join(root, 'docs', 'specs', 'editor-packaging-determinism.md');
const contractPath = path.join(root, 'src', 'shared', 'editor-config-contract.json');
const packagedContractPath = path.join(extensionDir, 'editor-config-contract.json');
const guidePath = path.join(root, 'docs', 'guides', 'editor-integration.md');
const sublimeConfigPath = path.join(root, 'sublime', 'PairOfCleats', 'lib', 'config.py');

for (const target of [manifestPath, entryPath, packagingScriptPath, determinismSpecPath, contractPath, packagedContractPath, guidePath, sublimeConfigPath]) {
  if (!fs.existsSync(target)) {
    console.error(`VS Code extension test missing required file: ${target}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const packagedContract = JSON.parse(fs.readFileSync(packagedContractPath, 'utf8'));
const guide = fs.readFileSync(guidePath, 'utf8');
const extensionSource = fs.readFileSync(entryPath, 'utf8');
const sublimeConfigSource = fs.readFileSync(sublimeConfigPath, 'utf8');

if (extensionSource.includes('docs/tooling/editor-config-contract.json')) {
  console.error('VS Code extension must not load editor config contract from docs/tooling.');
  process.exit(1);
}
if (sublimeConfigSource.includes('docs/tooling/editor-config-contract.json')) {
  console.error('Sublime config must not load editor config contract from docs/tooling.');
  process.exit(1);
}
if (JSON.stringify(packagedContract) !== JSON.stringify(contract)) {
  console.error('VS Code packaged editor config contract drifted from src/shared/editor-config-contract.json.');
  process.exit(1);
}

const requiredMetadata = [
  ['homepage', manifest.homepage],
  ['repository.url', manifest.repository?.url],
  ['bugs.url', manifest.bugs?.url],
  ['publisher', manifest.publisher],
  ['markdown', manifest.markdown]
];
for (const [label, value] of requiredMetadata) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    console.error(`VS Code extension metadata missing ${label}.`);
    process.exit(1);
  }
}
if (manifest.capabilities?.virtualWorkspaces !== false) {
  console.error('VS Code extension must declare virtualWorkspaces=false.');
  process.exit(1);
}

const activationEvents = new Set(manifest.activationEvents || []);
const expectedCommands = new Map(getEditorCommandSpecs().map((entry) => [entry.id, entry.title]));
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

const commandPaletteMenus = manifest.contributes?.menus?.commandPalette || [];
const editorContextMenus = manifest.contributes?.menus?.['editor/context'] || [];
const viewTitleMenus = manifest.contributes?.menus?.['view/title'] || [];
const viewItemContextMenus = manifest.contributes?.menus?.['view/item/context'] || [];
const requireCommandPaletteWhen = new Map([
  ['pairofcleats.searchSelection', 'editorTextFocus && editorHasSelection'],
  ['pairofcleats.searchSymbolUnderCursor', 'editorTextFocus'],
  ['pairofcleats.selectRepo', 'workbenchState != empty'],
  ['pairofcleats.clearSelectedRepo', 'workbenchState != empty'],
  ['pairofcleats.search', 'workbenchState != empty'],
  ['pairofcleats.explainSearch', 'workbenchState != empty'],
  ['pairofcleats.showSearchHistory', 'workbenchState != empty'],
  ['pairofcleats.repeatLastSearch', 'workbenchState != empty'],
  ['pairofcleats.reopenLastResults', 'workbenchState != empty'],
  ['pairofcleats.openIndexDirectory', 'workbenchState != empty'],
  ['pairofcleats.contextPack', 'workbenchState != empty'],
  ['pairofcleats.riskExplain', 'workbenchState != empty'],
  ['pairofcleats.indexBuild', 'workbenchState != empty'],
  ['pairofcleats.indexWatchStart', 'workbenchState != empty'],
  ['pairofcleats.indexWatchStop', 'workbenchState != empty'],
  ['pairofcleats.indexValidate', 'workbenchState != empty'],
  ['pairofcleats.serviceApiStart', 'workbenchState != empty'],
  ['pairofcleats.serviceApiStop', 'workbenchState != empty'],
  ['pairofcleats.serviceIndexerStart', 'workbenchState != empty'],
  ['pairofcleats.serviceIndexerStop', 'workbenchState != empty'],
  ['pairofcleats.openResultHit', 'false'],
  ['pairofcleats.revealResultHit', 'false'],
  ['pairofcleats.copyResultPath', 'false'],
  ['pairofcleats.rerunResultSet', 'false']
]);

for (const [commandId, expectedWhen] of requireCommandPaletteWhen.entries()) {
  const menu = commandPaletteMenus.find((entry) => entry.command === commandId);
  if (!menu) {
    console.error(`VS Code commandPalette menu missing ${commandId}.`);
    process.exit(1);
  }
  if (menu.when !== expectedWhen) {
    console.error(`VS Code commandPalette when drifted for ${commandId}.`);
    process.exit(1);
  }
}

const requireEditorContextWhen = new Map([
  ['pairofcleats.searchSelection', 'editorTextFocus && editorHasSelection'],
  ['pairofcleats.searchSymbolUnderCursor', 'editorTextFocus'],
  ['pairofcleats.explainSearch', 'editorTextFocus'],
  ['pairofcleats.contextPack', 'editorTextFocus'],
  ['pairofcleats.riskExplain', 'editorTextFocus']
]);

for (const [commandId, expectedWhen] of requireEditorContextWhen.entries()) {
  const menu = editorContextMenus.find((entry) => entry.command === commandId);
  if (!menu) {
    console.error(`VS Code editor/context menu missing ${commandId}.`);
    process.exit(1);
  }
  if (menu.when !== expectedWhen) {
    console.error(`VS Code editor/context when drifted for ${commandId}.`);
    process.exit(1);
  }
}

const requiredViewTitleEntries = new Map([
  ['pairofcleats.search', 'view == pairofcleats.resultsExplorer'],
  ['pairofcleats.showSearchHistory', 'view == pairofcleats.resultsExplorer'],
  ['pairofcleats.reopenLastResults', 'view == pairofcleats.resultsExplorer'],
  ['pairofcleats.groupResultsBySection', 'view == pairofcleats.resultsExplorer'],
  ['pairofcleats.groupResultsByFile', 'view == pairofcleats.resultsExplorer'],
  ['pairofcleats.groupResultsByQuery', 'view == pairofcleats.resultsExplorer']
]);
for (const [commandId, expectedWhen] of requiredViewTitleEntries.entries()) {
  const menu = viewTitleMenus.find((entry) => entry.command === commandId);
  if (!menu) {
    console.error(`VS Code view/title menu missing ${commandId}.`);
    process.exit(1);
  }
  if (menu.when !== expectedWhen) {
    console.error(`VS Code view/title when drifted for ${commandId}.`);
    process.exit(1);
  }
}

const requiredViewItemContextEntries = new Map([
  ['pairofcleats.openResultHit', 'view == pairofcleats.resultsExplorer && viewItem == pairofcleats.resultHit'],
  ['pairofcleats.revealResultHit', 'view == pairofcleats.resultsExplorer && viewItem == pairofcleats.resultHit'],
  ['pairofcleats.copyResultPath', 'view == pairofcleats.resultsExplorer && viewItem == pairofcleats.resultHit'],
  ['pairofcleats.rerunResultSet', 'view == pairofcleats.resultsExplorer && viewItem == pairofcleats.resultSet']
]);
for (const [commandId, expectedWhen] of requiredViewItemContextEntries.entries()) {
  const menu = viewItemContextMenus.find((entry) => entry.command === commandId);
  if (!menu) {
    console.error(`VS Code view/item/context menu missing ${commandId}.`);
    process.exit(1);
  }
  if (menu.when !== expectedWhen) {
    console.error(`VS Code view/item/context when drifted for ${commandId}.`);
    process.exit(1);
  }
}

const keybindings = manifest.contributes?.keybindings || [];
const requiredKeybindings = new Map([
  ['pairofcleats.searchSelection', 'editorTextFocus && editorHasSelection'],
  ['pairofcleats.searchSymbolUnderCursor', 'editorTextFocus'],
  ['pairofcleats.repeatLastSearch', 'workbenchState != empty']
]);
for (const [commandId, expectedWhen] of requiredKeybindings.entries()) {
  const binding = keybindings.find((entry) => entry.command === commandId);
  if (!binding) {
    console.error(`VS Code keybinding missing ${commandId}.`);
    process.exit(1);
  }
  if (binding.when !== expectedWhen) {
    console.error(`VS Code keybinding when drifted for ${commandId}.`);
    process.exit(1);
  }
}

const walkthroughs = manifest.contributes?.walkthroughs || [];
if (!walkthroughs.some((entry) => entry.id === 'pairofcleats.gettingStarted')) {
  console.error('VS Code walkthrough missing pairofcleats.gettingStarted.');
  process.exit(1);
}
for (const markdownPath of ['walkthroughs/first-search.md', 'walkthroughs/operations.md']) {
  const fullPath = path.join(root, 'extensions', 'vscode', markdownPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`VS Code walkthrough markdown missing ${markdownPath}.`);
    process.exit(1);
  }
}

const settings = contract?.settings?.vscode || {};
const keyMap = {
  cliPathKey: 'pairofcleats',
  cliArgsKey: 'pairofcleats',
  apiServerUrlKey: 'pairofcleats',
  apiTimeoutKey: 'pairofcleats',
  apiExecutionModeKey: 'pairofcleats',
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
  asOfKey: 'pairofcleats',
  snapshotKey: 'pairofcleats',
  filterKey: 'pairofcleats',
  authorKey: 'pairofcleats',
  modifiedAfterKey: 'pairofcleats',
  modifiedSinceKey: 'pairofcleats',
  churnKey: 'pairofcleats',
  caseSensitiveKey: 'pairofcleats',
  envKey: 'pairofcleats',
  extraSearchArgsKey: 'pairofcleats',
  inlineHoverEnabledKey: 'pairofcleats',
  inlineDiagnosticsEnabledKey: 'pairofcleats',
  inlineDecorationsEnabledKey: 'pairofcleats',
  inlineMaxItemsKey: 'pairofcleats'
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

if (configProps['pairofcleats.apiServerUrl']?.type !== 'string') {
  console.error('VS Code apiServerUrl setting must be a string.');
  process.exit(1);
}

if (configProps['pairofcleats.apiTimeoutMs']?.type !== 'number') {
  console.error('VS Code apiTimeoutMs setting must be a number.');
  process.exit(1);
}

if (configProps['pairofcleats.apiTimeoutMs']?.minimum !== 1) {
  console.error('VS Code apiTimeoutMs setting must enforce a minimum of 1.');
  process.exit(1);
}

const apiExecutionModeEnum = configProps['pairofcleats.apiExecutionMode']?.enum || [];
for (const value of ['cli', 'prefer', 'require']) {
  if (!apiExecutionModeEnum.includes(value)) {
    console.error(`VS Code apiExecutionMode enum missing ${value}.`);
    process.exit(1);
  }
}

if (configProps['pairofcleats.env']?.type !== 'object') {
  console.error('VS Code env setting must be an object.');
  process.exit(1);
}

console.log('VS Code extension tests passed');
