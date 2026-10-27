import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const COMMENT_CONFIG_LIMITS = Object.freeze({ candidates: 32, blockBytes: 64 * 1024,
  fileBytes: 256 * 1024, fenceLines: 20000 });
const parsers = new Map();
const loadParser = language => {
  if (!parsers.has(language)) {
    const parse = language === 'json' ? require('jsonc-parser').parse
      : language === 'yaml' ? require('yaml').parse : require('smol-toml').parse;
    if (typeof parse !== 'function') throw new TypeError(`Required ${language} comment parser API is unavailable.`);
    parsers.set(language, parse);
  }
  return parsers.get(language);
};

/** Construction metrics describe this extraction, not later paired-cache hits.
 * Bounds precede content assembly/vendor entry; no synchronous deadline is claimed.
 */
export const createCommentConfigAdmission = ({ enabled = true, onParse = null } = {}) => {
  const receipt = { origin: 'extraction-construction', state: enabled ? 'complete' : 'not-requested',
    candidates: 0, parserCalls: 0, parsedBytes: 0, accepted: 0, invalid: 0, fenceLines: 0, exclusions: [] };
  let stopped = !enabled;
  const exclude = (reason, range, stop = false) => {
    receipt.state = 'partial';
    if (receipt.exclusions.length < COMMENT_CONFIG_LIMITS.candidates + 1) receipt.exclusions.push({ reason, ...range });
    if (stop) stopped = true;
    return false;
  };
  return {
    get discover() { return !stopped; },
    candidate(range) {
      if (stopped) return false;
      if (++receipt.candidates > COMMENT_CONFIG_LIMITS.candidates) return exclude('candidate-count-budget', range, true);
      return true;
    },
    scanLine(range) {
      if (++receipt.fenceLines > COMMENT_CONFIG_LIMITS.fenceLines) return exclude('fence-line-budget', range, true);
      return true;
    },
    parse(language, lines, first, end, range) {
      let bytes = Math.max(0, end - first - 1);
      for (let index = first; index < end; index++) {
        // UTF-8 is never shorter than the UTF-16 code-unit count for valid text.
        if (lines[index].content.length > COMMENT_CONFIG_LIMITS.blockBytes) return exclude('candidate-byte-budget', range);
        bytes += Buffer.byteLength(lines[index].content, 'utf8');
        if (bytes > COMMENT_CONFIG_LIMITS.blockBytes) return exclude('candidate-byte-budget', range);
      }
      if (bytes > COMMENT_CONFIG_LIMITS.fileBytes - receipt.parsedBytes) return exclude('aggregate-byte-budget', range);
      const text = lines.slice(first, end).map(line => line.content).join('\n');
      if (!text) { receipt.invalid++; return false; }
      // Required-library loading and observer failures are not malformed input.
      const parse = loadParser(language);
      onParse?.(Object.freeze({ language, bytes, ...range }));
      receipt.parserCalls++; receipt.parsedBytes += bytes;
      try {
        const errors = [];
        if (language === 'json') parse(text, errors, { allowTrailingComma: true, allowEmptyContent: false });
        else parse(text);
        if (errors.length) { receipt.invalid++; return false; }
        receipt.accepted++; return true;
      } catch { receipt.invalid++; return false; }
    },
    snapshot: () => structuredClone(receipt)
  };
};
