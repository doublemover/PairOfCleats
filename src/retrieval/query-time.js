/** Parse modification filters against one caller-owned request clock. */
export function parseModifiedArgs(afterArg, sinceArg, now = Date.now()) {
  let modifiedAfter = null;
  let modifiedSinceDays = null;
  if (afterArg !== undefined && afterArg !== null) {
    const parsed = Date.parse(String(afterArg));
    if (!Number.isFinite(parsed)) throw new Error(`Invalid --modified-after value: ${afterArg}`);
    modifiedAfter = parsed;
  }
  if (sinceArg !== undefined && sinceArg !== null) {
    const parsed = Number(sinceArg);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --modified-since value: ${sinceArg}`);
    modifiedSinceDays = parsed;
    const sinceMs = now - (parsed * 24 * 60 * 60 * 1000);
    modifiedAfter = modifiedAfter == null ? sinceMs : Math.max(modifiedAfter, sinceMs);
  }
  return { modifiedAfter, modifiedSinceDays };
}
