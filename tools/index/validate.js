#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { INDEX_VALIDATE_OPTIONS, assertIndexValidationFlags } from '../../src/shared/index-tool-options.js';
import { createCli } from '../../src/shared/cli.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/artifact-io/chunk-meta-presence.js';
import { getIndexDir, resolveRepoConfig } from '../shared/dict-utils.js';
import { captureSelectedModeRoots } from '../../src/shared/indexing/selected-mode-roots.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';

/**
 * Coarse index-mode readiness check used for default mode selection.
 *
 * @param {string|null|undefined} dir
 * @returns {boolean}
 */
const hasIndexMeta = (dir) => {
  if (!dir) return false;
  const manifest = path.join(dir, 'pieces', 'manifest.json');
  if (fs.existsSync(manifest)) return true;
  return hasChunkMetaArtifactsSync(dir);
};

/**
 * Resolve modes that appear present on disk.
 *
 * @param {string} root
 * @param {object} userConfig
 * @returns {string[]}
 */
const resolveAvailableModes = (root, userConfig, indexRoot = null) => {
  const selection = captureSelectedModeRoots({ root, userConfig, indexRoot });
  if (selection.modes.length) return selection.modes;
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  return modes.filter((mode) => hasIndexMeta(getIndexDir(root, mode, userConfig, indexRoot ? { indexRoot } : {})));
};

/**
 * Parse and validate `--mode` input.
 *
 * @param {string|null|undefined} raw
 * @param {string} root
 * @param {object} userConfig
 * @returns {string[]}
 */
export const parseModes = (raw, root, userConfig, indexRoot = null) => {
  const tokens = String(raw || '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    const available = resolveAvailableModes(root, userConfig, indexRoot);
    return available.length ? available : ['code', 'prose', 'extracted-prose', 'records'];
  }
  const allowed = new Set(['code', 'prose', 'extracted-prose', 'records', 'all']);
  const normalized = tokens.map((token) => token.toLowerCase());
  const unknown = normalized.filter((token) => !allowed.has(token));
  if (unknown.length) {
    throw new Error(`Unknown mode(s): ${unknown.join(', ')}. Use code|prose|extracted-prose|records|all.`);
  }
  const modeSet = new Set(normalized);
  if (modeSet.has('all')) return ['code', 'prose', 'extracted-prose', 'records'];
  return Array.from(modeSet);
};

async function runCli() {
  const argv = createCli({
    scriptName: 'index-validate',
    options: INDEX_VALIDATE_OPTIONS
  }).strictOptions().parse();

  const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
  const indexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
  const modes = parseModes(argv.mode, root, userConfig, indexRoot);
  assertIndexValidationFlags(argv);
  const strict = argv['non-strict'] ? false : argv.strict !== false;
  const report = await validateIndexArtifacts({ root, userConfig, indexRoot, modes, strict });

  report.selection = { source: indexRoot ? 'explicit-index-root' : 'published-mode-roots', indexRoot, modes };
  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  console.error('Index validation');
  console.error(`- strict: ${report.strict ? 'yes' : 'no'}`);
  console.error(`- repo: ${report.root}`);
  for (const mode of modes) {
    const entry = report.modes[mode];
    if (!entry) {
      console.error(`- ${mode}: missing (no report entry)`);
      continue;
    }
    const status = entry.state === 'unverified' ? 'unverified' : entry.ok ? 'ok' : entry.state || 'invalid';
    console.error(`- ${mode}: ${status} (${entry.path})`);
    if (entry.missing.length) {
      console.error(`  - missing: ${entry.missing.join(', ')}`);
    }
    if (entry.invalid?.length) console.error(`  - invalid: ${entry.invalid.join(', ')}`);
    if (entry.warnings.length) {
      console.error(`  - optional: ${entry.warnings.join(', ')}`);
    }
  }
  if (report.sqlite.enabled) {
    const status = report.sqlite.ok ? 'ok' : 'issues';
    console.error(`- sqlite: ${status} (mode=${report.sqlite.mode})`);
    if (report.sqlite.issues.length) {
      report.sqlite.issues.forEach((issue) => console.error(`  - ${issue}`));
    }
  }
  if (report.lmdb?.enabled) {
    const status = report.lmdb.ok ? 'ok' : 'issues';
    console.error(`- lmdb: ${status}`);
    if (report.lmdb.issues.length) {
      report.lmdb.issues.forEach((issue) => console.error(`  - ${issue}`));
    }
    if (report.lmdb.warnings.length) {
      report.lmdb.warnings.forEach((warning) => console.error(`  - warning: ${warning}`));
    }
  }

  if (report.warnings.length && report.ok) {
    console.error('Warnings:');
    report.warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  if (!report.ok) {
    console.error('Issues:');
    report.issues.forEach((issue) => console.error(`- ${issue}`));
  }
  if (report.hints?.length) {
    console.error('Hints:');
    report.hints.forEach((hint) => console.error(`- ${hint}`));
  }
  process.exit(report.ok ? 0 : 1);
}

if (isDirectExecution(import.meta.url)) {
  runCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
