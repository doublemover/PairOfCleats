import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Optional manual receipt for original-owner controls; no production knob. */
export const createOwnershipObservation = (snapshot) => {
  const index = process.argv.indexOf('--observation');
  const destination = index < 0 ? null : process.argv[index + 1];
  if (destination !== null) assert.ok(destination && path.isAbsolute(destination));
  const started = performance.now(), events = [];
  const mark = (phase, details = {}) => {
    assert.ok(events.length < 512);
    events.push({ phase, atMs: performance.now() - started, ...snapshot(), ...details });
  };
  return { mark, async publish(details) {
    if (!destination) return;
    await fs.writeFile(destination, JSON.stringify({ schemaVersion: 1, status: 'passed',
      historicalAuthorWorkspace: true, pid: process.pid, node: process.version, events, ...details,
      peakTrackedDescriptors: Math.max(0, ...events.map(event => event.liveTrackedDescriptors ?? 0)) }, null, 2) + '\n', { flag: 'wx' });
  } };
};
