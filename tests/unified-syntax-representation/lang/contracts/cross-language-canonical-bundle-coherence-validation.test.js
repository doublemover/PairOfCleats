#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const bundlePath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'canonical-examples', 'usr-canonical-example-bundle.json');
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

const documents = Array.isArray(bundle.documents) ? bundle.documents : [];
const segments = Array.isArray(bundle.segments) ? bundle.segments : [];
const nodes = Array.isArray(bundle.nodes) ? bundle.nodes : [];
const symbols = Array.isArray(bundle.symbols) ? bundle.symbols : [];
const edges = Array.isArray(bundle.edges) ? bundle.edges : [];
const routes = Array.isArray(bundle.routes) ? bundle.routes : [];
const diagnostics = Array.isArray(bundle.diagnostics) ? bundle.diagnostics : [];

assert.equal(documents.length >= 2, true, 'canonical example bundle must contain at least two documents for cross-language coherence coverage');

const documentByUid = new Map(documents.map((row) => [row.docUid, row]));
const segmentDocByUid = new Map(segments.map((row) => [row.segmentUid, row.docUid]));
const nodeDocByUid = new Map(nodes.map((row) => [row.nodeUid, row.docUid]));
const symbolDocByUid = new Map(symbols.map((row) => [row.symbolUid, row.declarationDocUid]));

const effectiveLanguages = new Set(
  documents
    .map((row) => row.effectiveLanguageId)
    .filter((value) => typeof value === 'string' && value.length > 0)
);
assert.equal(effectiveLanguages.size >= 2, true, 'canonical example bundle must cover multiple effective languages');

const resolveEndpointDocUid = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'object') return null;
  if (endpoint.entity === 'document') return endpoint.uid || null;
  if (endpoint.entity === 'segment') return segmentDocByUid.get(endpoint.uid) || null;
  if (endpoint.entity === 'node') return nodeDocByUid.get(endpoint.uid) || null;
  if (endpoint.entity === 'symbol') return symbolDocByUid.get(endpoint.uid) || null;
  return null;
};

const crossLanguageEdges = [];
for (const edge of edges) {
  const sourceDocUid = resolveEndpointDocUid(edge.source);
  const targetDocUid = resolveEndpointDocUid(edge.target);
  if (!sourceDocUid || !targetDocUid || sourceDocUid === targetDocUid) continue;

  const sourceLanguage = documentByUid.get(sourceDocUid)?.effectiveLanguageId || null;
  const targetLanguage = documentByUid.get(targetDocUid)?.effectiveLanguageId || null;
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) continue;

  crossLanguageEdges.push({
    edgeUid: edge.edgeUid,
    kind: edge.kind,
    sourceLanguage,
    targetLanguage
  });
}

assert.equal(crossLanguageEdges.length > 0, true, 'canonical example bundle must include at least one cross-language relation edge');
assert.equal(crossLanguageEdges.some((row) => row.kind === 'imports'), true, 'canonical example bundle cross-language edges must include at least one imports edge');

for (const route of routes) {
  const docUid = segmentDocByUid.get(route.segmentUid) || null;
  assert.notEqual(docUid, null, `route segment does not resolve to a document: ${route.routeUid}`);
  assert.equal(documentByUid.has(docUid), true, `route document does not resolve: ${route.routeUid}`);
}

const diagnosticDocLanguages = new Set();
for (const diagnostic of diagnostics) {
  const document = documentByUid.get(diagnostic.docUid);
  assert.notEqual(document, undefined, `diagnostic docUid does not resolve: ${diagnostic.diagnosticUid}`);
  if (document?.effectiveLanguageId) diagnosticDocLanguages.add(document.effectiveLanguageId);
}
assert.equal(diagnosticDocLanguages.size >= 2, true, 'canonical example diagnostics must cover at least two languages to preserve cross-language triage coherence');

console.log('usr cross-language canonical bundle coherence validation checks passed');
