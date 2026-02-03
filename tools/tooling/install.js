#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildToolingReport, detectTool, normalizeLanguageList, resolveToolsById, resolveToolsForLanguages, selectInstallPlan } from './utils.js';
import { getToolingConfig, resolveRepoRootArg } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'tooling-install',
  options: {
    json: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'no-fallback': { type: 'boolean', default: false },
    root: { type: 'string' },
    repo: { type: 'string' },
    scope: { type: 'string' },
    languages: { type: 'string' },
    tools: { type: 'string' }
  }
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = resolveRepoRootArg(explicitRoot);
const toolingConfig = getToolingConfig(root);
const scope = argv.scope || toolingConfig.installScope || 'cache';
const allowFallback = argv['no-fallback'] ? false : toolingConfig.allowGlobalFallback !== false;
const languageOverride = normalizeLanguageList(argv.languages);
const toolOverride = normalizeLanguageList(argv.tools);

const report = toolOverride.length
  ? { languages: {}, formats: {} }
  : await buildToolingReport(root, languageOverride, { skipScan: languageOverride.length > 0 });
const languageList = languageOverride.length ? languageOverride : Object.keys(report.languages || {});
const tools = toolOverride.length
  ? resolveToolsById(toolOverride, toolingConfig.dir, root, toolingConfig)
  : resolveToolsForLanguages(languageList, toolingConfig.dir, root, toolingConfig);

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
    console.error('[tooling-install] Dry run. Planned actions:');
    for (const action of actions) {
      console.error(`- ${action.id}: ${action.cmd} ${action.args.join(' ')}`);
    }
  }
  process.exit(0);
}

for (const action of actions) {
  console.error(`[tooling-install] Installing ${action.id} (${action.scope})...`);
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
    console.error('[tooling-install] Some installs failed.');
  } else {
    console.error('[tooling-install] Completed.');
  }
}
