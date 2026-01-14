#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LIMITS } from '../src/map/constants.js';

const root = process.cwd();

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Failed: ${label} invalid JSON (${filePath})`);
    console.error(String(err?.message || err));
    process.exit(1);
  }
};

const vscodePackagePath = path.join(root, 'extensions', 'vscode', 'package.json');
const vscodePackage = readJson(vscodePackagePath, 'vscode extension manifest');
const vscodeConfig = vscodePackage?.contributes?.configuration?.properties || {};

const getVsCodeDefault = (key) => vscodeConfig?.[key]?.default;

const sublimeSettingsPath = path.join(
  root,
  'sublime',
  'PairOfCleats',
  'PairOfCleats.sublime-settings'
);
const sublimeSettings = readJson(sublimeSettingsPath, 'sublime settings');

const sublimeCommandsPath = path.join(
  root,
  'sublime',
  'PairOfCleats',
  'Default.sublime-commands'
);
const sublimeCommands = readJson(sublimeCommandsPath, 'sublime command palette');

const requiredVsCodeKeys = [
  'pairofcleats.cliPath',
  'pairofcleats.searchMode',
  'pairofcleats.searchBackend',
  'pairofcleats.searchAnn',
  'pairofcleats.maxResults'
];

for (const key of requiredVsCodeKeys) {
  if (!(key in vscodeConfig)) {
    console.error(`Failed: VSCode extension missing configuration property: ${key}`);
    process.exit(1);
  }
}

const requiredSublimeCommands = [
  'pair_of_cleats_search',
  'pair_of_cleats_search_selection',
  'pair_of_cleats_index_build_all',
  'pair_of_cleats_map_repo',
  'pair_of_cleats_map_current_file',
  'pair_of_cleats_map_jump_to_node'
];

if (!Array.isArray(sublimeCommands)) {
  console.error('Failed: Sublime Default.sublime-commands is not a JSON array');
  process.exit(1);
}

const sublimeCommandSet = new Set(sublimeCommands.map((entry) => entry?.command).filter(Boolean));
for (const command of requiredSublimeCommands) {
  if (!sublimeCommandSet.has(command)) {
    console.error(`Failed: Sublime command palette missing command: ${command}`);
    process.exit(1);
  }
}

const ensureEqual = (label, actual, expected) => {
  if (actual !== expected) {
    console.error(`Failed: ${label} expected ${JSON.stringify(expected)} but saw ${JSON.stringify(actual)}`);
    process.exit(1);
  }
};

// Search defaults parity (Sublime ↔ VSCode).
ensureEqual('search limit parity', sublimeSettings.search_limit, getVsCodeDefault('pairofcleats.maxResults'));
ensureEqual('search mode parity', sublimeSettings.index_mode_default, getVsCodeDefault('pairofcleats.searchMode'));
ensureEqual(
  'search backend parity',
  sublimeSettings.search_backend_default,
  getVsCodeDefault('pairofcleats.searchBackend')
);

// Guardrail parity (Sublime ↔ CLI defaults).
ensureEqual('map max files parity', sublimeSettings.map_max_files, DEFAULT_LIMITS.maxFiles);
ensureEqual(
  'map max members per file parity',
  sublimeSettings.map_max_members_per_file,
  DEFAULT_LIMITS.maxMembersPerFile
);
ensureEqual('map max edges parity', sublimeSettings.map_max_edges, DEFAULT_LIMITS.maxEdges);

console.log('editor parity checklist tests passed');
