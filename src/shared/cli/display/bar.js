import { colorToAnsi, composeColor } from './colors.js';

const PARTIALS_OVERALL = ['▊', '▋', '▌', '▍', '▎', '▏'];
const PARTIALS_STAGE = ['▖', '▘', '▝', '▗', '▚', '▞'];
const PARTIALS_IMPORTS = ['░', '▒', '▓'];
const PARTIALS_FILES = ['⠁', '⠃', '⠇', '⡇', '⡏', '⡟', '⡿'];
const PARTIALS_ARTIFACTS = ['⡈', '⡘', '⡸', '⣸'];
const PARTIALS_REPOS = ['▂', '▃', '▄', '▅', '▆', '▇'];
const PARTIALS_DEFAULT = ['⡁', '⡃', '⡇', '⡧', '⡷'];
const PARTIALS_FINE = PARTIALS_DEFAULT;
const EMPTY_PATTERN_DEFAULT = '┈┉';

export const BAR_STYLES = {
  overall: { fill: '▉', empty: ' ', partials: PARTIALS_OVERALL },
  stage: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  imports: { fill: '█', empty: ' ', partials: PARTIALS_IMPORTS },
  files: { fill: '⣿', empty: ' ', partials: PARTIALS_FILES },
  artifacts: { fill: '⣿', empty: ' ', partials: PARTIALS_ARTIFACTS },
  shard: { fill: '⣿', empty: ' ', partials: PARTIALS_FILES },
  records: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  embeddings: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  downloads: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  repos: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  queries: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  ci: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  default: { fill: '⣿', empty: EMPTY_PATTERN_DEFAULT, partials: PARTIALS_DEFAULT }
};

export const repeatPattern = (pattern, count) => {
  if (!pattern || count <= 0) return '';
  const safe = String(pattern);
  if (safe.length === 1) return safe.repeat(count);
  let output = '';
  for (let i = 0; i < count; i += 1) {
    output += safe[i % safe.length];
  }
  return output;
};

export const buildGradientText = (count, char, gradient, colorize, background) => {
  if (!count || !gradient || !colorize) return char.repeat(count);
  let output = '';
  for (let i = 0; i < count; i += 1) {
    const color = gradient(i, count);
    const fg = color ? colorToAnsi(color) : null;
    const code = composeColor(fg, background);
    output += colorize(char, code);
  }
  return output;
};

export const buildBar = (pct, width, style, theme, colorize, options = {}) => {
  const safeWidth = Math.max(4, Math.floor(width));
  const clamped = Math.min(1, Math.max(0, pct));
  const total = clamped * safeWidth;
  const fullCount = Math.floor(total);
  const remainder = total - fullCount;
  const partials = Array.isArray(style?.partials) && style.partials.length
    ? style.partials
    : PARTIALS_FINE;
  let partialIndex = Math.floor(remainder * partials.length);
  if (remainder > 0 && partialIndex === 0) partialIndex = 1;
  if (partialIndex >= partials.length) partialIndex = partials.length;
  let hasPartial = partialIndex > 0 && fullCount < safeWidth;
  const animateIndex = Number.isFinite(options.animateIndex) ? options.animateIndex : null;
  if (animateIndex !== null && clamped < 1 && fullCount < safeWidth) {
    const animated = (Math.floor(animateIndex) % partials.length) + 1;
    partialIndex = animated;
    hasPartial = true;
  }
  const emptyCount = Math.max(0, safeWidth - fullCount - (hasPartial ? 1 : 0));

  const fillChar = style?.fill || '█';
  const emptyChar = style?.empty || '·';
  const filledText = fullCount > 0 ? repeatPattern(fillChar, fullCount) : '';
  const partialText = hasPartial ? partials[partialIndex - 1] : '';
  const emptyText = emptyCount > 0 ? repeatPattern(emptyChar, emptyCount) : '';

  const background = theme?.background || '';
  let filled = filledText;
  if (colorize && options.fillGradient && fullCount > 0) {
    filled = buildGradientText(fullCount, fillChar, options.fillGradient, colorize, background);
  } else if (colorize) {
    filled = colorize(filledText, composeColor(theme?.fill, background));
  }
  const partial = colorize ? colorize(partialText, composeColor(theme?.edge, background)) : partialText;
  const empty = colorize ? colorize(emptyText, composeColor(theme?.empty, background)) : emptyText;
  const bracketFg = theme?.bracketFg || theme?.bracket || '';
  const bracketBg = theme?.bracketBg || '';
  const bracketCode = composeColor(bracketFg, bracketBg);
  const left = colorize ? colorize('[', bracketCode) : '[';
  const right = colorize ? colorize(']', bracketCode) : ']';
  return `${left}${filled}${partial}${empty}${right}`;
};
