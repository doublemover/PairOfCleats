/**
 * Write a simple progress line to stderr.
 * @param {string} step
 * @param {number} i
 * @param {number} total
 */
let lastProgressActive = false;
let lastProgressWidth = 0;

function clearProgressLine() {
  if (!lastProgressActive || !process.stderr.isTTY) return;
  const width = Math.max(0, lastProgressWidth);
  if (width > 0) {
    process.stderr.write(`\r${' '.repeat(width)}\r`);
  }
  lastProgressActive = false;
  lastProgressWidth = 0;
}

export function showProgress(step, i, total) {
  const pct = ((i / total) * 100).toFixed(1);
  const line = `${step} ${i}/${total} (${pct}%)`;
  const isTty = process.stderr.isTTY;
  if (isTty) {
    process.stderr.write(`\r${line}\x1b[K`);
    lastProgressActive = true;
    lastProgressWidth = line.length;
    if (i === total) {
      process.stderr.write('\n');
      lastProgressActive = false;
      lastProgressWidth = 0;
    }
  } else {
    process.stderr.write(`${line}\n`);
    lastProgressActive = false;
    lastProgressWidth = 0;
  }
}

/**
 * Write a log message to stderr.
 * @param {string} msg
 */
export function log(msg) {
  clearProgressLine();
  process.stderr.write(`\n${msg}\n`);
}

/**
 * Write a single log line to stderr without extra spacing.
 * @param {string} msg
 */
export function logLine(msg) {
  clearProgressLine();
  process.stderr.write(`${msg}\n`);
}
