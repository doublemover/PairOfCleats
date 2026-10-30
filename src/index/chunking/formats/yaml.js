import { toPosix } from '../../../shared/file-paths.js';
import { buildConfigTreeSitterChunks } from './config-tree-sitter.js';
import { parseYamlStructure } from '../../../shared/yaml-structure.js';
import { preserveChunkPreamble } from '../helpers.js';

const resolveYamlChunkMode = (text, context) => {
  const config = context?.yamlChunking || {};
  const modeRaw = typeof config.mode === 'string' ? config.mode.toLowerCase() : '';
  const mode = ['auto', 'root', 'top-level'].includes(modeRaw) ? modeRaw : 'root';
  const maxBytesRaw = Number(config.maxBytes);
  const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(0, Math.floor(maxBytesRaw)) : 200 * 1024;
  const textBytes = Buffer.byteLength(text, 'utf8');
  if (mode === 'top-level' && textBytes > maxBytes) return 'root';
  if (mode === 'auto') {
    return textBytes <= maxBytes ? 'top-level' : 'root';
  }
  return mode;
};

export const createYamlChunker = ({ parseStructure = parseYamlStructure, now = () => performance.now() } = {}) => (text, relPath, context) => {
  const source = String(text || '');
  const relPosix = relPath ? toPosix(relPath) : '';
  const workflow = relPosix.includes('.github/workflows/');
  let treeChunks = null;
  if (!workflow) {
    if (resolveYamlChunkMode(source, context) !== 'top-level') {
      return [{ start: 0, end: source.length, name: 'root', kind: 'ConfigSection', meta: { format: 'yaml',
        ...(context?.treeSitter?.configChunking ? {nativeRouteReason:'yaml-root-mode-precedence'} : {}) } }];
    }
    treeChunks = buildConfigTreeSitterChunks({ text: source, context, languageId: 'yaml', ext: '.yaml', format: 'yaml' });
  }
  parseStructure.initialize?.();
  const started = Number(now());
  const requested = Number(context?.treeSitter?.byLanguage?.yaml?.maxParseMs ?? context?.treeSitter?.maxParseMs);
  const ownerLimitMs = Number.isFinite(requested) && requested > 0 ? Math.max(1, Math.min(30, Math.floor(requested))) : 30;
  const elapsed = () => Math.max(0, Number(now()) - started);
  const structure = parseStructure(source, { maxMs: ownerLimitMs });
  const outputMetrics = { ...structure.metrics, ownerLimitMs };
  const meta = { format: workflow ? 'github-actions' : 'yaml', parser: structure.parser,
    ...(!workflow&&context?.treeSitter?.configChunking&&!treeChunks?{nativeRouteReason:'native-structure-unavailable-or-unselected'}:{}),
    parserCoverage: structure.coverage, parserFallbackReason: structure.reason, parseMetrics: outputMetrics,
    rangeSource: structure.rangeSource, unresolvedAliases: structure.unresolvedAliases, unresolvedTags: structure.unresolvedTags,
    parserWarningCodes: structure.warningCodes };
  const headings = workflow ? structure.jobs : structure.properties;
  const chunks = [];
  const expired = () => {
    const measured = elapsed();
    outputMetrics.ownerElapsedMs = measured;
    if (Number.isFinite(measured) && measured < ownerLimitMs) return false;
    meta.parser = 'yaml-unavailable';
    meta.parserCoverage = 'unavailable';
    meta.parserFallbackReason = 'time-limit';
    meta.rangeSource = undefined;
    outputMetrics.ownerMeasuredOverrunMs = Math.max(0, measured - ownerLimitMs);
    return true;
  };
  const unavailable = () => [{ start: 0, end: source.length, name: workflow ? 'workflow' : 'root', kind: 'ConfigSection', meta }];
  if (structure.reason || expired()) return unavailable();
  const documents=Array.isArray(structure.documentRanges) && structure.documentRanges.length
    ? structure.documentRanges : [{start:0,end:source.length,documentIndex:0}];
  for(let documentIndex=0;documentIndex<documents.length;documentIndex++) {
    const document=documents[documentIndex];
    const indexValue=document.documentIndex ?? documentIndex;
    const start=documentIndex === 0 ? 0 : document.sourceStart ?? document.start;
    const nextDocument=documents[documentIndex+1];
    const end=nextDocument?.sourceStart ?? nextDocument?.start ?? source.length;
    const entries=headings.filter(heading=>heading.documentIndex === indexValue);
    if(!entries.length) {
      chunks.push({start,end,name: documents.length === 1 && !workflow ? 'root' : `document ${indexValue}`,kind:'ConfigSection',meta:{...meta,documentIndex:indexValue,
        documentRange:{start:document.start,end:document.end},sectionRangeSource:'application-document-boundaries'}});
      continue;
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (expired()) return unavailable();
      const heading = entries[index];
      chunks.push({ start: index === 0 ? start : heading.sectionStart, end: entries[index + 1]?.sectionStart ?? end,
        name: heading.name, kind: 'ConfigSection', meta: { ...meta, title: heading.name, documentIndex: heading.documentIndex,
          documentRange:{start:document.start,end:document.end},
          keyRange: heading.keyRange, valueRange: heading.valueRange, propertyRange: heading.propertyRange,
          sectionRangeSource: 'application-line-boundaries', propertyRangeSource: 'application-key/value-span' } });
    }
  }
  if (expired()) return unavailable();
  Object.freeze(outputMetrics);
  if (treeChunks) {
    // Canonical YAML syntax owns document/separator extents independently of
    // backend. Native pairs remain separately attributed, never widened across
    // another document merely because it has no selected mapping pair.
    for (const chunk of chunks) {
      const body = chunk.meta.documentRange;
      chunk.meta = { ...chunk.meta, nativeParser:'tree-sitter',
        nativeSections:treeChunks.filter(row=>row.start >= body.start && row.end <= body.end
          && row.start >= chunk.start && row.start < chunk.end).map(row=>({start:row.start,end:row.end,
          name:row.name,kind:row.kind,meta:row.meta})),
        documentEnvelopeSource:'yaml-syntax-nodes' };
    }
  }
  return preserveChunkPreamble(source, chunks, { kind: 'ConfigSection', format: meta.format });
};

export const chunkYaml = createYamlChunker();
