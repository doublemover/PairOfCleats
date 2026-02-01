#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const extensionDir = path.join(root, 'extensions', 'vscode');
const manifestPath = path.join(extensionDir, 'package.json');
const entryPath = path.join(extensionDir, 'extension.js');

if (!fs.existsSync(manifestPath)) {
  console.error('VS Code extension manifest missing.');
  process.exit(1);
}
if (!fs.existsSync(entryPath)) {
  console.error('VS Code extension entrypoint missing.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const activationEvents = new Set(manifest.activationEvents || []);
if (!activationEvents.has('onCommand:pairofcleats.search')) {
  console.error('VS Code extension activation event missing.');
  process.exit(1);
}

const commands = manifest.contributes?.commands || [];
const commandIds = new Set(commands.map((cmd) => cmd.command));
if (!commandIds.has('pairofcleats.search')) {
  console.error('VS Code extension command missing.');
  process.exit(1);
}

const configProps = manifest.contributes?.configuration?.properties || {};
const requiredProps = [
  'pairofcleats.cliPath',
  'pairofcleats.cliArgs',
  'pairofcleats.searchMode',
  'pairofcleats.searchBackend',
  'pairofcleats.searchAnn',
  'pairofcleats.maxResults'
];
for (const prop of requiredProps) {
  if (!configProps[prop]) {
    console.error(`VS Code extension config missing ${prop}.`);
    process.exit(1);
  }
}

console.log('VS Code extension tests passed');
