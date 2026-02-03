import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { toPosix } from '../../../shared/files.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

const buildChunksFromLineHeadings = (text, headings) => {
  if (!headings.length) return null;
  const lineIndex = buildLineIndex(text);
  const chunks = [];
  for (let i = 0; i < headings.length; ++i) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line : lineIndex.length;
    const start = lineIndex[startLine] || 0;
    const end = endLine < lineIndex.length ? lineIndex[endLine] : text.length;
    const title = headings[i].title || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks;
};

const chunkGitHubActions = (text) => {
  const lines = text.split('\n');
  const headings = [];
  let jobsLine = -1;
  for (let i = 0; i < lines.length; ++i) {
    if (/^\s*jobs:\s*$/.test(lines[i])) {
      jobsLine = i;
      break;
    }
  }
  if (jobsLine >= 0) {
    for (let i = jobsLine + 1; i < lines.length; ++i) {
      const match = lines[i].match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
      if (match) headings.push({ line: i, title: match[1] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'workflow', kind: 'ConfigSection', meta: { format: 'github-actions' } }];
};

const parseYamlTopLevelKey = (line) => {
  const quoted = line.match(/^(['"])(.+?)\1\s*:/);
  if (quoted) return quoted[2].trim();
  const unquoted = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
  if (unquoted) return unquoted[1].trim();
  return null;
};

const chunkYamlTopLevel = (text) => {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    if (line.startsWith(' ') || line.startsWith('\t')) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') continue;
    if (trimmed.startsWith('-')) continue;
    const key = parseYamlTopLevelKey(line);
    if (key) headings.push({ line: i, title: key });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks && chunks.length
    ? chunks.map((chunk) => ({
      ...chunk,
      kind: 'ConfigSection',
      meta: { ...(chunk.meta || {}), format: 'yaml', title: chunk.name }
    }))
    : null;
};

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

export function chunkYaml(text, relPath, context) {
  const relPosix = relPath ? toPosix(relPath) : '';
  const isWorkflow = relPosix.includes('.github/workflows/');
  if (isWorkflow) return chunkGitHubActions(text);
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'yaml',
      ext: '.yaml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const mode = resolveYamlChunkMode(text, context);
  if (mode === 'top-level') {
    const chunks = chunkYamlTopLevel(text);
    if (chunks && chunks.length) return chunks;
  }
  return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'yaml' } }];
}
