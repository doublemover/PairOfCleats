import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
const phase = async value => {
  if (typeof process.send !== 'function' || !process.connected) return;
  await new Promise((resolve, reject) => process.send({ type: 'poc.config-preview-phase', phase: value },
    error => error ? reject(error) : resolve()));
};
await phase('entry');
await guardBootstrapEntry(import.meta.url);
await phase('bootstrap-ready');
// Preserve the canonical dump parser, authority and output in one guarded child.
try {
  await phase('dump-loading');
  await import('../../config/dump.js');
  await phase('dump-complete');
} finally {
  if (process.connected) process.disconnect();
}
