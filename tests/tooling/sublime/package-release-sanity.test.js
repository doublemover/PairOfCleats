#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'package-sublime-release-sanity');

const run = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'package-sublime.js'), '--out-dir', outDir, '--smoke'],
  { cwd: root, encoding: 'utf8' }
);
if (run.status !== 0) {
  console.error('package-release-sanity test failed: package-sublime command failed');
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(run.status ?? 1);
}

const manifestPath = path.join(outDir, 'pairofcleats.sublime-package.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const shippedPaths = new Set(
  Array.isArray(manifest.entries) ? manifest.entries.map((entry) => entry.path) : []
);

const requiredShippedPaths = [
  'PairOfCleats/plugin.py',
  'PairOfCleats/README.md',
  'PairOfCleats/Default.sublime-commands',
  'PairOfCleats/Main.sublime-menu',
  'PairOfCleats/PairOfCleats.sublime-settings',
  'PairOfCleats/commands/search.py',
  'PairOfCleats/commands/index.py',
  'PairOfCleats/commands/map.py',
  'PairOfCleats/commands/operator.py',
  'PairOfCleats/commands/runtime.py',
  'PairOfCleats/commands/analysis.py',
  'PairOfCleats/commands/settings.py',
  'PairOfCleats/commands/validate.py',
];
for (const entry of requiredShippedPaths) {
  if (!shippedPaths.has(entry)) {
    console.error(`package-release-sanity test failed: missing shipped entry ${entry}`);
    process.exit(1);
  }
}

const commandPalettePath = path.join(root, 'sublime', 'PairOfCleats', 'Default.sublime-commands');
const menuPath = path.join(root, 'sublime', 'PairOfCleats', 'Main.sublime-menu');
const settingsPath = path.join(root, 'sublime', 'PairOfCleats', 'PairOfCleats.sublime-settings');
const pluginPath = path.join(root, 'sublime', 'PairOfCleats', 'plugin.py');

const commandEntries = JSON.parse(fs.readFileSync(commandPalettePath, 'utf8'));
const menuEntries = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
const settingsText = fs.readFileSync(settingsPath, 'utf8');
const pluginText = fs.readFileSync(pluginPath, 'utf8');

const commandKeys = commandEntries.map((entry) => JSON.stringify({
  command: entry.command,
  args: entry.args || null,
}));
const uniqueCommandKeys = new Set(commandKeys);
if (uniqueCommandKeys.size !== commandKeys.length) {
  console.error('package-release-sanity test failed: duplicate command palette entries');
  process.exit(1);
}
const commandNames = commandEntries.map((entry) => entry.command);
const uniqueCommandNames = new Set(commandNames);

const requiredCommands = [
  'pair_of_cleats_open_settings',
  'pair_of_cleats_open_project_settings',
  'pair_of_cleats_validate_settings',
  'pair_of_cleats_show_config_dump',
  'pair_of_cleats_tooling_doctor',
  'pair_of_cleats_server_health',
  'pair_of_cleats_server_status',
  'pair_of_cleats_index_health',
  'pair_of_cleats_search',
  'pair_of_cleats_architecture_check',
  'pair_of_cleats_impact',
  'pair_of_cleats_suggest_tests',
  'pair_of_cleats_workspace_manifest',
  'pair_of_cleats_workspace_status',
  'pair_of_cleats_workspace_build',
  'pair_of_cleats_workspace_catalog',
  'pair_of_cleats_reopen_last_results',
  'pair_of_cleats_reopen_analysis',
  'pair_of_cleats_show_progress',
  'pair_of_cleats_cancel_active_task',
  'pair_of_cleats_index_build_all',
  'pair_of_cleats_index_validate',
  'pair_of_cleats_map_repo',
  'pair_of_cleats_map_jump_to_node',
  'pair_of_cleats_map_show_last_report',
];
for (const command of requiredCommands) {
  if (!uniqueCommandNames.has(command)) {
    console.error(`package-release-sanity test failed: missing command palette entry ${command}`);
    process.exit(1);
  }
}

const preferenceMenu = Array.isArray(menuEntries)
  ? menuEntries.find((entry) => entry.id === 'preferences')
  : null;
const preferenceCommands = new Set(
  Array.isArray(preferenceMenu?.children)
    ? preferenceMenu.children.map((entry) => entry.command).filter(Boolean)
    : []
);
const requiredPreferenceCommands = [
  'pair_of_cleats_open_settings',
  'pair_of_cleats_open_project_settings',
  'pair_of_cleats_project_settings_template',
  'pair_of_cleats_show_effective_settings',
  'pair_of_cleats_validate_settings',
];
for (const command of requiredPreferenceCommands) {
  if (!preferenceCommands.has(command)) {
    console.error(`package-release-sanity test failed: missing preferences menu command ${command}`);
    process.exit(1);
  }
}

const requiredSettingKeys = [
  'api_server_url',
  'api_timeout_ms',
  'api_execution_mode',
  'open_results_in',
  'results_buffer_threshold',
  'progress_panel_on_start',
  'progress_watchdog_ms',
  'index_watch_scope',
  'index_watch_mode',
  'map_show_report_panel',
  'map_stream_output',
];
for (const key of requiredSettingKeys) {
  const pattern = new RegExp(`"${key}"\\s*:`);
  if (!pattern.test(settingsText)) {
    console.error(`package-release-sanity test failed: missing settings key ${key}`);
    process.exit(1);
  }
}

const requiredPluginImports = [
  'from .commands import analysis as _analysis_commands',
  'from .commands import index as _index_commands',
  'from .commands import map as _map_commands',
  'from .commands import operator as _operator_commands',
  'from .commands import runtime as _runtime_commands',
  'from .commands import search as _search_commands',
  'from .commands import settings as _settings_commands',
  'from .commands import validate as _validate_commands',
];
for (const fragment of requiredPluginImports) {
  if (!pluginText.includes(fragment)) {
    console.error(`package-release-sanity test failed: missing plugin import ${fragment}`);
    process.exit(1);
  }
}

console.log('sublime package release sanity test passed');
