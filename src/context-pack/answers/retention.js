import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { getRepoRoot, getRepoCacheRoot } from '../../shared/repo-paths.js';
import { throwIfAborted } from '../../shared/abort.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../shared/contained-file.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { withFileLock } from '../../shared/locks/file-lock.js';
import { isLocalProcessDefinitelyDead, removeLockFileSyncIfOwned } from '../../shared/locks/file-lock-info.js';
import { isKnownRepoAccessOwner } from '../../shared/cache/repo-access-owner.js';
import { withStorageDirectory } from '../../shared/storage/directory.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { ANSWER_RETENTION_SCHEMAS, ANSWER_RETENTION_VERSION, ANSWER_RETENTION_MAX_OBJECTS,
  ANSWER_RETENTION_MAX_SLOTS, ANSWER_RETENTION_MAX_BYTES } from '../../contracts/schemas/answer-retention.js';
import { assertAnswerRetention } from '../../contracts/validators/answer-retention.js';
import { ANSWER_MAX_BYTES } from './render.js';
import { buildRetainedAnswerGraph, readRetainedAnswerGraph, retainedAnswerBytes, retainedAnswerHash } from './retention-graph.js';

const version = ANSWER_RETENTION_VERSION;
const hashPattern = /^[a-f0-9]{64}$/;
const MAX_HEAD_BYTES = 4096;
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_ANSWER_RETENTION_' + suffix });
const same = (a, b) => retainedAnswerBytes(a) === retainedAnswerBytes(b);
const errorCode = error => {
  const observation = observeStorageResource(error, { phase: 'answer-retention-error' }); observation.requireSettled();
  let code;
  try { code = error?.code; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return code;
};
const capture = (kind, value) => assertAnswerRetention(kind, captureSemanticRequest(value, ANSWER_RETENTION_SCHEMAS[kind]));
const ordinary = stat => {
  const size = Number(stat.size);
  if (!stat.isFile() || ![1, 1n].includes(stat.nlink) || !Number.isSafeInteger(size) || size < 0) {
    throw fail('INTEGRITY', 'Retained answer requires an ordinary single-link file.');
  }
  return size;
};

/** Explicitly opt-in derived artifacts under the existing admitted repo cache.
 * No automatic pruning, age-based lock stealing or source-truth reuse. The
 * existing atomic descriptor, directory, lock and repo lease owners retain all
 * actual native work; this adapter never invents a release capability.
 */
export const createRetainedAnswerStore = ({ repoRoot, userConfig = null } = {}) => {
  const repositoryNamespace = getRepoRoot(repoRoot), cacheRoot = getRepoCacheRoot(repositoryNamespace, userConfig);
  const root = path.join(cacheRoot, 'answers-v1'), objectsRoot = path.join(root, 'objects'), slotsRoot = path.join(root, 'slots');
  const lockPath = path.join(cacheRoot, '.answers-v1.write.lock');
  const markerPath = path.join(root, 'marker.json');
  const marker = { schemaVersion: version, kind: 'retained-answers', repositoryNamespace };
  const authorize = target => assertNoSymlinkPath(cacheRoot, target, { allowMissing: true });
  const headPath = questionId => path.join(slotsRoot, retainedAnswerHash('answer-slot-v1\0' + questionId) + '.json');
  const objectPath = hash => {
    if (typeof hash !== 'string' || !hashPattern.test(hash)) throw fail('INTEGRITY', 'Invalid retained answer object identity.');
    return path.join(objectsRoot, hash + '.json');
  };
  const readJson = async (target, maxBytes, signal, expectedHash = null) => {
    throwIfAborted(signal); authorize(target);
    const before = await fs.lstat(target, { bigint: true }); ordinary(before);
    const read = await readVerifiedContainedFile(cacheRoot, target, { maxBytes, signal, expectedHash,
      expectedFileIdentity: { dev: String(before.dev), ino: String(before.ino) } });
    ordinary(read.stat);
    let text, value;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(read.buffer); value = JSON.parse(text); }
    catch { throw fail('INTEGRITY', 'Retained answer contains invalid UTF-8 or JSON.'); }
    if (retainedAnswerBytes(value) !== text) throw fail('INTEGRITY', 'Retained answer bytes are not canonical JSON.');
    return value;
  };
  const enumerate = async (directory, visit, limit, signal) => {
    authorize(directory);
    return withStorageDirectory(directory, async reader => {
      let count = 0;
      while (true) {
        throwIfAborted(signal);
        const entry = await reader.read(); if (!entry) break;
        if (++count > limit) throw fail('QUOTA', 'Retained answer inventory exceeds its bounded entry allowance.');
        await visit(entry);
      }
      return count;
    });
  };
  const mkdir = async directory => { authorize(directory); await fs.mkdir(directory, { recursive: true }); authorize(directory); };
  const initialize = async signal => {
    await mkdir(root);
    let found;
    try { found = await readJson(markerPath, 8192, signal); }
    catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      // An unmarked nonempty folder is foreign or interrupted unknown work.
      // Do not adopt it, clean it or rewrite a corrupt marker.
      await enumerate(root, () => { throw fail('INTEGRITY', 'Unmarked retained-answer storage is not empty.'); }, 1, signal);
      await atomicWriteText(markerPath, retainedAnswerBytes(marker), { mkdir: false, createOnly: true, signal });
      found = await readJson(markerPath, 8192, signal);
    }
    assertAnswerRetention('marker', found);
    if (!same(marker, found)) throw fail('INTEGRITY', 'Retained-answer storage belongs to another repository.');
    await mkdir(objectsRoot); await mkdir(slotsRoot);
    await enumerate(root, entry => {
      if (!['marker.json', 'objects', 'slots'].includes(entry.name)
        || (entry.name === 'marker.json' ? !entry.isFile() : !entry.isDirectory())) throw fail('INTEGRITY', 'Unknown retained-answer root entry requires inspection.');
    }, 3, signal);
  };
  const locked = async (action, signal) => {
    throwIfAborted(signal);
    // Admission above retains the existing process lease before root creation.
    assertNoSymlinkPath(path.parse(cacheRoot).root, cacheRoot, { allowMissing: true });
    await fs.mkdir(cacheRoot, { recursive: true }); authorize(lockPath);
    let entered = false;
    const result = await withFileLock({ lockPath, createParent: false, waitMs: 5000, staleMs: Number.MAX_SAFE_INTEGER, signal,
      metadata: { scope: 'answer-retention', hostname: os.hostname() },
      staleRemovalImpl: async ({ lockPath: candidate, info }) => ({ removed: Boolean(isKnownRepoAccessOwner(info)
        && info.scope === 'answer-retention' && isLocalProcessDefinitelyDead(info.pid) && removeLockFileSyncIfOwned(candidate, info)), removalMode: 'owner' }) }, async () => {
      entered = true; throwIfAborted(signal); authorize(lockPath); await initialize(signal); return action();
    });
    if (!entered) throw fail('BUSY', 'Retained answers are owned by another or unsettled writer.');
    return result;
  };
  const readHead = async (questionId, signal) => {
    let head;
    try { head = assertAnswerRetention('head', await readJson(headPath(questionId), MAX_HEAD_BYTES, signal)); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; return null; }
    if (head.questionId !== questionId || (head.current && head.current.questionRef.id !== questionId)
      || (head.pending && (head.pending.questionRef.id !== questionId || head.pending.epoch !== head.epoch))) throw fail('INTEGRITY', 'Retained answer head identities disagree.');
    return head;
  };
  const inventory = async signal => {
    let bytes = 0;
    const objects = new Map();
    await enumerate(objectsRoot, async entry => {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name) || !entry.isFile()) throw fail('INTEGRITY', 'Unknown retained-answer object entry requires inspection.');
      const target = path.join(objectsRoot, entry.name); authorize(target);
      const stat = await fs.lstat(target, { bigint: true }), size = ordinary(stat);
      if (size > 2 * ANSWER_MAX_BYTES) throw fail('INTEGRITY', 'Retained answer object exceeds its format allowance.');
      bytes += size;
      if (bytes > ANSWER_RETENTION_MAX_BYTES) throw fail('QUOTA', 'Retained answer encoded payload quota is exhausted.');
      objects.set(entry.name.slice(0, -5), size);
    }, ANSWER_RETENTION_MAX_OBJECTS, signal);
    const slots = await enumerate(slotsRoot, async entry => {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name) || !entry.isFile()) throw fail('INTEGRITY', 'Unknown retained-answer slot entry requires inspection.');
      const target = path.join(slotsRoot, entry.name); authorize(target);
      const stat = await fs.lstat(target, { bigint: true });
      if (ordinary(stat) > MAX_HEAD_BYTES) throw fail('INTEGRITY', 'Retained answer head exceeds its format allowance.');
    }, ANSWER_RETENTION_MAX_SLOTS, signal);
    return { objects, bytes, slots };
  };
  const writeHead = async (head, previous, signal) => {
    assertAnswerRetention('head', head);
    const payload = retainedAnswerBytes(head);
    if (Buffer.byteLength(payload) > MAX_HEAD_BYTES) throw fail('QUOTA', 'Retained answer head exceeds its byte allowance.');
    const target = headPath(head.questionId); authorize(target);
    await atomicWriteText(target, payload, { mkdir: false, signal, createOnly: previous === null, beforeCommit: async () => {
      throwIfAborted(signal); authorize(target);
      if (!same(await readHead(head.questionId, signal), previous)) throw fail('CONFLICT', 'Retained answer base changed before atomic publication.');
    } });
  };
  const readObject = (hash, signal) => readJson(objectPath(hash), 2 * ANSWER_MAX_BYTES, signal, hash);
  const readAnswer = (current, signal) => readRetainedAnswerGraph(current, hash => readObject(hash, signal), { signal });
  return Object.freeze({
    /** A serialized intent is resumable in a fresh process while it is still
     * the exact current intent. It grants no source-expansion permission. */
    begin: async (input, { signal = null } = {}) => {
      const request = capture('begin', input);
      return locked(async () => {
        const head = await readHead(request.questionRef.id, signal);
        if ((head?.current?.answerDigest ?? null) !== request.expectedBaseDigest) throw fail('CONFLICT', 'Retained answer expected base differs from the published answer.');
        const counts = await inventory(signal);
        if (!head && counts.slots === ANSWER_RETENTION_MAX_SLOTS) throw fail('QUOTA', 'Retained answer question-slot quota is exhausted.');
        const epoch = (head?.epoch ?? 0) + 1;
        if (!Number.isSafeInteger(epoch)) throw fail('QUOTA', 'Retained answer intent generation is exhausted.');
        const pending = { epoch, intentId: randomUUID(), ...request };
        await writeHead({ schemaVersion: version, kind: 'retained-answer-head', questionId: request.questionRef.id,
          epoch, current: head?.current ?? null, pending }, head, signal);
        return capture('intent', pending);
      }, signal);
    },
    commit: async (input, answer, { signal = null } = {}) => {
      const intent = capture('intent', input), graph = buildRetainedAnswerGraph(answer, { signal });
      if (!same(intent.questionRef, graph.answer.questionRef) || intent.worldId !== graph.answer.worldId
        || graph.answer.world.repositoryNamespace !== repositoryNamespace) throw fail('CONFLICT', 'Retained answer differs from the requested question, world or repository.');
      return locked(async () => {
        const head = await readHead(intent.questionRef.id, signal);
        const next = { answerDigest: graph.answer.digest, manifestHash: graph.manifestHash, questionRef: graph.answer.questionRef, worldId: graph.answer.worldId };
        // Exact replay after successful head publication is idempotent, even
        // when the original caller lost its delivery. Never replay query work.
        if (head && !head.pending && head.epoch === intent.epoch && same(head.current, next)) {
          await readAnswer(head.current, signal); return { ...next, epoch: head.epoch };
        }
        if (!head || !same(head.pending, intent) || (head.current?.answerDigest ?? null) !== intent.expectedBaseDigest) throw fail('CONFLICT', 'A newer answer request superseded this result.');
        const counts = await inventory(signal), additions = [...graph.objects].filter(([hash]) => !counts.objects.has(hash));
        const additionBytes = additions.reduce((sum, [, bytes]) => sum + Buffer.byteLength(bytes), 0);
        if (counts.objects.size + additions.length > ANSWER_RETENTION_MAX_OBJECTS || counts.bytes + additionBytes > ANSWER_RETENTION_MAX_BYTES) {
          throw fail('QUOTA', 'Retained answer object/encoded-payload quota is exhausted; the previous answer remains intact.');
        }
        for (const [hash, payload] of graph.objects) {
          throwIfAborted(signal);
          if (counts.objects.has(hash)) {
            if (retainedAnswerBytes(await readObject(hash, signal)) !== payload) throw fail('INTEGRITY', 'Existing immutable answer object differs.');
          } else {
            const target = objectPath(hash); authorize(target);
            await atomicWriteText(target, payload, { mkdir: false, createOnly: true, signal, beforeCommit: () => { authorize(target); } });
          }
        }
        throwIfAborted(signal);
        await writeHead({ ...head, current: next, pending: null }, head, signal);
        return { ...next, epoch: head.epoch };
      }, signal);
    },
    resume: async (input, { signal = null } = {}) => {
      const intent = capture('intent', input);
      return locked(async () => {
        const head = await readHead(intent.questionRef.id, signal);
        if (!head || !same(head.pending, intent) || (head.current?.answerDigest ?? null) !== intent.expectedBaseDigest) {
          throw fail('CONFLICT', 'Retained answer intent is unavailable or superseded.');
        }
        return capture('intent', head.pending);
      }, signal);
    },
    read: async (questionRef, { signal = null } = {}) => {
      // Capture only the original ID; callers cannot select a cache path.
      const request = capture('begin', { questionRef, worldId: '0'.repeat(64), expectedBaseDigest: null });
      return locked(async () => {
        const head = await readHead(request.questionRef.id, signal);
        const answer = head?.current ? await readAnswer(head.current, signal) : null;
        return { answer, pending: head?.pending ?? null, epoch: head?.epoch ?? 0,
          status: head?.pending ? 'refresh-pending' : answer ? 'historical-answer' : 'empty',
          currentSourceAdmission: 'not-established-by-retention' };
      }, signal);
    }
  });
};
