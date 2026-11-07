import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
// Preserve the canonical dump parser, authority and output in one guarded child.
await import('../../config/dump.js');
