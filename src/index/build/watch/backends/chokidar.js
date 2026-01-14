import chokidar from 'chokidar';

export function startChokidarWatcher({ root, ignored, onEvent, onError, pollMs, awaitWriteFinishMs }) {
  const pollingEnabled = Number.isFinite(Number(pollMs)) && Number(pollMs) > 0;
  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    ignored,
    usePolling: pollingEnabled,
    interval: pollingEnabled ? Number(pollMs) : undefined,
    binaryInterval: pollingEnabled ? Number(pollMs) : undefined,
    awaitWriteFinish: awaitWriteFinishMs
      ? {
        stabilityThreshold: awaitWriteFinishMs,
        pollInterval: pollingEnabled ? Math.min(100, Number(pollMs)) : 100
      }
      : false
  });
  const emit = (type) => (filePath) => onEvent({ type, absPath: filePath });
  watcher.on('add', emit('add'));
  watcher.on('change', emit('change'));
  watcher.on('unlink', emit('unlink'));
  watcher.on('error', (err) => onError?.(err));
  return {
    close: () => watcher.close()
  };
}
