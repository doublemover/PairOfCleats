import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PROGRESS_PROTOCOL, parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { assertTuiRecordingRequest } from '../../../src/contracts/validators/tui-recording.js';

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;
const MAX_FRAMES = 32768;
// Leave room for the existing internal-operation envelope below its 1 MiB cap.
const MAX_EVENT_BYTES = 512 * 1024;
const MAX_PAGE_BYTES = 768 * 1024;
const MAX_ENTRIES = 64;
const MAX_DIRECTORY_ENTRIES = 512;
const MAX_SESSIONS = 2;
const MAX_DEPTH = 64;
const MAX_VALUE_NODES = 262144;
const filenamePattern = /^[^/\\\u0000-\u001f<>:"|?*]{1,200}\.jsonl$/u;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const objectIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameObject = (stat, identity) => String(stat.dev) === identity.dev && String(stat.ino) === identity.ino;
const requireDirectory = async selected => {
  const stat = await fs.lstat(selected.directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameObject(stat, selected.identity)) {
    fail('ERR_TUI_RECORDING_STALE', 'The selected recording directory changed. Choose it again.');
  }
};

const readMetadata = async (directory, filename, signal) => {
  const file = path.join(directory, filename.replace(/\.jsonl$/, '.meta.json'));
  const read = await readVerifiedContainedFile(directory, file, { maxBytes: MAX_META_BYTES, signal });
  let metadata;
  try { metadata = JSON.parse(read.buffer.toString('utf8')); }
  catch { fail('ERR_TUI_RECORDING_METADATA', 'The recording metadata is invalid JSON.'); }
  if (metadata?.schemaVersion !== 1 || metadata.protocol !== PROGRESS_PROTOCOL
    || metadata.supervisorProtocol !== 'poc.tui@1') {
    fail('ERR_TUI_RECORDING_VERSION', 'Unsupported recording metadata schema or protocol version.');
  }
  if (typeof metadata.runId !== 'string' || !metadata.runId || metadata.runId.length > 4096
    || typeof metadata.supervisorVersion !== 'string' || metadata.supervisorVersion.length > 128
    || !validTime(metadata.startedAt) || (metadata.endedAt !== undefined && !validTime(metadata.endedAt))) {
    fail('ERR_TUI_RECORDING_METADATA', 'The recording metadata is incomplete or malformed.');
  }
  // eventLogPath and pid describe the producer; neither grants path or process
  // authority. Only the explicitly selected directory and opaque entry own reads.
  return { hash: read.hash, metadata: { schemaVersion: metadata.schemaVersion, runId: metadata.runId,
    protocol: metadata.protocol, supervisorProtocol: metadata.supervisorProtocol,
    supervisorVersion: metadata.supervisorVersion, startedAt: metadata.startedAt,
    endedAt: metadata.endedAt ?? null, endReason: typeof metadata.endReason === 'string' ? metadata.endReason.slice(0, 256) : null } };
};

const decodeEvents = (buffer, runId, signal) => {
  if (!buffer.length || buffer.at(-1) !== 10) fail('ERR_TUI_RECORDING_TRUNCATED', 'The event log ends with a partial or missing frame.');
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) fail('ERR_TUI_RECORDING_ENCODING', 'The event log is not valid UTF-8.');
  const chunks = new Map(), completed = new Set(), events = [];
  let frames = 0, assembledBytes = 0, eventBytes = 0, valueNodes = 0;
  const append = event => {
    const pending = [{ value: event, depth: 0 }];
    while (pending.length) {
      const { value, depth } = pending.pop();
      if (++valueNodes > MAX_VALUE_NODES || depth > MAX_DEPTH) {
        fail('ERR_TUI_RECORDING_LIMIT', 'The saved data exceeds the native replay structure bound.');
      }
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (bytes > MAX_EVENT_BYTES || (eventBytes += bytes) > MAX_LOG_BYTES) {
      fail('ERR_TUI_RECORDING_LIMIT', 'Recorded logical events exceed the replay byte bound.');
    }
    events.push(event);
  };
  for (const line of text.split('\n').slice(0, -1)) {
    throwIfAborted(signal);
    if (!line.trim()) fail('ERR_TUI_RECORDING_FRAME', 'The event log contains an empty frame.');
    if (++frames > MAX_FRAMES || Buffer.byteLength(line) > 128 * 1024) {
      fail('ERR_TUI_RECORDING_LIMIT', 'The event log exceeds the frame count or frame byte bound.');
    }
    const event = parseProgressEventLine(line, { strict: true });
    if (!event || !Number.isInteger(event.seq) || event.seq < 1) fail('ERR_TUI_RECORDING_FRAME', `Invalid progress frame ${frames}.`);
    if (event.runId !== runId) fail('ERR_TUI_RECORDING_RUN', 'The event log mixes run identities or disagrees with its metadata.');
    if (event.event !== 'event:chunk') { append(event); continue; }
    const { chunkId, chunkIndex, chunkCount, chunk } = event;
    if (typeof chunkId !== 'string' || !chunkId || chunkId.length > 256 || completed.has(chunkId)
      || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 512
      || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkCount || typeof chunk !== 'string') {
      fail('ERR_TUI_RECORDING_CHUNK', 'Malformed or reused event chunk identity.');
    }
    let assembly = chunks.get(chunkId);
    if (!assembly) {
      if (chunks.size >= 64) fail('ERR_TUI_RECORDING_LIMIT', 'Too many unfinished chunked events.');
      assembly = { count: chunkCount, parts: new Map(), bytes: 0, event: event.chunkEvent };
      chunks.set(chunkId, assembly);
    }
    if (assembly.count !== chunkCount || assembly.event !== event.chunkEvent || assembly.parts.has(chunkIndex)) {
      fail('ERR_TUI_RECORDING_CHUNK', 'Conflicting or duplicate event chunks.');
    }
    const bytes = Buffer.byteLength(chunk);
    assembly.bytes += bytes; assembledBytes += bytes;
    if (assembly.bytes > MAX_EVENT_BYTES || assembledBytes > 2 * MAX_EVENT_BYTES) {
      fail('ERR_TUI_RECORDING_LIMIT', 'Unfinished chunked events exceed the replay byte bound.');
    }
    assembly.parts.set(chunkIndex, chunk);
    if (assembly.parts.size === assembly.count) {
      const value = parseProgressEventLine(Array.from({ length: assembly.count }, (_, index) => assembly.parts.get(index)).join(''), { strict: true });
      if (!value || value.event === 'event:chunk' || value.event !== assembly.event || value.runId !== runId
        || !Number.isInteger(value.seq) || value.seq < 1) fail('ERR_TUI_RECORDING_CHUNK', 'The rebuilt event violates its declared identity or protocol.');
      assembledBytes -= assembly.bytes; chunks.delete(chunkId); completed.add(chunkId); append(value);
    }
  }
  if (chunks.size) fail('ERR_TUI_RECORDING_TRUNCATED', 'The event log contains unfinished chunked events.');
  if (!events.length || events[0].event !== 'hello') fail('ERR_TUI_RECORDING_FRAME', 'A supervisor recording must begin with its real hello frame.');
  return { events, frames, eventBytes };
};

/** Read-only saved supervisor logs. Nothing in a recording can become a request. */
export const createTuiRecordings = () => {
  const directories = new Map(), sessions = new Map();
  let disposed = false;
  const active = () => { if (disposed) fail('ERR_TUI_SESSION_CLOSED', 'The recording session has closed.'); };
  const list = async ({ directory, filename = null }, { signal } = {}) => {
    active(); throwIfAborted(signal);
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0') || directory.length > 4096) {
      fail('ERR_TUI_RECORDING_DIRECTORY', 'Choose an absolute recording directory.');
    }
    const canonical = await fs.realpath(directory), stat = await fs.lstat(canonical, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ERR_TUI_RECORDING_DIRECTORY', 'Choose a regular recording directory.');
    if (filename !== null && (typeof filename !== 'string' || !filenamePattern.test(filename))) {
      fail('ERR_TUI_RECORDING_FILE', 'Choose a single recorded JSONL filename.');
    }
    const entries = [], names = [];
    let count = 0;
    if (filename !== null) {
      const selected = await fs.lstat(path.join(canonical, filename));
      if (!selected.isFile() || selected.isSymbolicLink()) fail('ERR_TUI_RECORDING_FILE', 'Choose a regular recording file.');
      names.push(filename);
    } else {
      const handle = await fs.opendir(canonical);
      for await (const entry of handle) {
        throwIfAborted(signal);
        if (++count > MAX_DIRECTORY_ENTRIES) fail('ERR_TUI_RECORDING_LIMIT', 'Choose a directory with at most 512 entries.');
        if (filenamePattern.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) names.push(entry.name);
        if (names.length > MAX_ENTRIES) fail('ERR_TUI_RECORDING_LIMIT', 'Choose a directory with at most 64 recording logs.');
      }
    }
    const privateEntries = new Map();
    for (const filename of names.sort()) {
      const id = randomUUID();
      try {
        const { metadata, hash } = await readMetadata(canonical, filename, signal);
        const log = await fs.lstat(path.join(canonical, filename), { bigint: true });
        if (!log.isFile() || log.isSymbolicLink()) fail('ERR_TUI_RECORDING_FILE', 'Choose a regular recording file.');
        privateEntries.set(id, { filename, metadataHash: hash, fileIdentity: objectIdentity(log) });
        entries.push({ id, filename, valid: true, ...metadata });
      } catch (error) {
        throwIfAborted(signal);
        const errorCode = error.code || 'ERR_TUI_RECORDING_METADATA';
        privateEntries.set(id, { filename, invalidCode: errorCode });
        entries.push({ id, filename, valid: false, errorCode });
      }
    }
    active(); throwIfAborted(signal);
    const selected = { directory: canonical, identity: objectIdentity(stat), entries: privateEntries };
    await requireDirectory(selected);
    const directoryId = randomUUID();
    if (directories.size >= MAX_SESSIONS) directories.delete(directories.keys().next().value);
    directories.set(directoryId, selected);
    return { directoryId, directory: canonical, entries, limits: { maxEntries: MAX_ENTRIES, maxLogBytes: MAX_LOG_BYTES,
      maxFrames: MAX_FRAMES, maxSessions: MAX_SESSIONS, maxDepth: MAX_DEPTH, maxValueNodes: MAX_VALUE_NODES,
      maxEventBytes: MAX_EVENT_BYTES, maxPageBytes: MAX_PAGE_BYTES },
    note: 'Saved logs are passive; recorded capabilities never grant control.' };
  };
  const load = async ({ directoryId, entryId }, { signal } = {}) => {
    active(); throwIfAborted(signal);
    const selected = directories.get(directoryId), entry = selected?.entries.get(entryId);
    if (!entry) fail('ERR_TUI_RECORDING_STALE', 'Choose a valid entry from the current recording picker.');
    if (entry.invalidCode) fail(entry.invalidCode, 'The listed recording is invalid. Choose it again after repair.');
    const { filename } = entry;
    await requireDirectory(selected);
    const before = await readMetadata(selected.directory, filename, signal);
    if (before.hash !== entry.metadataHash) fail('ERR_TUI_RECORDING_STALE', 'The selected metadata changed after listing. Choose it again.');
    const source = path.join(selected.directory, filename);
    const log = await readVerifiedContainedFile(selected.directory, source,
      { maxBytes: MAX_LOG_BYTES, expectedFileIdentity: entry.fileIdentity, signal });
    const decoded = decodeEvents(log.buffer, before.metadata.runId, signal);
    const after = await readMetadata(selected.directory, filename, signal);
    if (before.hash !== after.hash) fail('ERR_TUI_RECORDING_STALE', 'Recording metadata changed while loading. Choose it again.');
    await requireDirectory(selected);
    if (directories.get(directoryId) !== selected) fail('ERR_TUI_RECORDING_STALE', 'The recording directory capability expired during loading. Choose it again.');
    active(); throwIfAborted(signal);
    const recordingId = randomUUID(), identity = digest(`${source}\0${before.hash}\0${log.hash}`);
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    const summary = { recordingId, identity, source, ...before.metadata,
      eventCount: decoded.events.length, frameCount: decoded.frames, bytes: log.buffer.length,
      eventBytes: decoded.eventBytes, mode: 'replay', controllable: false, connection: 'offline',
      note: before.metadata.endedAt ? 'Saved completed supervisor session.' : 'Finite saved snapshot of an unfinished supervisor session.' };
    sessions.set(recordingId, { summary, events: decoded.events });
    return summary;
  };
  const page = ({ recordingId, offset = 0, count = 64 }) => {
    active();
    const session = sessions.get(recordingId);
    if (!session) fail('ERR_TUI_RECORDING_STALE', 'The saved replay expired. Load it again.');
    if (!Number.isInteger(offset) || offset < 0 || offset > session.events.length
      || !Number.isInteger(count) || count < 1 || count > 128) fail('ERR_TUI_RECORDING_PAGE', 'Choose a valid bounded event page.');
    const events = []; let bytes = 0;
    for (const event of session.events.slice(offset, offset + count)) {
      const size = Buffer.byteLength(JSON.stringify(event));
      if (events.length && bytes + size > MAX_PAGE_BYTES) break;
      events.push(structuredClone(event)); bytes += size;
    }
    const nextOffset = offset + events.length;
    return { recordingId, identity: session.summary.identity, runId: session.summary.runId,
      offset, nextOffset: nextOffset < session.events.length ? nextOffset : null, total: session.events.length, bytes, events };
  };
  const discard = ({ recordingId }) => { active(); return { discarded: sessions.delete(recordingId) }; };
  const checked = Object.fromEntries(Object.entries({ list, load, page, discard })
    .map(([name, handler]) => [name, (params, context) => {
      assertTuiRecordingRequest(name, params);
      return handler(params, context);
    }]));
  return { ...checked, dispose: () => { disposed = true; directories.clear(); sessions.clear(); } };
};
