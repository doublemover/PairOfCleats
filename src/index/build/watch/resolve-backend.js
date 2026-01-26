import { getCapabilities } from '../../../shared/capabilities.js';
import { getEnvConfig } from '../../../shared/env.js';

const normalizeBackend = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const resolveWatcherBackend = ({ runtime, pollMs }) => {
  const envConfig = getEnvConfig();
  const configBackend = normalizeBackend(runtime?.userConfig?.indexing?.watch?.backend);
  const envBackend = normalizeBackend(envConfig.watcherBackend);
  const requested = configBackend || envBackend || 'auto';
  const caps = getCapabilities();
  const pollingEnabled = Number.isFinite(Number(pollMs)) && Number(pollMs) > 0;
  let resolved = requested;
  let warning = null;

  if (requested === 'auto') {
    resolved = caps.watcher.parcel && !pollingEnabled ? 'parcel' : 'chokidar';
  } else if (requested === 'parcel') {
    if (!caps.watcher.parcel) {
      resolved = 'chokidar';
      warning = 'Parcel watcher unavailable; falling back to chokidar.';
    } else if (pollingEnabled) {
      resolved = 'chokidar';
      warning = 'Polling requires chokidar; falling back.';
    }
  } else if (requested !== 'chokidar') {
    resolved = 'chokidar';
  }

  return { requested, resolved, warning, pollingEnabled };
};
