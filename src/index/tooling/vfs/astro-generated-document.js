import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { throwIfAborted } from '../../../shared/abort.js';

const require = createRequire(import.meta.url), admitted = new WeakMap();
const compilerMaps = new WeakSet();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const fail = message => Object.assign(new Error(message), { code: 'ERR_ASTRO_GENERATED_MAPPING' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
const boundary = (text, offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
  && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]));
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
const linesFor = text => {
  const lines = [{ start: 0, end: text.length }];
  for (let offset = 0; offset < text.length; offset++) {
    const unit = text.charCodeAt(offset);
    if ([10, 13, 0x2028, 0x2029].includes(unit)) {
      lines.at(-1).end = offset;
      if (unit === 13 && text.charCodeAt(offset + 1) === 10) offset++;
      lines.push({ start: offset + 1, end: text.length });
    }
  }
  return lines;
};

/** Decode only the single-source non-indexed map emitted by the installed
 * Astro compiler. Source-map anchors alone are coarse: an interval is exact
 * only when both endpoints and every intervening UTF-16 code unit agree. */
export const qualifyAstroGeneratedMap = ({ map, code, originalText, filename, check = () => {}, maxPoints = 32768 }) => {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > 32768
    || typeof code !== 'string' || typeof originalText !== 'string' || !map || map.version !== 3
    || map.sections !== undefined || (map.sourceRoot !== undefined && map.sourceRoot !== '')
    || !Array.isArray(map.sources) || map.sources.length !== 1 || map.sources[0] !== filename
    || !Array.isArray(map.sourcesContent) || map.sourcesContent.length !== 1 || map.sourcesContent[0] !== originalText
    || !Array.isArray(map.names) || map.names.length > 32768 || map.names.some(name => typeof name !== 'string')
    || typeof map.mappings !== 'string' || Buffer.byteLength(map.mappings) > 256 * 1024
    || Buffer.byteLength(code) > 128 * 1024 || Buffer.byteLength(originalText) > 128 * 1024) throw fail('Astro map/source shape or byte budget is not admitted.');
  const generatedLines = linesFor(code), originalLines = linesFor(originalText), points = [];
  let sourceIndex = 0, sourceLine = 0, sourceColumn = 0, nameIndex = 0, pointCount = 0;
  const offsetAt = (lines, text, line, column) => {
    const entry = lines[line], offset = entry ? entry.start + column : -1;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 0 || column < 0
      || !entry || offset > entry.end || !boundary(text, offset)) throw fail('Astro map anchor is not an exact source coordinate.');
    return offset;
  };
  const decode = segment => {
    const values = [];
    let accumulator = 0, shift = 0, digits = 0;
    for (const character of segment) {
      check();
      const digit = alphabet.indexOf(character);
      if (digit < 0 || ++digits > 7) throw fail('Malformed or oversized source-map VLQ value.');
      accumulator += (digit & 31) * 2 ** shift;
      if (!Number.isSafeInteger(accumulator) || accumulator > 0xffffffff) throw fail('Source-map VLQ is out of range.');
      if (digit & 32) shift += 5;
      else { values.push((accumulator & 1 ? -1 : 1) * Math.floor(accumulator / 2)); accumulator = 0; shift = 0; digits = 0; }
      if (values.length > 5) throw fail('Source-map segment has unsupported fields.');
    }
    if (digits || ![1, 4, 5].includes(values.length)) throw fail('Incomplete source-map VLQ segment.');
    return values;
  };
  const mappingLines = map.mappings.split(';');
  if (mappingLines.length > generatedLines.length + 1 || mappingLines.length > 131073) throw fail('Source-map generated line count is invalid.');
  for (let line = 0; line < mappingLines.length; line++) {
    check();
    let generatedColumn = 0;
    if (!mappingLines[line]) continue;
    for (const segment of mappingLines[line].split(',')) {
      if (++pointCount > maxPoints) throw fail('Astro map point budget exhausted.');
      const values = decode(segment);
      if (values[0] < 0) throw fail('Generated source-map columns are not ordered.');
      generatedColumn += values[0];
      const generated = offsetAt(generatedLines, code, line, generatedColumn);
      let original = null;
      if (values.length > 1) {
        sourceIndex += values[1]; sourceLine += values[2]; sourceColumn += values[3];
        if (sourceIndex !== 0) throw fail('Astro mapping refers to an unowned source.');
        original = offsetAt(originalLines, originalText, sourceLine, sourceColumn);
        if (values.length === 5) {
          nameIndex += values[4];
          if (nameIndex < 0 || nameIndex >= map.names.length) throw fail('Source-map name index is invalid.');
        }
      }
      if (points.at(-1)?.generated === generated) {
        const previous = points.at(-1);
        if (previous.original !== original) {
          // The pinned compiler emits overlapping zero-width anchors where it
          // removes frontmatter delimiters and inserts wrapper boundaries.
          // No candidate wins: retain the ambiguity as a coarse interval with
          // no usable original span. External maps still fail closed.
          if (compilerMaps.has(map)) { previous.original = null; previous.ambiguous = true; }
          else throw Object.assign(fail('Conflicting Astro map anchors at one generated coordinate.'), {
            mappingConflict: { generatedLine: line, generatedColumn, generatedOffset: generated,
              previousOriginalOffset: previous.original, originalOffset: original }
          });
        }
      } else points.push({ generated, original });
    }
  }
  const intervals = [];
  if (!points.length || points[0].generated > 0) intervals.push({ generated: [0, points[0]?.generated ?? code.length], original: null, quality: 'synthetic' });
  for (let index = 0; index < points.length; index++) {
    check();
    const from = points[index], to = points[index + 1], end = to?.generated ?? code.length;
    if (end <= from.generated) continue;
    const exact = from.original !== null && to?.original !== null && to?.original !== undefined
      && end - from.generated === to.original - from.original
      && code.slice(from.generated, end) === originalText.slice(from.original, to.original);
    intervals.push({ generated: [from.generated, end], original: exact ? [from.original, to.original] : null,
      quality: exact ? 'exact' : from.ambiguous ? 'coarse' : from.original === null ? 'synthetic' : 'coarse' });
  }
  return { intervals, pointCount };
};

/** One bounded parse-only transform, without Astro project configuration,
 * preprocessors, module resolution, dependency fetching or user code execution.
 * Generated TSX is never admitted as an independent user/source partition. */
export const createAstroGeneratedDocument = ({ item, generation, configHash, dependencyHash, profileHash = null,
  maxMs = 1000, signal = null }) => {
  if (!generation || !digest(configHash) || !digest(dependencyHash) || (profileHash !== null && !digest(profileHash))
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000 || item?.source?.language !== 'astro'
    || item.source.mapping || typeof item.text !== 'string' || Buffer.byteLength(item.text) > 128 * 1024
    || createHash('sha256').update(item.text).digest('hex') !== item.source.byteHash
    || typeof item.syntax?.partitionId !== 'string' || !digest(item.syntax?.canonicalHash)
    || item.facts?.syntaxPartitionId !== item.syntax.partitionId
    || !same(item.facts?.storage?.generation, generation)) throw fail('Astro generated document is outside its immutable original source/context.');
  const started = performance.now();
  const check = () => { throwIfAborted(signal); if (performance.now() - started >= maxMs) throw fail('Astro transform/map time budget exhausted.'); };
  check();
  const version = require('@astrojs/compiler/package.json').version;
  if (version !== '4.0.0') throw fail('Astro compiler version differs from this explicit adapter profile.');
  const generated = require('@astrojs/compiler/sync').convertToTSX(item.text, {
    filename: item.source.path, normalizedFilename: item.source.path, sourcemap: 'external', includeScripts: true, includeStyles: false
  });
  check();
  if (typeof generated?.code !== 'string' || Buffer.byteLength(canonicalSemanticJson(generated.map)) > 256 * 1024
    || !Array.isArray(generated.diagnostics) || generated.diagnostics.length > 32) throw fail('Astro generated output exceeds its map/diagnostic contract.');
  let qualified;
  compilerMaps.add(generated.map);
  try {
    qualified = qualifyAstroGeneratedMap({ code: generated.code, map: generated.map,
      originalText: item.text, filename: item.source.path, check });
  } finally { compilerMaps.delete(generated.map); }
  const body = { schemaVersion: 1, kind: 'astro-generated-tooling-document', adapterVersion: '3',
    runtime: { family: '@astrojs/compiler', version, qualification: 'application-library-unqualified' },
    source: { path: item.source.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      syntaxPartitionId: item.syntax?.partitionId, syntaxHash: item.syntax?.canonicalHash },
    generation: JSON.parse(canonicalSemanticJson(generation)), configHash, dependencyHash, profileHash,
    languageId: 'typescriptreact', code: generated.code, codeHash: createHash('sha256').update(generated.code).digest('hex'),
    map: JSON.parse(canonicalSemanticJson(generated.map)), mapHash: semanticHash('tooling.astro-generated-map.v1', generated.map),
    diagnostics: JSON.parse(canonicalSemanticJson(generated.diagnostics)), mappingQuality: qualified.intervals.some(value => value.quality !== 'exact') ? 'partial' : 'exact' };
  const document = freeze({ ...body, identity: semanticHash('tooling.astro-generated-document.v1', body) });
  admitted.set(document, { intervals: qualified.intervals });
  check();
  return document;
};

/** Preserve disjoint original intervals and mapping gaps. A coarse/synthetic
 * result never returns a usable original span or a repaired coordinate. */
export const mapAstroGeneratedRange = (document, span) => {
  const authority = admitted.get(document);
  if (!authority || !Array.isArray(span) || span.length !== 2 || !span.every(offset => boundary(document.code, offset))
    || span[0] >= span[1]) throw fail('Generated Astro range lacks an admitted document or exact bounds.');
  const spans = [];
  let cursor = span[0];
  for (const interval of authority.intervals) {
    if (interval.generated[1] <= cursor || interval.generated[0] >= span[1]) continue;
    if (interval.generated[0] > cursor) return { quality: 'unmapped', spans: [] };
    if (interval.quality !== 'exact') return { quality: interval.quality, spans: [] };
    const end = Math.min(span[1], interval.generated[1]);
    const original = [interval.original[0] + cursor - interval.generated[0], interval.original[0] + end - interval.generated[0]];
    if (spans.at(-1)?.[1] === original[0]) spans.at(-1)[1] = original[1]; else spans.push(original);
    cursor = end;
    if (cursor === span[1]) return { quality: 'exact', spans };
  }
  return { quality: 'unmapped', spans: [] };
};

export const isAdmittedAstroGeneratedDocument = document => admitted.has(document);

