/**
 * @typedef {'add'|'change'|'unlink'} WatchEventType
 * @typedef {{ type: WatchEventType, absPath: string }} WatchEvent
 * @typedef {{
 *  root: string,
 *  ignored: (path: string, stats?: any) => boolean,
 *  onEvent: (event: WatchEvent) => void,
 *  onError?: (error: Error) => void,
 *  pollMs?: number
 * }} WatchBackendOptions
 * @typedef {{ close: () => Promise<void> }} WatchBackendHandle
 */

export const WATCH_EVENT_TYPES = ['add', 'change', 'unlink'];
