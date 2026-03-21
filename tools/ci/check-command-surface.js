#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../../src/shared/cli.js';
import {
  describePackageScriptReplacementCommand,
  getPackageScriptReplacement,
  listPackageScriptReplacements
} from '../../src/shared/command-aliases.js';
import { listHelpSections, listCommandRegistry } from '../../src/shared/command-registry.js';
import { getRuntimeCapabilityManifest } from '../../src/shared/runtime-capability-manifest.js';
import { resolveToolRoot } from '../shared/dict-utils.js';

const ROOT = resolveToolRoot();

const parseArgs = () => createCli({
  scriptName: 'pairofcleats command-surface-audit',
  options: {
    root: { type: 'string', default: ROOT },
    json: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const normalizeText = (value) => String(value || '').replace(/\r\n/g, '\n');

const fail = (message, state) => {
  if (state.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  process.exit(1);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const parseNodeScriptInvocation = (command) => {
  const parts = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== 'node' || parts.length < 2 || !parts[1].endsWith('.js')) return null;
  return {
    script: parts[1],
    args: parts.slice(2)
  };
};

const arrayEquals = (left, right) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
);

const startsWithArray = (values, prefix) => (
  Array.isArray(values)
  && Array.isArray(prefix)
  && prefix.length <= values.length
  && prefix.every((value, index) => values[index] === value)
);

const buildInventoryCliEntries = () => listCommandRegistry()
  .map((entry) => ({
    command: `pairofcleats ${entry.commandPath.join(' ')}`,
    summary: String(entry.description || '').trim() || 'No summary available.',
    supportTier: entry.supportTier
  }))
  .sort((left, right) => left.command.localeCompare(right.command));

const collectHelpLines = () => listHelpSections().flatMap((section) => (
  section.commands.map((entry) => ({
    group: section.group,
    command: entry.commandPath.join(' '),
    description: entry.description
  }))
));

const getCliHelpText = (root) => {
  const result = spawnSync(process.execPath, [path.join(root, 'bin', 'pairofcleats.js'), '--help'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`top-level CLI help failed: ${result.stderr || result.stdout}`);
  }
  return normalizeText(result.stderr || result.stdout);
};

const getConfigDumpCapabilityManifest = (root) => {
  const result = spawnSync(process.execPath, [path.join(root, 'tools', 'config', 'dump.js'), '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`config dump failed during command-surface audit: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout || '{}')?.derived?.capabilityManifest || null;
};

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || ROOT);
  const state = { json: argv.json === true };
  const packageJson = readJson(path.join(root, 'package.json'));
  const inventory = readJson(path.join(root, 'docs', 'tooling', 'script-inventory.json'));
  const commandsMarkdown = normalizeText(fs.readFileSync(path.join(root, 'docs', 'guides', 'commands.md'), 'utf8'));
  const scripts = packageJson?.scripts || {};
  const inventoryScripts = Array.isArray(inventory?.scripts) ? inventory.scripts : [];
  const cliCommands = Array.isArray(inventory?.cliCommands) ? inventory.cliCommands : [];
  const registry = listCommandRegistry();
  const capabilityManifest = getRuntimeCapabilityManifest();
  const configDumpManifest = getConfigDumpCapabilityManifest(root);
  const registryByScript = new Map();

  for (const entry of registry) {
    const list = registryByScript.get(entry.script) || [];
    list.push(entry);
    registryByScript.set(entry.script, list);
  }

  const packageScriptNames = Object.keys(scripts).sort();
  const inventoryScriptNames = inventoryScripts.map((entry) => entry.name);
  if (!arrayEquals(packageScriptNames, inventoryScriptNames)) {
    fail(
      `command surface audit failed: package.json scripts and script inventory drift `
      + `(package=${packageScriptNames.length}, inventory=${inventoryScriptNames.length})`,
      state
    );
  }

  for (const entry of inventoryScripts) {
    const expectedReplacement = getPackageScriptReplacement(entry.name);
    if ((entry.replacement || null) !== expectedReplacement) {
      fail(
        `command surface audit failed: inventory replacement mismatch for ${entry.name} `
        + `(expected ${expectedReplacement || 'null'}, found ${entry.replacement || 'null'})`,
        state
      );
    }
  }

  for (const replacementEntry of listPackageScriptReplacements()) {
    if (!(replacementEntry.name in scripts)) {
      fail(
        `command surface audit failed: replacement entry references missing package script ${replacementEntry.name}`,
        state
      );
    }
    const resolved = describePackageScriptReplacementCommand(replacementEntry.replacement);
    if (!resolved) {
      fail(
        `command surface audit failed: replacement target is not a supported pairofcleats command `
        + `for ${replacementEntry.name}: ${replacementEntry.replacement}`,
        state
      );
    }
  }

  for (const [name, command] of Object.entries(scripts)) {
    const parsed = parseNodeScriptInvocation(command);
    if (!parsed) continue;
    const candidates = (registryByScript.get(parsed.script) || [])
      .filter((entry) => startsWithArray(parsed.args, entry.extraArgs))
      .sort((left, right) => right.extraArgs.length - left.extraArgs.length);
    if (!candidates.length) continue;
    const replacement = getPackageScriptReplacement(name);
    if (!replacement) {
      fail(
        `command surface audit failed: registry-backed package script ${name} is missing a canonical replacement`,
        state
      );
    }
    const resolved = describePackageScriptReplacementCommand(replacement);
    if (!resolved) {
      fail(
        `command surface audit failed: package script ${name} replacement is not resolvable: ${replacement}`,
        state
      );
    }
    if (resolved.entry.script !== candidates[0].script) {
      fail(
        `command surface audit failed: package script ${name} replacement points to ${resolved.entry.script} `
        + `but script invokes ${candidates[0].script}`,
        state
      );
    }
  }

  const expectedCliCommands = buildInventoryCliEntries();
  if (!arrayEquals(
    expectedCliCommands.map((entry) => JSON.stringify(entry)),
    cliCommands.map((entry) => JSON.stringify(entry))
  )) {
    fail('command surface audit failed: docs/tooling/script-inventory.json CLI commands drifted from registry', state);
  }

  for (const entry of expectedCliCommands) {
    const line = `- [${entry.supportTier}] \`${entry.command}\` - ${entry.summary}`;
    if (!commandsMarkdown.includes(line)) {
      fail(`command surface audit failed: commands.md missing CLI entry line for ${entry.command}`, state);
    }
  }

  const helpText = getCliHelpText(root);
  for (const group of new Set(collectHelpLines().map((entry) => entry.group))) {
    if (!helpText.includes(`${group}:`)) {
      fail(`command surface audit failed: top-level CLI help missing section ${group}`, state);
    }
  }
  for (const entry of collectHelpLines()) {
    if (!helpText.includes(entry.command) || !helpText.includes(entry.description)) {
      fail(
        `command surface audit failed: top-level CLI help missing rendered command ${entry.command}`,
        state
      );
    }
  }

  const expectedCapabilityIds = listCommandRegistry({ capabilityOnly: true }).map((entry) => entry.id);
  const capabilityIds = (capabilityManifest?.surfaces?.cli?.commands || []).map((entry) => entry.id).sort();
  const configDumpCapabilityIds = (configDumpManifest?.surfaces?.cli?.commands || []).map((entry) => entry.id).sort();
  if (!arrayEquals(expectedCapabilityIds.slice().sort(), capabilityIds)) {
    fail('command surface audit failed: runtime capability manifest CLI commands drifted from registry', state);
  }
  if (!arrayEquals(capabilityIds, configDumpCapabilityIds)) {
    fail('command surface audit failed: config dump capability manifest CLI commands drifted from runtime manifest', state);
  }

  const payload = {
    ok: true,
    scripts: packageScriptNames.length,
    replacements: listPackageScriptReplacements().length,
    cliCommands: expectedCliCommands.length,
    capabilityCommands: capabilityIds.length
  };
  if (state.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.log(
    `command surface audit passed `
    + `(scripts=${payload.scripts}, replacements=${payload.replacements}, `
    + `cli=${payload.cliCommands}, capability=${payload.capabilityCommands})`
  );
};

await main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
