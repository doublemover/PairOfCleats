import { buildConfigTreeSitterChunks } from './config-tree-sitter.js';
import { parseXmlStructure } from '../../../shared/xml-structure.js';

// One document envelope owner for both structural routes. Structural chunks keep
// their original grammar/lexical coordinates; only uncovered bytes get an owner.
const retainXmlSourceGaps = (source, chunks, meta) => {
  const intervals = chunks.map(chunk => [chunk.start, chunk.end]).sort((a,b) => a[0]-b[0] || b[1]-a[1]);
  const gaps = []; let end = 0;
  for (const [start, stop] of intervals) {
    if (start > end) gaps.push([end, start]);
    end = Math.max(end, stop);
  }
  if (end < source.length) gaps.push([end, source.length]);
  return [...chunks, ...gaps.map(([start, stop]) => ({ start, end: stop,
    name: start === 0 ? 'root-preamble' : 'document-source-gap', kind: 'ConfigSection',
    meta: { ...meta, sourceCoverage: 'document-envelope', sectionRangeSource: 'application-source-gap' }
  }))].sort((a,b) => a.start-b.start || b.end-a.end);
};

export const createXmlChunker = ({ parseStructure = parseXmlStructure, now = () => performance.now() } = {}) => (text, context) => {
  const source = String(text || '');
  const treeChunks = buildConfigTreeSitterChunks({ text: source, context, languageId: 'xml', ext: '.xml', format: 'xml' });
  if (treeChunks) return retainXmlSourceGaps(source, treeChunks.map(chunk => ({ ...chunk,
    meta: { ...chunk.meta, structuralRange: { start: chunk.start, end: chunk.end }, structuralRangeSource: 'native-node' }
  })), { format: 'xml', parser: 'tree-sitter', rangeSource: 'application-document-envelope' });
  const started = Number(now());
  const requested = Number(context?.treeSitter?.byLanguage?.xml?.maxParseMs ?? context?.treeSitter?.maxParseMs);
  const ownerLimitMs = Number.isFinite(requested) && requested > 0 ? Math.max(1, Math.min(30, Math.floor(requested))) : 30;
  const structure = parseStructure(source, { maxMs: ownerLimitMs,
    remainingMs: () => Math.max(0, ownerLimitMs - (Number(now()) - started)) });
  const meta = { format: 'xml', parser: structure.parser, parserCoverage: structure.coverage,
    parserFallbackReason: structure.reason, rangeSource: structure.rangeSource,
    unresolvedReferences: structure.unresolvedReferences, ignoredDeclarations: structure.ignoredDeclarations,
    parseMetrics: { ...structure.metrics, ownerLimitMs } };
  const wholeContent = () => [{ start: 0, end: source.length, name: 'root', kind: 'ConfigSection', meta }];
  const expired = () => {
    const measured = Math.max(0, Number(now()) - started);
    if (Number.isFinite(measured) && measured < ownerLimitMs) return false;
    meta.parser = 'xml-unavailable';
    meta.parserCoverage = 'unavailable';
    meta.parserFallbackReason = 'time-limit';
    meta.rangeSource = undefined;
    meta.parseMetrics = { ...meta.parseMetrics, ownerElapsedMs: measured, ownerMeasuredOverrunMs: Math.max(0, measured - ownerLimitMs) };
    return true;
  };
  if (structure.reason || expired() || !structure.sections.length) return wholeContent();
  const chunks = [];
  for (let index = 0; index < structure.sections.length; index += 1) {
    if (expired()) return wholeContent();
    const section = structure.sections[index];
    chunks.push({ start: section.start, end: structure.sections[index + 1]?.start ?? source.length,
      name: section.name, kind: 'ConfigSection', meta: { ...meta, title: section.name,
        lexicalElementRange: { start: section.start, end: section.end },
        nameRange: section.nameRange, openingRange: section.openingRange, sectionRangeSource: 'application-sibling-boundaries' } });
  }
  if (expired()) return wholeContent();
  return retainXmlSourceGaps(source, chunks, meta);
};

export const chunkXml = createXmlChunker();
