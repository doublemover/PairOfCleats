import assert from 'node:assert/strict';
import { createDockerfileStructureParser, parseDockerfileStructure } from '../../../src/shared/dockerfile-ast.js';
import { createDockerfileChunker, chunkDockerfile } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { createDockerfileImportCollector, collectDockerfileImports } from '../../../src/index/language-registry/import-collectors/dockerfile.js';
import { createDockerfileManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const text = [
  '# syntax=docker/dockerfile:1.7',
  'FROM --platform=$BUILDPLATFORM \\',
  '  node:22 AS \\',
  '  build',
  "RUN <<'EOF'",
  'FROM alpine AS false-stage',
  'COPY --from=false-dependency /tmp /out',
  'EOF',
  'LABEL title="café 🚀"',
  'FROM scratch AS release',
  'COPY --from=build \\',
  '  /out /app',
  'RUN --mount=type=bind,from=tooling,target=/tools echo fixture',
  ''
].join('\n');
const structure = parseDockerfileStructure(text);
assert.equal(structure.parser, 'dockerfile-ast');
assert.equal(structure.coverage, 'partial');
assert.deepEqual(structure.instructions.map((row) => row.keyword), ['FROM', 'RUN', 'LABEL', 'FROM', 'COPY', 'RUN']);
assert.deepEqual(structure.instructions.filter((row) => row.stage).map((row) => row.stage), ['build', 'release']);
const chunks = chunkDockerfile(text);
assert.deepEqual(chunks.map((chunk) => chunk.name), ['FROM build', 'RUN', 'LABEL', 'FROM release', 'COPY', 'RUN']);
const run = chunks[1];
assert.ok(text.slice(run.start, run.end).includes('FROM alpine AS false-stage'));
assert.equal(text.slice(run.meta.astRange.start, run.meta.astRange.end).split('\n').at(-1), 'EOF');
assert.equal(text.slice(chunks[2].meta.astRange.start, chunks[2].meta.astRange.end), 'LABEL title="café 🚀"');
assert.ok(chunks.every((chunk) => chunk.meta.parser === 'dockerfile-ast' && chunk.meta.parserCoverage === 'partial'
  && chunk.start <= chunk.meta.astRange.start && chunk.end >= chunk.meta.astRange.end));
assert.deepEqual(collectDockerfileImports(text).sort(), ['build', 'node:22', 'release', 'scratch', 'tooling']);
const adapter = createDockerfileManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.imports, ['build', 'node:22', 'release', 'scratch', 'tooling']);
assert.deepEqual(relations.exports, ['build', 'release']);
assert.deepEqual(relations.usages, ['build', 'node:22', 'scratch', 'tooling']);
assert.ok(relations.calls.every((edge) => !edge.includes('false-stage') && !edge.includes('false-dependency')));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.ok(adapter.capabilityProfile.diagnostics.some((row) => row.reasonCode === 'USR-R-HEURISTIC-ONLY'));
assert.equal(adapter.extractDocMeta({ chunk: chunks[0] }).source, 'managed-dockerfile-ast');
assert.ok(Object.isFrozen(structure.instructions));
assert.equal(parseDockerfileStructure(text), structure, 'one immutable bounded parse is shared by core consumers');

const escaped = '# escape=`\r\nFROM node:22 AS `\r\n build\r\nLABEL name="🚀"\r\n';
const escapedStructure = parseDockerfileStructure(escaped);
assert.equal(escapedStructure.instructions[0].stage, 'build');
const escapedLabel = escapedStructure.instructions[1];
assert.equal(escaped.slice(escapedLabel.start, escapedLabel.end), 'LABEL name="🚀"');
assert.equal(chunkDockerfile(escaped)[0].name, 'FROM build');
assert.deepEqual(collectDockerfileImports('FROM build AS final\nCOPY --from=build /a /b\n').sort(), ['build', 'final']);

for (const flag of ['--platform=$TARGETPLATFORM', '--platform $TARGETPLATFORM',
  '--platform= $TARGETPLATFORM', '--platform = $TARGETPLATFORM']) {
  const source = `FROM ${flag} ghcr.io/acme/runtime:1 AS runtime\n`;
  const from = parseDockerfileStructure(source).instructions[0];
  assert.equal(from.image, 'ghcr.io/acme/runtime:1');
  assert.equal(from.stage, 'runtime');
  assert.deepEqual(collectDockerfileImports(source), ['ghcr.io/acme/runtime:1', 'runtime']);
  assert.deepEqual(adapter.buildRelations({ text: source, options: {} }).exports, ['runtime']);
  assert.equal(chunkDockerfile(source)[0].name, 'FROM runtime');
}
assert.equal(parseDockerfileStructure('FROM --platform $P ${BASE_IMAGE} AS runtime').instructions[0].image, '${BASE_IMAGE}');
assert.equal(parseDockerfileStructure('FROM --platform=$P --platform $T node:22 AS base').instructions[0].stage, 'base');
for (const source of ['FROM --platform', 'FROM --platform AS fake', 'FROM --platform= AS fake',
  'FROM --platform =', 'FROM --platform $P AS fake', 'FROM --platform $P node:22 AS']) {
  const from = parseDockerfileStructure(source).instructions[0];
  assert.equal(from.fromParseReason, 'malformed-from-flags');
  assert.equal(from.image, '');
  assert.equal(from.stage, '');
  assert.deepEqual(collectDockerfileImports(source), []);
}
const spacedHeredoc = ["RUN <<'EOF'", 'FROM --platform $P fake:1 AS phantom', 'EOF',
  'FROM --platform \\', '  $P \\', '  node:22 AS real'].join('\n');
assert.deepEqual(parseDockerfileStructure(spacedHeredoc).instructions.filter((node) => node.keyword === 'FROM')
  .map((node) => [node.image, node.stage]), [['node:22', 'real']]);
assert.deepEqual(collectDockerfileImports(spacedHeredoc), ['node:22', 'real']);
assert.deepEqual(collectDockerfileImports('FROM AS invalid'), []);
assert.equal(parseDockerfileStructure('FROM AS invalid').instructions[0].fromParseReason, 'malformed-from-arguments');

const malformed = 'FROM\nRUN <<EOF\nFROM imaginary AS hidden\n';
assert.doesNotThrow(() => chunkDockerfile(malformed));
assert.ok(!collectDockerfileImports(malformed).includes('imaginary'));
assert.ok(!adapter.buildRelations({ text: malformed, options: {} }).exports.includes('hidden'));
assert.equal(parseDockerfileStructure(malformed).coverage, 'partial', 'tolerant parsing does not assert source validity');

let missingLoads = 0;
const unavailable = createDockerfileStructureParser({ loadParser: () => {
  missingLoads += 1;
  throw new Error('Controlled missing installed parser');
} });
const fallbackChunks = createDockerfileChunker({ parseStructure: unavailable })('FROM node:22 AS build\n');
assert.equal(fallbackChunks[0].meta.parser, 'line-parser-dockerfile');
assert.equal(fallbackChunks[0].meta.parserCoverage, 'heuristic');
assert.equal(fallbackChunks[0].meta.parserFallbackReason, 'parser-unavailable');
assert.equal(fallbackChunks[0].meta.astRange, undefined);
const fallbackImports = createDockerfileImportCollector({ parseStructure: unavailable });
assert.deepEqual(fallbackImports('FROM node:22 AS build\n'), ['node:22', 'build']);
const fallbackAdapter = createDockerfileManagedAdapter({ parseStructure: unavailable });
assert.deepEqual(fallbackAdapter.buildRelations({ text: 'FROM node:22 AS build\n', options: {} }).exports, ['build']);
assert.equal(fallbackAdapter.capabilityProfile.state, 'partial');
assert.equal(missingLoads, 1);
assert.equal(parseDockerfileStructure('x'.repeat(786433)).reason, 'source-limit');
assert.equal(parseDockerfileStructure('\n'.repeat(4501)).reason, 'line-limit');
assert.equal(parseDockerfileStructure('FROM node:22\rFROM scratch').reason, 'unsupported-lone-cr');
const throwing = createDockerfileStructureParser({ loadParser: () => ({ parse: () => { throw new Error('Controlled parse failure'); } }) });
assert.equal(throwing('FROM node:22').reason, 'parse-failed');
const invalid = createDockerfileStructureParser({ loadParser: () => ({ parse: () => ({ getInstructions: () => [{
  getKeyword: () => 'FROM', getRange: () => ({ start: { line: 0, character: 999 }, end: { line: 0, character: 1000 } })
}] }) }) });
assert.equal(invalid('FROM node:22').reason, 'invalid-source-range');
const tooMany = createDockerfileStructureParser({ loadParser: () => ({ parse: () => ({ getInstructions: () => Array(4097) }) }) });
assert.equal(tooMany('FROM node:22').reason, 'instruction-limit');
const oneInstruction = { collectorScanBudget: { maxLines: 1, maxMatches: 1, maxTokens: 8, maxMs: 0 } };
assert.deepEqual(collectDockerfileImports('FROM node:22 AS build\nFROM scratch AS release\n', oneInstruction), ['node:22', 'build']);
assert.deepEqual(adapter.buildRelations({ text: 'FROM node:22 AS build\nFROM scratch AS release\n',
  options: oneInstruction }).exports, ['build']);
const ordinary = 'FROM node:20 AS base\nRUN echo fixture && \\\n  echo continuation\nCOPY --from=base /src /dst';
assert.deepEqual(chunkDockerfile(ordinary).map((chunk) => chunk.name), ['FROM base', 'RUN', 'COPY']);
console.log('Dockerfile AST keeps continued stages, heredoc ownership, UTF-16 ranges and honest bounded fallback');
