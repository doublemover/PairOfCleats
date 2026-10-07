import { buildConfigTreeSitterChunks } from './config-tree-sitter.js';
import { buildChunksFromLineHeadings } from '../helpers.js';
import { parseTomlStructure } from '../../../shared/toml-structure.js';

export const createTomlChunker = ({ parseStructure = parseTomlStructure } = {}) => (text, context = {}) => {
  const source = String(text || '');
  const structure = parseStructure(source, { maxMs: context?.treeSitter?.byLanguage?.toml?.maxParseMs
    ?? context?.treeSitter?.maxParseMs });
  const meta = { format: 'toml', parser: structure.parser, parserCoverage: structure.coverage,
    rangeSource: structure.rangeSource, parserFallbackReason: structure.reason, parseMetrics: structure.metrics };
  if (structure.reason) return [{ start: 0, end: source.length, name: 'root', kind: 'ConfigSection', meta }];
  // Source-line sections are application-owned ranges, not vendor AST nodes.
  // Semantic values validate the corresponding decoded table path.
  return structure.headings.length ? structure.headings.map((heading, index) => ({ start: heading.sectionStart,
    end: structure.headings[index + 1]?.sectionStart ?? source.length, name: heading.name, kind: 'ConfigSection',
    meta: { title: heading.name, ...meta, tablePath: heading.path, arrayTable: heading.arrayTable,
      headerRange: { start: heading.start, end: heading.end } } }))
    : [{ start: 0, end: source.length, name: 'root', kind: 'ConfigSection', meta }];
};

const chunkToml = createTomlChunker();

export function chunkIniToml(text, format = 'ini', context) {
  const treeChunks = buildConfigTreeSitterChunks({
    text,
    context,
    languageId: 'toml',
    ext: '.toml',
    format,
    enabled: format === 'toml'
  });
  if (treeChunks) return treeChunks;
  if (format === 'toml') return chunkToml(text, context);
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const match = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (match) {
      headings.push({ line: i, title: match[1].trim() });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks) {
    return chunks.map((chunk) => ({
      ...chunk,
      kind: 'ConfigSection',
      meta: { ...chunk.meta, format }
    }));
  }
  return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format } }];
}
