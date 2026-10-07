import { MIN_ESTIMATED_PARSE_COST } from './metrics.js';

const isWordLikeCharCode = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 95
  || code === 36
);

const isWhitespaceCharCode = (code) => (
  code === 9 || code === 10 || code === 13 || code === 32 || code === 12
);

export const estimateSegmentParseCost = (text) => {
  if (!text) {
    return {
      lineCount: 0,
      tokenCount: 0,
      tokenDensity: 0,
      estimatedParseCost: MIN_ESTIMATED_PARSE_COST
    };
  }
  let lineCount = 1;
  let tokenCount = 0;
  let inWord = false;
  let nonWhitespaceChars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) lineCount += 1;
    if (isWhitespaceCharCode(code)) {
      inWord = false;
      continue;
    }
    nonWhitespaceChars += 1;
    if (isWordLikeCharCode(code)) {
      if (!inWord) {
        tokenCount += 1;
        inWord = true;
      }
    } else {
      tokenCount += 1;
      inWord = false;
    }
  }
  const safeLineCount = Math.max(1, lineCount);
  const tokenDensity = tokenCount / safeLineCount;
  const charDensity = nonWhitespaceChars / safeLineCount;
  const tokenMultiplier = 1 + Math.min(2.5, tokenDensity / 18);
  const charMultiplier = 1 + Math.min(1.5, charDensity / 90);
  const estimatedParseCost = Math.max(
    MIN_ESTIMATED_PARSE_COST,
    Math.round(safeLineCount * ((tokenMultiplier * 0.7) + (charMultiplier * 0.3)))
  );
  return {
    lineCount: safeLineCount,
    tokenCount,
    tokenDensity,
    estimatedParseCost
  };
};
