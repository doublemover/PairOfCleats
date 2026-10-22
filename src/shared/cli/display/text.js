const ANSI_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/g;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const wideCodePoint = code => code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
  || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || (code >= 0xac00 && code <= 0xd7a3)
  || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19)
  || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
  || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x20000 && code <= 0x3fffd));

/** Ambiguous glyphs occupy one cell; emoji graphemes and East Asian wide glyphs occupy two. */
export const graphemeWidth = value => {
  if (!value || /^[\p{Mark}\p{Cf}\p{Cc}]*$/u.test(value)) return 0;
  if (/\p{Regional_Indicator}{2}|\u20e3|\uFE0F/u.test(value)
    || (!value.includes('\uFE0E') && /\p{Emoji_Presentation}/u.test(value))) return 2;
  if (/\u200d/u.test(value) && /\p{Extended_Pictographic}/u.test(value)) return 2;
  return [...value].some(character => wideCodePoint(character.codePointAt(0))) ? 2 : 1;
};

/** Flatten embedded line/control characters at the human projection boundary. */
export const sanitizeDisplayText = value => {
  const text = String(value ?? '');
  const clean = plain => plain.replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(ANSI_PATTERN)) {
    result += clean(text.slice(cursor, match.index));
    if (/^\x1b\[[0-9;:]*m$/.test(match[0]) || /^\x1b\]8;[^\x00-\x1f]*(?:\x07|\x1b\\)$/.test(match[0])) result += match[0];
    cursor = match.index + match[0].length;
  }
  return result + clean(text.slice(cursor));
};

export const stripAnsi = (value) => String(value || '').replace(ANSI_PATTERN, '');
export const displayWidth = value => [...graphemes.segment(stripAnsi(sanitizeDisplayText(value)))].reduce((sum, segment) => sum + graphemeWidth(segment.segment), 0);

const sliceDisplayCells = (value, width) => {
  const text = sanitizeDisplayText(value);
  const plain = stripAnsi(text);
  let end = 0;
  let cells = 0;
  for (const segment of graphemes.segment(plain)) {
    const size = graphemeWidth(segment.segment);
    if (cells + size > width) break;
    cells += size;
    end = segment.index + segment.segment.length;
  }
  let consumed = 0;
  let offset = 0;
  let result = '';
  let styled = false;
  let hyperlink = false;
  for (const match of text.matchAll(ANSI_PATTERN)) {
    const visible = text.slice(offset, match.index);
    const take = Math.min(visible.length, Math.max(0, end - consumed));
    result += visible.slice(0, take);
    consumed += visible.length;
    if (consumed >= end) break;
    result += match[0];
    if (/^\x1b\[/.test(match[0])) styled = true;
    if (/^\x1b\]8;/.test(match[0])) hyperlink = true;
    offset = match.index + match[0].length;
  }
  if (consumed < end) result += text.slice(offset, offset + end - consumed);
  if (hyperlink) result += '\x1b]8;;\x1b\\';
  if (styled) result += '\x1b[0m';
  return result;
};

export const formatCount = (value) => {
  if (!Number.isFinite(value)) return '?';
  return value.toLocaleString();
};

export const padLabel = (label, width) => {
  const safeWidth = Math.max(1, Math.floor(width));
  return padVisible(truncateLine(label, safeWidth), safeWidth);
};

export const padVisible = (text, width) => {
  const value = String(text ?? '');
  const plainLength = displayWidth(value);
  if (plainLength >= width) return value;
  return `${value}${' '.repeat(width - plainLength)}`;
};

export const padVisibleStart = (text, width) => {
  const value = String(text ?? '');
  const plainLength = displayWidth(value);
  if (plainLength >= width) return value;
  return `${' '.repeat(width - plainLength)}${value}`;
};

export const truncateLine = (line, width) => {
  if (!line) return '';
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 80;
  const text = sanitizeDisplayText(line);
  if (displayWidth(text) <= safeWidth) return text;
  if (safeWidth <= 3) return sliceDisplayCells(text, safeWidth);
  return `${sliceDisplayCells(text, safeWidth - 3)}...`;
};

export const formatDurationShort = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.max(1, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

export const resolveRateUnit = (task) => {
  const rawUnit = typeof task?.unit === 'string' ? task.unit.trim().toLowerCase() : '';
  if (rawUnit) return rawUnit;
  const name = String(task?.name || '').toLowerCase();
  if (name.includes('file')) return 'files';
  if (name.includes('chunk')) return 'chunks';
  if (name.includes('line')) return 'lines';
  if (name.includes('query')) return 'queries';
  if (name.includes('repo')) return 'repos';
  if (name.includes('import')) return 'imports';
  if (name.includes('artifact')) return 'artifacts';
  if (name.includes('record')) return 'records';
  if (name.includes('shard')) return 'shards';
  if (name.includes('embedding')) return 'embeddings';
  if (name.includes('download')) return 'downloads';
  return '';
};

export const formatRate = (rate) => {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate >= 1000) {
    const scaled = rate / 1000;
    const value = scaled >= 10 ? Math.round(scaled) : Number(scaled.toFixed(1));
    return `${value}k`;
  }
  if (rate >= 100) return Math.round(rate).toLocaleString();
  if (rate >= 10) return rate.toFixed(1);
  return rate.toFixed(2);
};

export const singularizeUnit = (unit) => {
  if (!unit) return '';
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
};

export const titleCaseUnit = (unit) => {
  if (!unit) return '';
  return String(unit)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join('');
};

export const formatSecondsPerUnit = (seconds, unit) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const safeUnit = titleCaseUnit(singularizeUnit(unit)) || 'Item';
  let value = '';
  if (seconds >= 100) value = Math.round(seconds).toLocaleString();
  else if (seconds >= 10) value = seconds.toFixed(1);
  else if (seconds >= 1) value = seconds.toFixed(2);
  else value = seconds.toFixed(3);
  return `${value}s/${safeUnit}`;
};

export const splitDurationParts = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ms: 0, totalSeconds: 0 };
  }
  if (seconds < 1) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ms: Math.max(1, Math.round(seconds * 1000)), totalSeconds: seconds };
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return { days, hours, minutes, seconds: secs, ms: 0, totalSeconds: seconds };
};

const formatLongDurationPieces = (parts, separator) => {
  const pieces = [];
  if (parts.days > 0) pieces.push(`${parts.days}d`);
  if (parts.hours > 0) pieces.push(`${parts.hours}h`);
  if (parts.minutes > 0) pieces.push(`${parts.minutes}m`);
  if (parts.seconds > 0) pieces.push(`${parts.seconds}s`);
  return pieces.join(separator);
};

export const formatDurationCompact = (parts) => {
  if (parts.ms) return `${parts.ms}ms`;
  if (parts.days > 0 || parts.hours > 0) {
    return formatLongDurationPieces(parts, ' ');
  }
  if (parts.minutes > 0) {
    return parts.seconds > 0 ? `${parts.minutes}m${parts.seconds}s` : `${parts.minutes}m`;
  }
  if (parts.seconds > 0) return `${parts.seconds}s`;
  return '0s';
};

export const formatDurationEtaCompact = (parts) => {
  if (parts.ms) return `${parts.ms}ms`;
  if (parts.days > 0 || parts.hours > 0) {
    return formatLongDurationPieces(parts, '');
  }
  if (parts.minutes > 0) {
    if (parts.seconds > 0) {
      const spacer = parts.minutes >= 10 ? ' ' : '';
      return `${parts.minutes}m${spacer}${parts.seconds}s`;
    }
    return parts.minutes >= 10 ? `${parts.minutes}m   ` : `${parts.minutes}m`;
  }
  if (parts.seconds > 0) return `${parts.seconds}s`;
  return '0s';
};

export const formatDurationAligned = (parts, layout) => {
  const cols = [];
  if (layout.days > 0) {
    cols.push(parts.days > 0 ? `${parts.days}d` : '');
  }
  if (layout.hours > 0) {
    cols.push(parts.hours > 0 ? `${parts.hours}h` : '');
  }
  if (layout.minutes > 0) {
    const showZero = parts.minutes === 0 && parts.seconds > 0 && parts.hours > 0;
    cols.push((parts.minutes > 0 || showZero) ? `${parts.minutes}m` : '');
  }
  if (layout.seconds > 0) {
    let value = '';
    if (parts.ms) value = `${parts.ms}ms`;
    else if (parts.seconds > 0) value = `${parts.seconds}s`;
    cols.push(value);
  }
  const padded = cols.map((value, index) => {
    const width = layout.widths[index] || 0;
    if (!width) return value;
    return padVisibleStart(value, width);
  });
  return padded.join(' ').trimEnd();
};
