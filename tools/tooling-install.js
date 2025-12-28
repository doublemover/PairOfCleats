#!/usr/bin/env node
import minimist from 'minimist';
import { spawnSync } from 'node:child_process';
import { buildToolingReport, detectTool, normalizeLanguageList, resolveToolsById, resolveToolsForLanguages, selectInstallPlan } from './tooling-utils.js';
import { getToolingConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'dry-run', 'no-fallback'],
  string: ['root', 'scope', 'languages', 'tools'],
  default: { 'dry-run': false, json: false, 'no-fallback': false }
});

const root = argv.root || process.cwd();
const toolingConfig = getToolingConfig(root);
const scope = argv.scope || toolingConfig.installScope || 'cache';
const allowFallback = argv['no-fallback'] ? false : toolingConfig.allowGlobalFallback !== false;
const languageOverride = normalizeLanguageList(argv.languages);
const toolOverride = normalizeLanguageList(argv.tools);

const report = await buildToolingReport(root, languageOverride);
const languageList = languageOverride.length ? languageOverride : Object.keys(report.languages || {});
const tools = toolOverride.length
  ? resolveToolsById(toolOverride, toolingConfig.dir, root)
  : resolveToolsForLanguages(languageList, toolingConfig.dir, root);

const actions = [];
const results = [];

for (const tool of tools) {
  const status = detectTool(tool);
  if (status.found) {
    results.push({ id: tool.id, status: 'already-installed', path: status.path });
    continue;
  }
  const selection = selectInstallPlan(tool, scope, allowFallback);
  if (!selection.plan) {
    results.push({ id: tool.id, status: 'manual', docs: tool.docs || null });
    continue;
  }
  const { cmd, args, env, requires } = selection.plan;
  if (requires) {
    const requireCheck = spawnSync(requires, ['--version'], { encoding: 'utf8' });
    if (requireCheck.status !== 0) {
      results.push({ id: tool.id, status: 'missing-requirement', requires, docs: tool.docs || null });
      continue;
    }
  }
  actions.push({ id: tool.id, cmd, args, env, scope: selection.scope, fallback: selection.fallback || false, docs: tool.docs || null });
}

if (argv['dry-run']) {
  const payload = { root, scope, allowFallback, actions, results };
  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('[tooling-install] Dry run. Planned actions:');
    for (const action of actions) {
      console.log(`- ${action.id}: ${action.cmd} ${action.args.join(' ')}`);
    }
  }
  process.exit(0);
}

for (const action of actions) {
  console.log(`[tooling-install] Installing ${action.id} (${action.scope})...`);
  const env = action.env ? { ...process.env, ...action.env } : process.env;
  const result = spawnSync(action.cmd, action.args, { stdio: 'inherit', env });
  if (result.status !== 0) {
    results.push({ id: action.id, status: 'failed', exitCode: result.status, docs: action.docs });
    continue;
  }
  results.push({ id: action.id, status: 'installed' });
}

const payload = { root, scope, allowFallback, actions, results };
if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  const failed = results.filter((entry) => entry.status === 'failed');
  if (failed.length) {
    console.log('[tooling-install] Some installs failed.');
  } else {
    console.log('[tooling-install] Completed.');
  }
}
