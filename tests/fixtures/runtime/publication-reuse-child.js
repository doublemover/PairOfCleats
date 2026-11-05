import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const fs = await import('node:fs/promises');
const { observeRuntimePublicationWork } = await import('../../helpers/runtime-publication-work.js');
const { kind, options } = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
if (!['import', 'claims'].includes(kind)) throw new TypeError('Explicit fixture publication kind required.');
const publish = kind === 'import'
  ? (await import('../../../src/index/semantic/runtime/import.js')).importRuntimeEvidence
  : (await import('../../../src/index/semantic/runtime/claims.js')).persistRuntimeDerivedClaims;
const metrics = {};
const result = await observeRuntimePublicationWork(options.destination, () => publish({ ...options, publicationMetrics: metrics }));
console.log(JSON.stringify({ pid: process.pid, metrics, ...result }));
