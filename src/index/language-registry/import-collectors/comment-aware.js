const normalizeLineMarkers = (markers = []) => Array.from(
  new Set(
    markers
      .map((marker) => String(marker || '').trim())
      .filter(Boolean)
  )
).sort((a, b) => b.length - a.length);

const normalizeBlockPairs = (pairs = []) => {
  const normalized = [];
  for (const pair of pairs) {
    const start = String(Array.isArray(pair) ? pair[0] : '').trim();
    const end = String(Array.isArray(pair) ? pair[1] : '').trim();
    if (!start || !end) continue;
    normalized.push([start, end]);
  }
  return normalized;
};

const INLINE_STRIPPER_CACHE = new Map();

const TEMPLATE_COMMENT_PATTERNS = Object.freeze([
  /\{\{!--[\s\S]*?--\}\}/g, // Handlebars block comments
  /\{\{![\s\S]*?\}\}/g, // Handlebars/Mustache inline comments
  /\{#[\s\S]*?#\}/g // Jinja comments
]);

/**
 * Create a quote-aware comment stripper that can keep block-comment state
 * across lines.
 *
 * @param {{
 *  markers?: string[],
 *  blockCommentPairs?: Array<[string, string]>,
 *  requireWhitespaceBefore?: boolean
 * }} [options]
 * @returns {(line:string)=>string}
 */
export const createCommentAwareLineStripper = ({
  markers = ['#'],
  blockCommentPairs = [],
  requireWhitespaceBefore = false
} = {}) => {
  const markerList = normalizeLineMarkers(markers);
  const blockPairs = normalizeBlockPairs(blockCommentPairs);
  let activeBlockComment = null;

  return (line) => {
    const source = String(line || '');
    if (!source) return '';
    if (!markerList.length && !blockPairs.length) return source;

    let output = '';
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    let escapedDouble = false;

    while (i < source.length) {
      if (activeBlockComment) {
        const endIndex = source.indexOf(activeBlockComment[1], i);
        if (endIndex < 0) {
          i = source.length;
          break;
        }
        i = endIndex + activeBlockComment[1].length;
        activeBlockComment = null;
        continue;
      }

      if (inDouble) {
        const char = source[i];
        output += char;
        if (escapedDouble) {
          escapedDouble = false;
          i += 1;
          continue;
        }
        if (char === '\\') {
          escapedDouble = true;
          i += 1;
          continue;
        }
        if (char === '"') inDouble = false;
        i += 1;
        continue;
      }

      if (inSingle) {
        const char = source[i];
        output += char;
        if (char === "'") {
          if (source[i + 1] === "'") {
            output += source[i + 1];
            i += 2;
            continue;
          }
          inSingle = false;
        }
        i += 1;
        continue;
      }

      const char = source[i];
      if (char === '"') {
        inDouble = true;
        output += char;
        i += 1;
        continue;
      }
      if (char === "'") {
        inSingle = true;
        output += char;
        i += 1;
        continue;
      }

      let startedBlock = false;
      for (const pair of blockPairs) {
        if (!source.startsWith(pair[0], i)) continue;
        activeBlockComment = pair;
        i += pair[0].length;
        startedBlock = true;
        break;
      }
      if (startedBlock) continue;

      let startedLineComment = false;
      for (const marker of markerList) {
        if (!source.startsWith(marker, i)) continue;
        if (requireWhitespaceBefore && i > 0 && /\S/.test(source[i - 1])) continue;
        startedLineComment = true;
        i = source.length;
        break;
      }
      if (startedLineComment) break;

      output += char;
      i += 1;
    }

    return output.trimEnd();
  };
};

/**
 * Strip inline comments while respecting quoted strings.
 *
 * @param {string} line
 * @param {{markers?: string[], requireWhitespaceBefore?: boolean}} [options]
 * @returns {string}
 */
export const stripInlineCommentAware = (
  line,
  { markers = ['#'], requireWhitespaceBefore = false } = {}
) => {
  const markerList = normalizeLineMarkers(markers);
  const cacheKey = `${markerList.join('\u0001')}|${requireWhitespaceBefore ? '1' : '0'}`;
  let stripper = INLINE_STRIPPER_CACHE.get(cacheKey);
  if (!stripper) {
    stripper = createCommentAwareLineStripper({
      markers: markerList,
      requireWhitespaceBefore
    });
    INLINE_STRIPPER_CACHE.set(cacheKey, stripper);
  }
  return stripper(line);
};

export const stripTemplateCommentBlocks = (text) => {
  let source = String(text || '');
  for (const pattern of TEMPLATE_COMMENT_PATTERNS) {
    source = source.replace(pattern, ' ');
  }
  return source;
};
