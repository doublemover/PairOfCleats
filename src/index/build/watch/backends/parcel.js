import { tryRequire } from '../../../../shared/optional-deps.js';

const mapParcelEvent = (type) => {
  if (type === 'create') return 'add';
  if (type === 'update') return 'change';
  if (type === 'delete') return 'unlink';
  return null;
};

export async function startParcelWatcher({ root, ignored, onEvent, onError }) {
  const result = tryRequire('@parcel/watcher');
  if (!result.ok || !result.mod) {
    throw new Error('Parcel watcher not available.');
  }
  const { subscribe } = result.mod;
  if (typeof subscribe !== 'function') {
    throw new Error('Parcel watcher does not expose subscribe().');
  }
  const ignoredFn = typeof ignored === 'function' ? ignored : null;
  const ignoreList = Array.isArray(ignored) ? ignored : null;
  const unsubscribe = await subscribe(
    root,
    (err, events) => {
      if (err) {
        onError?.(err);
        return;
      }
      if (!Array.isArray(events)) return;
      for (const entry of events) {
        const mapped = mapParcelEvent(entry?.type);
        if (!mapped) continue;
        const absPath = entry?.path;
        if (!absPath) continue;
        if (ignoredFn && ignoredFn(absPath)) continue;
        onEvent({ type: mapped, absPath });
      }
    },
    ignoreList ? { ignore: ignoreList } : {}
  );
  return {
    close: async () => {
      if (typeof unsubscribe === 'function') {
        await unsubscribe();
      }
    }
  };
}
