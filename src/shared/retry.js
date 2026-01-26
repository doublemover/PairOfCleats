const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retryWithBackoff({
  task,
  shouldStop = () => false,
  baseMs = 50,
  maxMs = 2000,
  maxWaitMs = 15000,
  logIntervalMs = 5000,
  onLog = null,
  onRetry = null
} = {}) {
  const started = Date.now();
  let attempt = 0;
  let lastLog = 0;

  while (!shouldStop()) {
    const result = await task({ attempt });
    if (result) return result;

    const now = Date.now();
    if (attempt === 0 && typeof onLog === 'function') {
      onLog({ attempt, elapsedMs: now - started, initial: true });
      lastLog = now;
    } else if (logIntervalMs && typeof onLog === 'function' && now - lastLog >= logIntervalMs) {
      onLog({ attempt, elapsedMs: now - started, initial: false });
      lastLog = now;
    }

    if (typeof onRetry === 'function') {
      onRetry({ attempt, elapsedMs: now - started });
    }

    const base = Math.min(maxMs, baseMs * (2 ** attempt));
    const jitter = base * (0.3 + Math.random() * 0.4);
    const delay = Math.min(maxMs, Math.floor(base + jitter));
    await sleep(delay);
    attempt += 1;

    if (maxWaitMs && Date.now() - started >= maxWaitMs) return null;
  }

  return null;
}
