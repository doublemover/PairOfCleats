#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

const ROOT = resolveToolRoot();
const REGISTRY_PATH = path.join(ROOT, 'docs', 'tooling', 'generated-surfaces.json');

const parseArgs = () => createCli({
  scriptName: 'pairofcleats generated-surfaces',
  options: {
    root: { type: 'string' },
    check: { type: 'boolean', default: false },
    'check-freshness': { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    surface: { type: 'string' }
  }
})
  .strictOptions()
  .parse();

const normalizeSurfaces = (registry, root, surfaceId = '') => {
  const surfaces = Array.isArray(registry?.surfaces) ? registry.surfaces : [];
  const filtered = surfaceId
    ? surfaces.filter((surface) => surface?.id === surfaceId)
    : surfaces;
  return filtered.map((surface) => ({
    ...surface,
    outputs: Array.isArray(surface.outputs) ? surface.outputs : [],
    resolvedOutputs: (Array.isArray(surface.outputs) ? surface.outputs : []).map((entry) => path.resolve(root, entry))
  }));
};

const extractScriptPath = (command) => {
  const match = String(command || '').match(/^node\s+([^\s]+\.js)\b/);
  return match ? match[1] : null;
};

const sanitizeRelativePath = (value) => String(value || '').replace(/[\\/]/g, '__');

const normalizeJsonValue = (value, omitKeys = []) => {
  const omit = new Set(Array.isArray(omitKeys) ? omitKeys : []);
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry, omitKeys));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      if (omit.has(key)) return acc;
      acc[key] = normalizeJsonValue(value[key], omitKeys);
      return acc;
    }, {});
};

const normalizeOutput = (contents, outputConfig = {}) => {
  const format = String(outputConfig?.format || 'text').toLowerCase();
  if (format === 'json') {
    const parsed = JSON.parse(contents);
    return `${JSON.stringify(normalizeJsonValue(parsed, outputConfig.omitKeys), null, 2)}\n`;
  }
  return String(contents || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s*$/, '\n');
};

const firstDiffLine = (expected, actual) => {
  const expectedLines = String(expected || '').split('\n');
  const actualLines = String(actual || '').split('\n');
  const maxLines = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    if ((expectedLines[index] || '') !== (actualLines[index] || '')) {
      return index + 1;
    }
  }
  return 1;
};

const runShellCommand = (command, cwd) => spawnSync(command, {
  cwd,
  shell: true,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const renderCommandFailure = (result) => {
  const stdout = String(result?.stdout || '').trim();
  const stderr = String(result?.stderr || '').trim();
  return [stdout, stderr].filter(Boolean).join(' | ');
};

const runRefresh = (surface, root) => {
  const result = runShellCommand(surface.refresh.command, root);
  if (result.status !== 0) {
    const details = renderCommandFailure(result);
    throw new Error(
      `refresh failed for ${surface.id}: ${surface.refresh.command}`
      + (details ? ` (${details})` : '')
    );
  }
};

const buildFreshnessState = (surface) => {
  const freshness = surface.freshness || {};
  const mode = String(freshness.mode || '').trim();
  if (!mode) {
    throw new Error(`generated surfaces check failed: ${surface.id} is missing freshness.mode`);
  }
  return { mode, freshness };
};

const replaceOutputPlaceholders = (command, tempOutputs) => String(command || '').replace(
  /\{output:(\d+)\}/g,
  (match, rawIndex) => {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= tempOutputs.length) {
      throw new Error(`generated surfaces check failed: invalid output placeholder ${match}`);
    }
    return `"${tempOutputs[index]}"`;
  }
);

const checkGeneratedCompareFreshness = (surface, root, freshness) => {
  const outputConfigs = Array.isArray(freshness.outputs) ? freshness.outputs : [];
  if (outputConfigs.length !== surface.outputs.length) {
    throw new Error(
      `generated surfaces check failed: ${surface.id} freshness.outputs must align `
      + `with declared outputs`
    );
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pairofcleats-generated-${surface.id}-`));
  try {
    const tempOutputs = surface.outputs.map((output, index) => {
      const filename = `${String(index).padStart(2, '0')}-${sanitizeRelativePath(output)}`;
      const tempOutput = path.join(tempDir, filename);
      fs.mkdirSync(path.dirname(tempOutput), { recursive: true });
      return tempOutput;
    });
    const command = replaceOutputPlaceholders(freshness.command, tempOutputs);
    const result = runShellCommand(command, root);
    if (result.status !== 0) {
      return {
        ok: false,
        reason: 'generator-failed',
        surfaceId: surface.id,
        command,
        details: renderCommandFailure(result)
      };
    }
    for (const [index, output] of surface.outputs.entries()) {
      const committedPath = path.resolve(root, output);
      const generatedPath = tempOutputs[index];
      if (!fs.existsSync(generatedPath)) {
        return {
          ok: false,
          reason: 'generated-output-missing',
          surfaceId: surface.id,
          output,
          command
        };
      }
      if (!fs.existsSync(committedPath)) {
        return {
          ok: false,
          reason: 'committed-output-missing',
          surfaceId: surface.id,
          output,
          command
        };
      }
      const expected = normalizeOutput(fs.readFileSync(committedPath, 'utf8'), outputConfigs[index]);
      const actual = normalizeOutput(fs.readFileSync(generatedPath, 'utf8'), outputConfigs[index]);
      if (expected !== actual) {
        return {
          ok: false,
          reason: 'output-drift',
          surfaceId: surface.id,
          output,
          command,
          line: firstDiffLine(expected, actual)
        };
      }
    }
    return { ok: true, surfaceId: surface.id };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const checkAuditCommandFreshness = (surface, root, freshness) => {
  const command = String(freshness.command || '').trim();
  if (!command) {
    throw new Error(`generated surfaces check failed: ${surface.id} is missing freshness.command`);
  }
  const result = runShellCommand(command, root);
  if (result.status !== 0) {
    return {
      ok: false,
      reason: 'audit-failed',
      surfaceId: surface.id,
      command,
      details: renderCommandFailure(result)
    };
  }
  return { ok: true, surfaceId: surface.id };
};

const formatFreshnessFailure = (failure, surfaces) => {
  const surface = surfaces.find((entry) => entry.id === failure.surfaceId);
  const refreshHint = surface?.refresh?.command ? ` | refresh: ${surface.refresh.command}` : '';
  if (failure.reason === 'output-drift') {
    return `${failure.surfaceId}: stale output ${failure.output} (first differing line ${failure.line})${refreshHint}`;
  }
  if (failure.reason === 'generator-failed') {
    return `${failure.surfaceId}: generator failed (${failure.command})${failure.details ? ` | ${failure.details}` : ''}${refreshHint}`;
  }
  if (failure.reason === 'audit-failed') {
    return `${failure.surfaceId}: audit failed (${failure.command})${failure.details ? ` | ${failure.details}` : ''}${refreshHint}`;
  }
  if (failure.reason === 'generated-output-missing') {
    return `${failure.surfaceId}: generator did not produce expected output ${failure.output}${refreshHint}`;
  }
  if (failure.reason === 'committed-output-missing') {
    return `${failure.surfaceId}: committed output missing ${failure.output}${refreshHint}`;
  }
  return `${failure.surfaceId}: freshness check failed${refreshHint}`;
};

const checkSurfaceFreshness = (surface, root) => {
  const { mode, freshness } = buildFreshnessState(surface);
  if (mode === 'generated-compare') {
    return checkGeneratedCompareFreshness(surface, root, freshness);
  }
  if (mode === 'audit-command') {
    return checkAuditCommandFreshness(surface, root, freshness);
  }
  throw new Error(`generated surfaces check failed: unsupported freshness.mode for ${surface.id}: ${mode}`);
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || ROOT);
  const registryPath = path.resolve(root, path.relative(ROOT, REGISTRY_PATH));
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const surfaces = normalizeSurfaces(registry, root, argv.surface);

  if (argv.surface && surfaces.length === 0) {
    console.error(`Unknown generated surface id: ${argv.surface}`);
    process.exit(1);
  }

  if (argv.check) {
    const seenIds = new Set();
    const seenOutputs = new Set();
    for (const surface of surfaces) {
      if (!surface?.id || typeof surface.id !== 'string') {
        console.error('generated surfaces check failed: every surface must have a string id');
        process.exit(1);
      }
      if (seenIds.has(surface.id)) {
        console.error(`generated surfaces check failed: duplicate id ${surface.id}`);
        process.exit(1);
      }
      seenIds.add(surface.id);
      if (!surface.owner || !surface.validationMode || !surface.freshnessExpectation) {
        console.error(`generated surfaces check failed: ${surface.id} is missing required ownership/validation metadata`);
        process.exit(1);
      }
      if (!surface.refresh?.command) {
        console.error(`generated surfaces check failed: ${surface.id} is missing a refresh command`);
        process.exit(1);
      }
      if (!surface.freshness?.mode) {
        console.error(`generated surfaces check failed: ${surface.id} is missing freshness metadata`);
        process.exit(1);
      }
      const refreshScript = extractScriptPath(surface.refresh.command);
      if (refreshScript && !fs.existsSync(path.resolve(root, refreshScript))) {
        console.error(`generated surfaces check failed: ${surface.id} refresh script missing: ${refreshScript}`);
        process.exit(1);
      }
      const freshnessScript = extractScriptPath(surface.freshness?.command);
      if (freshnessScript && !fs.existsSync(path.resolve(root, freshnessScript))) {
        console.error(`generated surfaces check failed: ${surface.id} freshness script missing: ${freshnessScript}`);
        process.exit(1);
      }
      const auditScript = extractScriptPath(surface.audit?.command);
      if (auditScript && !fs.existsSync(path.resolve(root, auditScript))) {
        console.error(`generated surfaces check failed: ${surface.id} audit script missing: ${auditScript}`);
        process.exit(1);
      }
      if (surface.freshness.mode === 'generated-compare') {
        const outputConfigs = Array.isArray(surface.freshness?.outputs) ? surface.freshness.outputs : [];
        if (outputConfigs.length !== surface.outputs.length) {
          console.error(
            `generated surfaces check failed: ${surface.id} freshness.outputs must align with declared outputs`
          );
          process.exit(1);
        }
      }
      for (const [index, output] of surface.outputs.entries()) {
        if (!output || typeof output !== 'string') {
          console.error(`generated surfaces check failed: ${surface.id} has an invalid output at index ${index}`);
          process.exit(1);
        }
        if (seenOutputs.has(output)) {
          console.error(`generated surfaces check failed: duplicate output path ${output}`);
          process.exit(1);
        }
        seenOutputs.add(output);
        if (surface.committed && !fs.existsSync(path.resolve(root, output))) {
          console.error(`generated surfaces check failed: committed output missing for ${surface.id}: ${output}`);
          process.exit(1);
        }
      }
    }
    console.log('generated surfaces registry check passed');
    return;
  }

  if (argv.refresh) {
    for (const surface of surfaces) {
      runRefresh(surface, root);
      console.log(`refreshed ${surface.id}`);
    }
    return;
  }

  if (argv['check-freshness']) {
    const failures = surfaces
      .map((surface) => checkSurfaceFreshness(surface, root))
      .filter((result) => !result.ok);
    if (failures.length) {
      console.error('generated surfaces freshness check failed:');
      for (const failure of failures) {
        console.error(`- ${formatFreshnessFailure(failure, surfaces)}`);
      }
      process.exit(1);
    }
    console.log('generated surfaces freshness check passed');
    return;
  }

  if (argv.json) {
    console.log(JSON.stringify({
      schemaVersion: registry.schemaVersion,
      root,
      surfaces: surfaces.map(({ resolvedOutputs, ...surface }) => surface)
    }, null, 2));
    return;
  }

  for (const surface of surfaces) {
    console.log(`${surface.id}`);
    console.log(`  owner: ${surface.owner}`);
    console.log(`  committed: ${surface.committed ? 'yes' : 'no'}`);
    console.log(`  validation: ${surface.validationMode}`);
    console.log(`  freshness: ${surface.freshnessExpectation}`);
    console.log(`  refresh: ${surface.refresh.command}`);
    console.log(`  freshness-check: ${surface.freshness?.command || surface.freshness?.mode || 'none'}`);
    console.log(`  audit: ${surface.audit?.command || 'none'}`);
    for (const output of surface.outputs) {
      console.log(`  output: ${output}`);
    }
  }
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
