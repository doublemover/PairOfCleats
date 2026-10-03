import { createRequire } from 'node:module';
import { buildLineIndex } from './lines.js';
import { parseDockerfileInstruction } from './dockerfile.js';

const require = createRequire(import.meta.url);
const MAX_SOURCE_CHARS = 786432;
const MAX_INSTRUCTIONS = 4096;
const MAX_LINES = 4500;
const MAX_TOKEN_CHARS = 8192;
const cleanToken = (value) => {
  const text = typeof value === 'string' ? value.trim().replace(/^["']|["']$/gu, '') : '';
  return text.length <= MAX_TOKEN_CHARS ? text : '';
};

/** Application-owned loading only; a factory permits deterministic unavailable-parser controls. */
export const createDockerfileStructureParser = ({ loadParser = () => require('dockerfile-ast').DockerfileParser } = {}) => {
  let parser;
  let loaded = false;
  let priorText;
  let priorResult;
  return (text) => {
    const source = String(text || '');
    const fallback = (reason) => ({ parser: 'line-parser-dockerfile', coverage: 'heuristic', reason, instructions: [] });
    if (source.length > MAX_SOURCE_CHARS) return fallback('source-limit');
    if (/\r(?!\n)/u.test(source)) return fallback('unsupported-lone-cr');
    const lineIndex = buildLineIndex(source);
    if (lineIndex.length > MAX_LINES) return fallback('line-limit');
    if (!loaded) {
      loaded = true;
      try { parser = loadParser(); } catch {}
    }
    if (typeof parser?.parse !== 'function') return fallback('parser-unavailable');
    if (source === priorText) return priorResult;
    try {
      const document = parser.parse(source);
      const nodes = document.getInstructions();
      if (!Array.isArray(nodes) || nodes.length > MAX_INSTRUCTIONS) return fallback('instruction-limit');
      const offsetAt = (position) => {
        const line = position?.line;
        const character = position?.character;
        if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0 || line >= lineIndex.length) return null;
        const offset = lineIndex[line] + character;
        const end = line + 1 < lineIndex.length ? lineIndex[line + 1] - 1 : source.length;
        return offset <= end ? offset : null;
      };
      const instructions = [];
      for (const node of nodes) {
        const keyword = String(node.getKeyword() || '').toUpperCase();
        if (!parseDockerfileInstruction(keyword)) continue;
        const range = node.getRange();
        const start = offsetAt(range?.start);
        const end = offsetAt(range?.end);
        if (start == null || end == null || end < start) return fallback('invalid-source-range');
        const image = keyword === 'FROM' ? cleanToken(node.getImage()) : '';
        const stage = keyword === 'FROM' ? cleanToken(node.getBuildStage()) : '';
        const dependencies = [];
        if (image) dependencies.push(image);
        const flags = typeof node.getFlags === 'function' ? node.getFlags().slice(0, 64) : [];
        for (const flag of flags) {
          const name = String(flag.getName() || '').toLowerCase();
          if ((keyword === 'COPY' || keyword === 'ADD') && name === 'from') {
            const value = cleanToken(flag.getValue());
            if (value) dependencies.push(value);
          } else if (keyword === 'RUN' && name === 'mount') {
            for (const option of String(flag.getValue() || '').split(',')) {
              if (!/^\s*from=/iu.test(option)) continue;
              const value = cleanToken(option.slice(option.indexOf('=') + 1));
              if (value) dependencies.push(value);
            }
          }
        }
        instructions.push({ keyword, start, end, line: range.start.line, endLine: range.end.line, image, stage,
          dependencies: [...new Set(dependencies)], title: keyword === 'FROM'
            ? (stage || image ? `FROM ${stage || image}` : 'FROM') : keyword });
      }
      priorText = source;
      priorResult = Object.freeze({ parser: 'dockerfile-ast', coverage: 'partial', reason: null,
        instructions: Object.freeze(instructions.map((instruction) => Object.freeze({ ...instruction,
          dependencies: Object.freeze(instruction.dependencies) }))) });
      return priorResult;
    } catch {
      return fallback('parse-failed');
    }
  };
};

export const parseDockerfileStructure = createDockerfileStructureParser();
