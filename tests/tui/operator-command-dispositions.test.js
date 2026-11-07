import assert from 'node:assert/strict';
import { listCommandRegistry } from '../../src/shared/command-registry-query.js';
import { describeIndexWorkflows } from '../../tools/tui/operator/index-catalog.js';

// No terminal, native host, scope selection, fixture mutation or child launch is
// needed to catch missing dispositions before the native workflow jobs start.
for (const includeExperimental of [false, true]) for (const backendDelegationEnabled of [false, true]) {
  const supportTiers = ['stable', 'operator', ...(includeExperimental ? ['experimental'] : [])];
  const registry = listCommandRegistry({ supportTiers });
  const commands = describeIndexWorkflows({ includeExperimental, backendDelegationEnabled });
  assert.equal(new Set(commands.map(command => command.id)).size, commands.length, 'native command identities remain unique');
  assert.deepEqual([...new Set(commands.map(command => command.registryId))].sort(), registry.map(entry => entry.id).sort(),
    'every selected registered command needs an explicit supported form or concrete unsupported reason');
  for (const entry of registry) {
    const forms = commands.filter(command => command.registryId === entry.id);
    assert.ok(forms.length > 0);
    for (const form of forms) {
      assert.equal(form.supportTier, entry.supportTier); assert.ok(Array.isArray(form.fields));
      assert.deepEqual(form.commandPath.slice(0, entry.commandPath.length), entry.commandPath);
      if (form.unsupportedReason !== undefined) assert.ok(typeof form.unsupportedReason === 'string' && form.unsupportedReason.length > 30);
      else assert.equal(form.schema.type, 'object', 'supported forms need their canonical field schema');
    }
  }
  for (const id of ['index.build', 'index.watch', 'index.report', 'index.stats', 'index.validate', 'workspace.build']) {
    assert.equal(commands.find(command => command.id === id).unsupportedReason, undefined, 'core workflows remain available');
  }
  if (includeExperimental) for (const [id, reason] of [['repository-answer', /exact retained-query request/], ['repository-query', /source-pinned typed request picker/]]) {
    const command = commands.find(command => command.registryId === id); assert.ok(command);
    assert.match(command.unsupportedReason, reason); assert.deepEqual(command.fields, []);
  }
}
console.log('Every public command has a concrete native disposition before terminal or workflow execution.');
