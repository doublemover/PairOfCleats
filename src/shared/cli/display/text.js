const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export const stripAnsi = (value) => String(value || '').replace(ANSI_PATTERN, '');

export const formatCount = (value) => {
  if (!Number.isFinite(value)) return '?';
  return value.toLocaleString();
};

export const padLabel = (label, width) => {
  const safeWidth = Math.max(1, Math.floor(width));
  const plain = stripAnsi(label);
  if (plain.length === safeWidth) return label;
  if (plain.length < safeWidth) return `${label}${' '.repeat(safeWidth - plain.length)}`;
  if (safeWidth <= 3) return plain.slice(0, safeWidth);
  return `${plain.slice(0, safeWidth - 3)}...`;
};

export const padVisible = (text, width) => {
  const value = String(text ?? '');
  const plainLength = stripAnsi(value).length;
  if (plainLength >= width) return value;
  return `${value}${' '.repeat(width - plainLength)}`;
};

export const padVisibleStart = (text, width) => {
  const value = String(text ?? '');
  const plainLength = stripAnsi(value).length;
  if (plainLength >= width) return value;
  return `${' '.repeat(width - plainLength)}${value}`;
};

export const truncateLine = (line, width) => {
  if (!line) return '';
  const safeWidth = Math.max(1, Math.floor(width));
  const plain = stripAnsi(line);
  if (plain.length <= safeWidth) return line;
  if (safeWidth <= 3) return plain.slice(0, safeWidth);
  return `${plain.slice(0, safeWidth - 3)}...`;
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

export const formatDurationCompact = (parts) => {
  if (parts.ms) return `${parts.ms}ms`;
  if (parts.days > 0 || parts.hours > 0) {
    const pieces = [];
    if (parts.days > 0) pieces.push(`${parts.days}d`);
    if (parts.hours > 0) pieces.push(`${parts.hours}h`);
    if (parts.minutes > 0) pieces.push(`${parts.minutes}m`);
    if (parts.seconds > 0) pieces.push(`${parts.seconds}s`);
    return pieces.join(' ');
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
    const pieces = [];
    if (parts.days > 0) pieces.push(`${parts.days}d`);
    if (parts.hours > 0) pieces.push(`${parts.hours}h`);
    if (parts.minutes > 0) pieces.push(`${parts.minutes}m`);
    if (parts.seconds > 0) pieces.push(`${parts.seconds}s`);
    return pieces.join('');
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
