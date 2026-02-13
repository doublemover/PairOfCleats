#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../../src/shared/stable-json.js';
import { sha1 } from '../../../../src/shared/hash.js';
import {
  validateUsrCanonicalId,
  validateUsrDiagnosticCode,
  validateUsrEdgeEndpoint
} from '../../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const bundlePath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'canonical-examples', 'usr-canonical-example-bundle.json');
const edgeConstraintsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-edge-kind-constraints.json');

const rawBundle = fs.readFileSync(bundlePath, 'utf8');
assert.equal(rawBundle.includes('//'), false, 'canonical example bundle must not include comments');
assert.equal(rawBundle.includes('/*'), false, 'canonical example bundle must not include block comments');

const bundle = JSON.parse(rawBundle);
assert.equal(bundle.schemaVersion, 'usr-1.0.0', 'canonical example bundle schemaVersion must be usr-1.0.0');

const edgeConstraints = JSON.parse(fs.readFileSync(edgeConstraintsPath, 'utf8'));

const documents = Array.isArray(bundle.documents) ? bundle.documents : [];
const segments = Array.isArray(bundle.segments) ? bundle.segments : [];
const nodes = Array.isArray(bundle.nodes) ? bundle.nodes : [];
const symbols = Array.isArray(bundle.symbols) ? bundle.symbols : [];
const edges = Array.isArray(bundle.edges) ? bundle.edges : [];
const flowPaths = Array.isArray(bundle.flowPaths) ? bundle.flowPaths : [];
const routes = Array.isArray(bundle.routes) ? bundle.routes : [];
const styleScopes = Array.isArray(bundle.styleScopes) ? bundle.styleScopes : [];
const diagnostics = Array.isArray(bundle.diagnostics) ? bundle.diagnostics : [];

const docIds = new Set(documents.map((row) => row.docUid));
const segmentIds = new Set(segments.map((row) => row.segmentUid));
const nodeIds = new Set(nodes.map((row) => row.nodeUid));
const symbolIds = new Set(symbols.map((row) => row.symbolUid));
const edgeIds = new Set(edges.map((row) => row.edgeUid));

for (const row of documents) {
  const result = validateUsrCanonicalId('docUid', row.docUid);
  assert.equal(result.ok, true, `invalid docUid in canonical example bundle: ${result.errors.join('; ')}`);
}

for (const row of segments) {
  const segmentUid = validateUsrCanonicalId('segmentUid', row.segmentUid);
  assert.equal(segmentUid.ok, true, `invalid segmentUid in canonical example bundle: ${segmentUid.errors.join('; ')}`);
  assert.equal(docIds.has(row.docUid), true, `segment docUid does not resolve: ${row.segmentUid} -> ${row.docUid}`);
}

for (const row of nodes) {
  const nodeUid = validateUsrCanonicalId('nodeUid', row.nodeUid);
  assert.equal(nodeUid.ok, true, `invalid nodeUid in canonical example bundle: ${nodeUid.errors.join('; ')}`);
  assert.equal(docIds.has(row.docUid), true, `node docUid does not resolve: ${row.nodeUid} -> ${row.docUid}`);
  if (row.segmentUid != null) {
    assert.equal(segmentIds.has(row.segmentUid), true, `node segmentUid does not resolve: ${row.nodeUid} -> ${row.segmentUid}`);
  }
}

for (const row of symbols) {
  const symbolUid = validateUsrCanonicalId('symbolUid', row.symbolUid);
  assert.equal(symbolUid.ok, true, `invalid symbolUid in canonical example bundle: ${symbolUid.errors.join('; ')}`);
  if (row.declarationDocUid != null) {
    assert.equal(docIds.has(row.declarationDocUid), true, `symbol declarationDocUid does not resolve: ${row.symbolUid} -> ${row.declarationDocUid}`);
  }
  if (row.declarationNodeUid != null) {
    assert.equal(nodeIds.has(row.declarationNodeUid), true, `symbol declarationNodeUid does not resolve: ${row.symbolUid} -> ${row.declarationNodeUid}`);
  }
}

for (const row of edges) {
  const edgeResult = validateUsrEdgeEndpoint(row, edgeConstraints);
  assert.equal(edgeResult.ok, true, `edge endpoint validation failed: ${edgeResult.errors.join('; ')}`);

  const confidence = row?.attrs?.confidence;
  if (confidence !== undefined && confidence !== null) {
    assert.equal(typeof confidence === 'number' && Number.isFinite(confidence), true, 'edge confidence must be numeric or null');
    assert.equal(confidence >= 0 && confidence <= 1, true, `edge confidence must be in [0,1]; received ${confidence}`);
  }

  if (row.source?.entity === 'document') assert.equal(docIds.has(row.source.uid), true, `edge source document uid does not resolve: ${row.source.uid}`);
  if (row.source?.entity === 'segment') assert.equal(segmentIds.has(row.source.uid), true, `edge source segment uid does not resolve: ${row.source.uid}`);
  if (row.source?.entity === 'node') assert.equal(nodeIds.has(row.source.uid), true, `edge source node uid does not resolve: ${row.source.uid}`);
  if (row.source?.entity === 'symbol') assert.equal(symbolIds.has(row.source.uid), true, `edge source symbol uid does not resolve: ${row.source.uid}`);

  if (row.target?.entity === 'document') assert.equal(docIds.has(row.target.uid), true, `edge target document uid does not resolve: ${row.target.uid}`);
  if (row.target?.entity === 'segment') assert.equal(segmentIds.has(row.target.uid), true, `edge target segment uid does not resolve: ${row.target.uid}`);
  if (row.target?.entity === 'node') assert.equal(nodeIds.has(row.target.uid), true, `edge target node uid does not resolve: ${row.target.uid}`);
  if (row.target?.entity === 'symbol') assert.equal(symbolIds.has(row.target.uid), true, `edge target symbol uid does not resolve: ${row.target.uid}`);
}

for (const pathRow of flowPaths) {
  for (const ref of pathRow.nodeRefs || []) {
    if (ref.entity === 'node') {
      assert.equal(nodeIds.has(ref.uid), true, `flow nodeRef does not resolve to node uid: ${ref.uid}`);
    } else if (ref.entity === 'symbol') {
      assert.equal(symbolIds.has(ref.uid), true, `flow nodeRef does not resolve to symbol uid: ${ref.uid}`);
    } else {
      assert.fail(`flow nodeRef has unsupported entity: ${ref.entity}`);
    }
  }
  for (const edgeUid of pathRow.edgeRefs || []) {
    assert.equal(edgeIds.has(edgeUid), true, `flow edgeRef does not resolve: ${edgeUid}`);
  }
}

for (const route of routes) {
  const routeUid = validateUsrCanonicalId('routeUid', route.routeUid);
  assert.equal(routeUid.ok, true, `invalid routeUid in canonical example bundle: ${routeUid.errors.join('; ')}`);
  if (route.segmentUid != null) {
    assert.equal(segmentIds.has(route.segmentUid), true, `route segmentUid does not resolve: ${route.routeUid} -> ${route.segmentUid}`);
  }
  if (route.symbolUid != null) {
    assert.equal(symbolIds.has(route.symbolUid), true, `route symbolUid does not resolve: ${route.routeUid} -> ${route.symbolUid}`);
  }
}

for (const scope of styleScopes) {
  const scopeUid = validateUsrCanonicalId('scopeUid', scope.scopeUid);
  assert.equal(scopeUid.ok, true, `invalid scopeUid in canonical example bundle: ${scopeUid.errors.join('; ')}`);
  if (scope.segmentUid != null) {
    assert.equal(segmentIds.has(scope.segmentUid), true, `styleScope segmentUid does not resolve: ${scope.scopeUid} -> ${scope.segmentUid}`);
  }
  if (scope.ownerSymbolUid != null) {
    assert.equal(symbolIds.has(scope.ownerSymbolUid), true, `styleScope ownerSymbolUid does not resolve: ${scope.scopeUid} -> ${scope.ownerSymbolUid}`);
  }
}

for (const diagnostic of diagnostics) {
  const diagnosticUid = validateUsrCanonicalId('diagnosticUid', diagnostic.diagnosticUid);
  assert.equal(diagnosticUid.ok, true, `invalid diagnosticUid in canonical example bundle: ${diagnosticUid.errors.join('; ')}`);

  const diagnosticCode = validateUsrDiagnosticCode(diagnostic.code);
  assert.equal(diagnosticCode.ok, true, `invalid diagnostic code in canonical example bundle: ${diagnosticCode.errors.join('; ')}`);

  const severity = String(diagnostic.severity || '').toLowerCase();
  const expectedSeverity = diagnostic.code.startsWith('USR-E-')
    ? 'error'
    : (diagnostic.code.startsWith('USR-W-') ? 'warning' : 'info');
  assert.equal(severity, expectedSeverity, `diagnostic severity mismatch for ${diagnostic.code}: expected ${expectedSeverity}, received ${diagnostic.severity}`);

  if (diagnostic.segmentUid != null) {
    assert.equal(segmentIds.has(diagnostic.segmentUid), true, `diagnostic segmentUid does not resolve: ${diagnostic.diagnosticUid} -> ${diagnostic.segmentUid}`);
  }
  if (diagnostic.nodeUid != null) {
    assert.equal(nodeIds.has(diagnostic.nodeUid), true, `diagnostic nodeUid does not resolve: ${diagnostic.diagnosticUid} -> ${diagnostic.nodeUid}`);
  }
}

const canonicalHashA = sha1(stableStringify(bundle));
const canonicalHashB = sha1(stableStringify(JSON.parse(rawBundle)));
assert.equal(canonicalHashA, canonicalHashB, 'canonical serialization hash must be stable across reruns');

console.log('usr canonical example validation checks passed');
