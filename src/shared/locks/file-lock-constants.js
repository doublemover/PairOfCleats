export const DEFAULT_FILE_LOCK_WAIT_MS = 0;
export const DEFAULT_FILE_LOCK_POLL_MS = 100;
export const DEFAULT_FILE_LOCK_STALE_MS = 30 * 60 * 1000;

export const DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS = 2000;
export const INVALID_LOCK_RECLAIM_GRACE_MS_DEFAULT = 5000;
export const INVALID_LOCK_RECLAIM_GRACE_MS_MAX = 60000;

export const RESERVED_LOCK_METADATA_KEYS = new Set(['pid', 'lockId', 'startedAt']);
export const DISALLOWED_LOCK_METADATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
export const BENIGN_STALE_REMOVAL_RACE_CODES = new Set(['ENOENT', 'ENOTDIR']);
