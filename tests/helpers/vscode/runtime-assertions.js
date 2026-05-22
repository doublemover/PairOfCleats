import assert from 'node:assert/strict';

export function assertRegisteredCommands(registeredCommands, commandIds) {
  for (const commandId of commandIds) {
    assert.ok(registeredCommands.has(commandId), `missing registered command ${commandId}`);
  }
}

export function assertSpawnArgs(spawnCalls, index, expectedArgs) {
  const call = spawnCalls[index];
  assert.ok(call, `missing spawn call ${index}`);
  assert.deepEqual(call.args, expectedArgs);
}

export function assertNoRuntimeErrors(errorMessages) {
  assert.equal(errorMessages.length, 0, `unexpected errors: ${errorMessages.join('; ')}`);
}
