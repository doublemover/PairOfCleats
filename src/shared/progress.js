/**
 * Write a simple progress line to stderr.
 * @param {string} step
 * @param {number} i
 * @param {number} total
 */
export function showProgress(step, i, total) {
  const pct = ((i / total) * 100).toFixed(1);
  process.stderr.write(`\r${step.padEnd(40)} ${i}/${total} (${pct}%)`.padEnd(70));
  if (i === total) process.stderr.write('\n');
}

/**
 * Write a log message to stderr.
 * @param {string} msg
 */
export function log(msg) {
  process.stderr.write(`\n${msg}\n`);
}
