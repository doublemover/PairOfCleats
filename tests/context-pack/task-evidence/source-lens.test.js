import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { materializeTaskLens } from '../../../src/context-pack/task-evidence/lens.js';
import { projectPackageManifestFacet } from '../../../src/context-pack/task-evidence/package-facet.js';

const worldRef = { generation: { baseBuildId: 'build', semanticRevision: 0 }, contextKey: 'config' };
const source = createSemanticSourceSnapshot({ bytes: Buffer.from('const retry = "😀";\nretry();'), repositoryNamespace: 'repo', path: 'retry.js', language: 'javascript' });
const candidate = { id: 'definition', worldRef, sourceRef: { sourceUnitId: source.manifest.sourceUnitId, span: [0, 19], coordinateUnit: 'utf16' },
  score: 1, roles: ['implementation', 'contract'], mandatory: true, qualification: { certainty: 'exact-source', closure: 'partial' } };
const args = { worldRef, taskId: 'retry-task', requiredRoles: ['implementation', 'configuration'], candidates: [candidate], sources: [source],
  retainedResult: { ownerHandle: 'admitted-source-result', enumeration: 'partial', continuation: 'owner-cursor' } };
const lens = materializeTaskLens(args);
assert.equal(lens.facets[0].text, source.text.slice(0, 19));
assert.deepEqual(lens.missingRoles, ['configuration']);
assert.equal(lens.completeness, 'not-implied');
assert.equal(lens.renderedBytes, Buffer.byteLength(JSON.stringify(lens) + '\n'));
assert.equal(lens.facets[0].expandToSource.ownerHandle, 'admitted-source-result');
const overflow = materializeTaskLens({ ...args, maxFacets: 1, candidates: [candidate, { ...candidate, id: 'second', roles: ['configuration'] }] });
assert.equal(overflow.status, 'mandatoryOverflow');
assert.equal(overflow.facets.length, 0);
assert.equal(overflow.omittedCandidates, 2);
assert.throws(() => materializeTaskLens({ ...args, candidates: [{ ...candidate, worldRef: { ...worldRef, contextKey: 'other' } }] }), /Incompatible/);
const emoji = source.text.indexOf('😀');
assert.throws(() => materializeTaskLens({ ...args, candidates: [{ ...candidate,
  sourceRef: { ...candidate.sourceRef, span: [emoji + 1, emoji + 2] } }] }), /UTF-16/);
const packageSource = createSemanticSourceSnapshot({ bytes: Buffer.from('{"scripts":{"test":"do-not-execute"},"dependencies":{"pkg":"^1.0"}}'),
  repositoryNamespace: 'repo', path: 'package.json', language: 'json' });
const architecture = projectPackageManifestFacet({ snapshot: packageSource, worldRef });
assert.equal(architecture.declarations[0].kind, 'declared-script');
assert.equal(architecture.qualification.execution, 'not-observed');
assert.equal(architecture.qualification.resolvedDependencyVersion, 'not-established');
const forgedId = { ...source, manifest: { ...source.manifest, sourceUnitId: 'su1:' + '0'.repeat(64) } };
assert.throws(() => materializeTaskLens({ ...args, sources: [forgedId] }), /manifest/);
const forgedPath = { ...packageSource, manifest: { ...packageSource.manifest, path: 'other/package.json' } };
assert.throws(() => projectPackageManifestFacet({ snapshot: forgedPath, worldRef }), /manifest/);
const forgedLines = { ...source, manifest: { ...source.manifest, lineStarts: [0, 1] } };
assert.throws(() => materializeTaskLens({ ...args, sources: [forgedLines] }), /manifest/);
let invoked = false;
const accessorManifest = { ...source.manifest };
Object.defineProperty(accessorManifest, 'path', { enumerable: true, get() { invoked = true; return 'retry.js'; } });
assert.throws(() => materializeTaskLens({ ...args, sources: [{ ...source, manifest: accessorManifest }] }), /getter/i);
assert.equal(invoked, false, 'source admission never evaluates a metadata getter');
const accessorSnapshot = Object.defineProperty({ manifest: source.manifest }, 'sourceCapability', {
  get() { invoked = true; return source.sourceCapability; }
});
assert.throws(() => materializeTaskLens({ ...args, sources: [accessorSnapshot] }), /data fields/);
assert.equal(invoked, false, 'opaque source ownership cannot be obtained through an accessor');
const accessorCandidate = { ...candidate };
Object.defineProperty(accessorCandidate, 'roles', { enumerable: true, get() { invoked = true; return ['implementation']; } });
assert.throws(() => materializeTaskLens({ ...args, candidates: [accessorCandidate] }), /getter/i);
assert.equal(invoked, false, 'source role metadata is admitted without invoking accessors');
const accessorSources = [];
Object.defineProperty(accessorSources, '0', { enumerable: true, get() { invoked = true; return source; } });
assert.throws(() => materializeTaskLens({ ...args, sources: accessorSources }), /data fields/);
assert.equal(invoked, false, 'source array entries cannot invoke caller code during admission');
assert.throws(() => materializeTaskLens({ ...args, retainedResult: { ...args.retainedResult,
  padding: 'x'.repeat(4 * 1024 * 1024) } }), /metadata allowance/);
console.log('exact-source task lens contract passed');
