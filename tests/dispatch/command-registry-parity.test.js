#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  DEFAULT_HELP_SUPPORT_TIERS,
  listCommandRegistry,
  listHelpSections
} from '../../src/shared/command-registry.js';
import { listDispatchManifest } from '../../src/shared/dispatch/manifest.js';
import { getRuntimeCapabilityManifest } from '../../src/shared/runtime-capability-manifest.js';

const registry = listCommandRegistry();
const registryById = new Map(registry.map((entry) => [entry.id, entry]));
const dispatchManifest = listDispatchManifest();
const cliManifest = getRuntimeCapabilityManifest().surfaces?.cli?.commands || [];
const helpSections = listHelpSections();
const allHelpSections = listHelpSections({ supportTiers: ['stable', 'operator', 'internal', 'experimental'] });

assert.ok(registry.length > 0, 'command registry must not be empty');
assert.ok(helpSections.length > 0, 'help sections must not be empty');

for (const entry of dispatchManifest) {
  const registryEntry = registryById.get(entry.id);
  assert.ok(registryEntry, `dispatch entry ${entry.id} must exist in command registry`);
  assert.deepEqual(entry.commandPath, registryEntry.commandPath, `dispatch path mismatch for ${entry.id}`);
  assert.equal(entry.script, registryEntry.script, `dispatch script mismatch for ${entry.id}`);
  assert.equal(entry.description, registryEntry.description, `dispatch description mismatch for ${entry.id}`);
}

for (const entry of cliManifest) {
  const registryEntry = registryById.get(entry.id);
  assert.ok(registryEntry, `capability entry ${entry.id} must exist in command registry`);
  assert.notEqual(registryEntry.capability, false, `capability entry ${entry.id} must be enabled in command registry`);
  assert.deepEqual(entry.commandPath, registryEntry.commandPath, `capability path mismatch for ${entry.id}`);
  assert.equal(entry.script, registryEntry.script, `capability script mismatch for ${entry.id}`);
  assert.equal(entry.description, registryEntry.description, `capability description mismatch for ${entry.id}`);
  assert.equal(entry.supportTier, registryEntry.supportTier, `capability support tier mismatch for ${entry.id}`);
}

const helpIds = new Set(helpSections.flatMap((section) => section.commands.map((entry) => entry.id)));
const allHelpIds = new Set(allHelpSections.flatMap((section) => section.commands.map((entry) => entry.id)));
for (const entry of registry) {
  assert.ok(allHelpIds.has(entry.id), `full help output must include ${entry.id}`);
  if (DEFAULT_HELP_SUPPORT_TIERS.includes(entry.supportTier)) {
    assert.ok(helpIds.has(entry.id), `default help output must include ${entry.id}`);
  } else {
    assert.ok(!helpIds.has(entry.id), `default help output must hide ${entry.id}`);
  }
}

assert.ok(!cliManifest.some((entry) => entry.id === 'config.dump'), 'runtime capability CLI manifest should not advertise unsupported config.dump');
assert.ok(!cliManifest.some((entry) => entry.id === 'report.diagnostics'), 'runtime capability CLI manifest should not advertise unsupported report.diagnostics');

console.log('command registry parity test passed');
