import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { historyError, resolveLimits } from './common.js';

const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid or unsupported conversation archive.');
const limited = () => historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Conversation archive exceeded a resource limit.');

/** Parse a top-level array one bounded object at a time, never buffering a shard. */
export async function parseConversationArray(stream, { limits, check, onConversation }) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let state = 'start';
  let raw = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let ordinal = 0;
  let first = true;
  const consume = async (text) => {
    for (const char of text) {
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (state === 'object') {
        raw += char;
        if (raw.length > limits.maxConversationBytes) throw limited();
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{' || char === '[') depth += 1;
        else if (char === '}' || char === ']') depth -= 1;
        if (depth > limits.maxDepth) throw limited();
        if (!depth) {
          if (Buffer.byteLength(raw) > limits.maxConversationBytes) throw limited();
          let conversation;
          try { conversation = JSON.parse(raw); } catch { throw invalid(); }
          await onConversation(conversation, { ordinal, raw });
          ordinal += 1;
          raw = '';
          state = 'separator';
          check();
        }
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\r' || char === '\n') continue;
      if (state === 'start' && char === '[') { state = 'first'; continue; }
      if ((state === 'first' || state === 'value') && char === '{') {
        state = 'object'; raw = '{'; depth = 1; continue;
      }
      if ((state === 'first' || state === 'separator') && char === ']') { state = 'done'; continue; }
      if (state === 'separator' && char === ',') { state = 'value'; continue; }
      throw invalid();
    }
  };
  try {
    for await (const chunk of stream) { check(); await consume(decoder.decode(chunk, { stream: true })); }
    await consume(decoder.decode());
  } catch (error) {
    if (error?.code?.startsWith('ERR_INFERENCE_HISTORY_')) throw error;
    throw invalid();
  }
  if (state !== 'done') throw invalid();
  return ordinal;
}

function safeMemberName(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096
    || /[\\:\u0000-\u001f]/u.test(raw) || raw.startsWith('/')) throw invalid();
  const name = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (name.split('/').some((part) => !part || part === '.' || part === '..')) throw invalid();
  return name;
}

/**
 * Read only. No member is extracted, executed, decoded as media or sent remotely.
 * The caller receives raw conversation objects and a checksum-bearing inventory.
 * Nested archives are inventoried as unsupported, never silently treated as parsed.
 */
export async function visitChatGptExport({ sourcePath, limits: inputLimits, signal, onArchive, onConversation, onMember }) {
  const limits = resolveLimits(inputLimits);
  const started = performance.now();
  const check = () => {
    if (signal?.aborted) throw historyError('ERR_INFERENCE_HISTORY_ABORTED', 'Conversation import was cancelled.');
    if (performance.now() - started > limits.maxMillis) throw limited();
  };
  let source;
  let zip;
  let activeStream;
  let totalExpanded = 0;
  let conversations = 0;
  let members = 0;
  let unsupportedArchives = 0;
  const seen = new Set();
  const countConversation = async (value, locator) => {
    check();
    if (++conversations > limits.maxConversations) throw limited();
    await onConversation(value, locator);
  };
  const consumeMember = async (stream, member, entry = null) => {
    activeStream = stream;
    const hash = createHash('sha256');
    let checksum = 0;
    let bytes = 0;
    const measured = async function* () {
      for await (const chunk of stream) {
        check(); bytes += chunk.length; totalExpanded += chunk.length;
        if (bytes > limits.maxMemberBytes || totalExpanded > limits.maxExpandedBytes) throw limited();
        hash.update(chunk); checksum = crc32(chunk, checksum);
        yield chunk;
      }
    };
    if (member.kind === 'conversations') {
      await parseConversationArray(measured(), {
        limits, check,
        onConversation: (value, locator) => countConversation(value, { ...locator, member: member.name })
      });
    } else {
      for await (const _chunk of measured()) { /* Inventory without buffering assets. */ }
    }
    if (entry && (bytes !== entry.uncompressedSize || checksum !== entry.crc32)) throw invalid();
    await onMember({ ...member, bytes, sha256: hash.digest('hex') });
    activeStream = null;
  };
  try {
    source = await fsPromises.open(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const initial = await source.stat();
    if (!initial.isFile() || initial.size > limits.maxArchiveBytes) throw limited();
    const archiveHash = createHash('sha256');
    let archiveBytes = 0;
    for await (const chunk of source.createReadStream({ autoClose: false, start: 0 })) {
      check(); archiveBytes += chunk.length;
      if (archiveBytes > limits.maxArchiveBytes) throw limited();
      archiveHash.update(chunk);
    }
    const archiveSha256 = archiveHash.digest('hex');
    if (onArchive && await onArchive(archiveSha256) === false) return { archiveSha256, skipped: true };
    const header = Buffer.alloc(4);
    await source.read(header, 0, 4, 0);
    if (header[0] === 0x50 && header[1] === 0x4b) {
      zip = await new Promise((resolve, reject) => {
        yauzl.fromFd(source.fd, { lazyEntries: true, autoClose: false, strictFileNames: true },
          (error, value) => error ? reject(error) : resolve(value));
      });
      await new Promise((resolve, reject) => {
        const fail = (error) => { activeStream?.destroy(); zip.close(); reject(error); };
        zip.on('error', fail);
        zip.on('end', resolve);
        zip.on('entry', (entry) => {
          (async () => {
            check();
            if (++members > limits.maxEntries) throw limited();
            const name = safeMemberName(entry.fileName);
            const normalized = name.normalize('NFKC').toLowerCase();
            if (seen.has(normalized)) throw invalid();
            seen.add(normalized);
            const type = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (type && type !== 0o100000 && type !== 0o040000) throw invalid();
            if ((entry.generalPurposeBitFlag & 1) || ![0, 8].includes(entry.compressionMethod)) throw invalid();
            if (entry.uncompressedSize > limits.maxMemberBytes
              || totalExpanded + entry.uncompressedSize > limits.maxExpandedBytes) throw limited();
            if (entry.fileName.endsWith('/')) {
              if (entry.uncompressedSize) throw invalid();
              await onMember({ name, kind: 'directory', bytes: 0, sha256: null });
              return;
            }
            const kind = /(?:^|\/)conversations(?:[-_]\d+)?\.json$/i.test(name) ? 'conversations'
              : /\.(?:zip|tar|gz|7z)$/i.test(name) ? 'unsupported_archive' : 'asset_or_unknown';
            if (kind === 'unsupported_archive') unsupportedArchives += 1;
            const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry,
              (error, value) => error ? rejectStream(error) : resolveStream(value)));
            await consumeMember(stream, { name, kind }, entry);
          })().then(() => zip.readEntry(), fail);
        });
        zip.readEntry();
      });
    } else {
      members = 1;
      await consumeMember(source.createReadStream({ autoClose: false, start: 0 }), {
        name: 'conversations.json', kind: 'conversations'
      });
    }
    check();
    const final = await source.stat();
    if (initial.size !== final.size || initial.mtimeMs !== final.mtimeMs || initial.ctimeMs !== final.ctimeMs) throw invalid();
    if (!conversations) throw invalid();
    return { archiveSha256, members, conversations, unsupportedArchives, complete: unsupportedArchives === 0 };
  } catch (error) {
    if (error?.code?.startsWith('ERR_INFERENCE_HISTORY_')) throw error;
    throw invalid();
  } finally {
    activeStream?.destroy();
    try { zip?.close(); } catch {}
    await source?.close().catch(() => {});
  }
}
