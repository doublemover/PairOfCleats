import { toPosix } from '../../../shared/file-paths.js';
import { buildConfigTreeSitterChunks } from './config-tree-sitter.js';
import { parseYamlStructure } from '../../../shared/yaml-structure.js';

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
  if (!workflow) {
    const treeChunks = buildConfigTreeSitterChunks({ text: source, context, languageId: 'yaml', ext: '.yaml', format: 'yaml' });
    if (treeChunks) return treeChunks;
    if (resolveYamlChunkMode(source, context) !== 'top-level') {
      return [{ start: 0, end: source.length, name: 'root', kind: 'ConfigSection', meta: { format: 'yaml' } }];
    }
  }
  parseStructure.initialize?.();
  const started = Number(now());
  const requested = Number(context?.treeSitter?.byLanguage?.yaml?.maxParseMs ?? context?.treeSitter?.maxParseMs);
  const ownerLimitMs = Number.isFinite(requested) && requested > 0 ? Math.max(1, Math.min(30, Math.floor(requested))) : 30;
  const elapsed = () => Math.max(0, Number(now()) - started);
  const structure = parseStructure(source, { maxMs: ownerLimitMs });
  const outputMetrics = { ...structure.metrics, ownerLimitMs };
  const meta = { format: workflow ? 'github-actions' : 'yaml', parser: structure.parser,
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
  if (structure.reason || expired() || !headings.length) return unavailable();
  for (let index = 0; index < headings.length; index += 1) {
    if (expired()) return unavailable();
    const heading = headings[index];
    chunks.push({ start: heading.sectionStart, end: headings[index + 1]?.sectionStart ?? source.length,
      name: heading.name, kind: 'ConfigSection', meta: { ...meta, title: heading.name, documentIndex: heading.documentIndex,
        keyRange: heading.keyRange, valueRange: heading.valueRange, propertyRange: heading.propertyRange,
        sectionRangeSource: 'application-line-boundaries', propertyRangeSource: 'application-key/value-span' } });
  }
  if (expired()) return unavailable();
  Object.freeze(outputMetrics);
  return chunks;
};

export const chunkYaml = createYamlChunker();
