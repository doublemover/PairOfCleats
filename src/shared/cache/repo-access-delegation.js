import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from '../io/atomic-write.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from '../contained-file.js';
import { createLockPayload, readLockInfoSync, removeLockFileSyncIfOwned } from '../locks/file-lock-info.js';
import { repoAccessPaths, registerDelegatedRepoCacheReader } from './repo-access-reader.js';
import { withExclusiveRepoCacheCleanup } from './repo-access.js';
import { inspectRepoCacheDelegation, repoDelegationPath } from './repo-access-delegation-guard.js';

const PROTOCOL = 'pairofcleats-cache-delegation-v1';
const preload = fileURLToPath(new URL('./repo-access-delegation-preload.js', import.meta.url));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const token = () => randomBytes(32).toString('hex');
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const rootObject = root => {
  assertNoSymlinkPath(path.parse(root).root, root);
  const stat = fs.lstatSync(root, { bigint: true });
  if (!stat.isDirectory()) throw new Error('Delegation requires an existing canonical cache directory.');
  return { dev: String(stat.dev), ino: String(stat.ino) };
};
const environmentIdentity = env => digest(Object.entries(env).filter(([key, value]) => value !== undefined
  && !['NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'].includes(key))
  .map(([key, value]) => [process.platform === 'win32' ? key.toUpperCase() : key, String(value)])
  .sort(([a], [b]) => a.localeCompare(b)));
const invocationIdentity = ({ executable, argv, execArgv, cwd, env, commandIdentity }) => digest({
  executable: fs.realpathSync(executable), argv, execArgv, cwd: fs.realpathSync(cwd),
  environmentIdentity: environmentIdentity(env), commandIdentity
});
const mac = (secret, message) => createHmac('sha256', secret).update(JSON.stringify(message)).digest('hex');
const validMac = (secret, message, signature) => typeof signature === 'string' && /^[a-f0-9]{64}$/u.test(signature)
  && timingSafeEqual(Buffer.from(mac(secret, message), 'hex'), Buffer.from(signature, 'hex'));
const send = (channel, message) => new Promise((resolve, reject) => {
  if (!channel.connected || typeof channel.send !== 'function') { reject(new Error('Managed child IPC channel is disconnected.')); return; }
  channel.send(message, error => error ? reject(error) : resolve());
});
const requireLock = (paths, expected) => {
  const lock = readLockInfoSync(paths.lockPath);
  if (!lock || lock.lockId !== expected.lockId || lock.pid !== expected.pid || lock.hostname !== os.hostname()) {
    throw new Error('Delegated exclusion lock identity changed.');
  }
};
const requireRecord = (paths, expected) => {
  const record = inspectRepoCacheDelegation(paths);
  if (!record.value || digest(record.value) !== digest(expected)) throw new Error('Delegated owner record changed or is unreadable.');
  requireLock(paths, { lockId: expected.cleanupLockId, pid: expected.parentPid });
  if (digest(rootObject(paths.root)) !== digest(expected.rootIdentity)) throw new Error('Delegated canonical root object changed.');
  return record;
};
const pendingError = (message, controller, cause) => Object.assign(new Error(message, { cause }), {
  code: 'ERR_REPO_CACHE_DELEGATION_PENDING', cacheOwnershipPending: true, delegationSession: controller
});

/** Owns the real ChildProcess and its IPC channel. The import gate executes
 * before the requested entry module and its canonical cache-path resolvers.
 * No timeout, signal request, disconnect or fulfilled command promise settles
 * ownership. The parent reader is restored, still suspended, on pending errors.
 */
export const startDelegatedRepoCacheOwner = async (root, { localAccessHandoff, resourceId, commandIdentity,
  entry, args = [], cwd = process.cwd(), env = process.env, coordinationRoot = null, stdio = ['ignore', 'pipe', 'pipe'] } = {}) => {
  if (!localAccessHandoff || !bounded(resourceId) || !bounded(commandIdentity) || !path.isAbsolute(entry || '')
    || !Array.isArray(args) || args.some(arg => typeof arg !== 'string') || args.length > 1024
    || !Array.isArray(stdio) || stdio.length !== 3 || stdio.includes('ipc')) {
    throw new TypeError('Delegation requires a drained retained reader, exact resource/command, absolute Node entry and three stdio channels.');
  }
  if (Object.entries(env).some(([key, value]) => key.toUpperCase() === 'NODE_OPTIONS' && String(value || '').trim())) {
    throw new Error('Delegated child requires an explicit environment without NODE_OPTIONS; import/require hooks could run before the admission gate.');
  }
  if (coordinationRoot && path.basename(path.dirname(path.resolve(root))).toLowerCase() === 'repos') {
    throw new Error('Canonical repository children must use the established default reader coordination directory.');
  }
  const paths = repoAccessPaths(root, { coordinationRoot });
  const identity = rootObject(paths.root);
  const execArgv = ['--import', preload];
  const argv = [fs.realpathSync(entry), ...args];
  const invocationId = invocationIdentity({ executable: process.execPath, argv, execArgv, cwd, env, commandIdentity });
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const lifetime = withExclusiveRepoCacheCleanup(root, async context => {
    const { lock } = context;
    const sessionId = randomUUID();
    const secret = token();
    let record = { schemaVersion: 1, protocol: PROTOCOL, sessionId, phase: 'awaiting-child',
      root: paths.root, rootIdentity: identity, coordinationRoot, cleanupLockId: lock.payload.lockId,
      parentPid: process.pid, parentLeaseId: localAccessHandoff.leaseId, hostname: os.hostname(), resourceId,
      commandIdentity, invocationId };
    await atomicWriteJson(repoDelegationPath(paths), record, { mkdir: false, createOnly: true });
    let child;
    let controller;
    let issued = false;
    let admitted = false;
    let settlement = null;
    let protocolError = null;
    let closed = false;
    let queue = Promise.resolve();
    let cleaned = false;
    const clean = () => {
      if (cleaned) return;
      const current = requireRecord(paths, record);
      const claimFile = record.claimFile;
      if (claimFile) {
        const claim = readLockInfoSync(claimFile);
        if (!claim || claim.sessionId !== sessionId || claim.pid !== record.childPid
          || claim.childNonce !== record.childNonce || claim.cleanupLockId !== record.cleanupLockId
          || claim.invocationId !== invocationId || !removeLockFileSyncIfOwned(claimFile, claim)) {
          throw new Error('Delegated child lease identity changed before settlement.');
        }
      }
      const last = inspectRepoCacheDelegation(paths);
      if (last.sha256 !== current.sha256) throw new Error('Delegation record changed before exact unlink.');
      fs.unlinkSync(repoDelegationPath(paths));
      cleaned = true;
    };
    try {
      child = spawn(process.execPath, [...execArgv, ...argv], { cwd, env, windowsHide: true,
        serialization: 'json', stdio: [...stdio, 'ipc'] });
      const completion = new Promise((resolve, reject) => {
        child.on('message', message => {
          if (message?.protocol !== PROTOCOL) return;
          queue = queue.then(async () => {
            if (message.type === 'hello') {
              if (issued || !Number.isSafeInteger(child.pid) || message.pid !== child.pid || !/^[a-f0-9]{64}$/u.test(message.nonce || '')) {
                throw new Error('Forged, replayed or wrong-child delegation hello.');
              }
              requireRecord(paths, record);
              const next = { ...record, phase: 'issued', childPid: child.pid, childNonce: message.nonce,
                capabilityDigest: digest(secret), claimFile: path.join(paths.leases, `delegation-${sessionId}-${message.nonce}.json`) };
              await atomicWriteJson(repoDelegationPath(paths), next, { mkdir: false, beforeCommit: () => requireRecord(paths, record) });
              record = next;
              issued = true;
              await send(child, { protocol: PROTOCOL, type: 'grant', record, capability: secret });
            } else if (message.type === 'claim') {
              const payload = { sessionId, childPid: child.pid, childNonce: record.childNonce, invocationId, resourceId };
              if (!issued || admitted || !validMac(secret, payload, message.signature)) throw new Error('Delegated claim capability is forged or stale.');
              requireRecord(paths, record);
              const claim = readLockInfoSync(record.claimFile);
              if (!claim || claim.pid !== child.pid || claim.sessionId !== sessionId || claim.childNonce !== record.childNonce
                || claim.cleanupLockId !== record.cleanupLockId || claim.resourceId !== resourceId || claim.invocationId !== invocationId) {
                throw new Error('Delegated child did not publish its exact owner lease.');
              }
              admitted = true;
              await send(child, { protocol: PROTOCOL, type: 'admitted', sessionId, signature: mac(secret, payload) });
            } else if (message.type === 'settled') {
              const receipt = message.receipt;
              if (!admitted || settlement || receipt?.sessionId !== sessionId || receipt.childPid !== child.pid
                || receipt.childNonce !== record.childNonce || receipt.invocationId !== invocationId || receipt.resourceId !== resourceId
                || receipt.handlesClosed !== true || receipt.descendantsSettled !== true || receipt.pending !== false
                || !validMac(secret, receipt, message.signature)) throw new Error('Delegated closure receipt is forged, stale or incomplete.');
              requireRecord(paths, record);
              settlement = receipt;
            } else throw new Error('Unknown delegated owner protocol message.');
          }).catch(error => { protocolError ||= error; });
        });
        child.once('error', error => { protocolError ||= error; });
        child.once('close', async (exitCode, signal) => {
          closed = true;
          await queue;
          try {
            if (issued && (!admitted || !settlement || protocolError)) throw pendingError('Child lifetime closed without exact native-owner settlement; exclusion and parent reader remain retained.', controller, protocolError);
            clean();
            if (protocolError) throw protocolError;
            resolve({ resourceId, invocationId, childPid: child.pid ?? null, exitCode, signal, settled: true });
          } catch (error) { context.retainExclusion(); reject(pendingError('Delegated resource ownership remains unresolved.', controller, error)); }
        });
      });
      // The wrapper retains ownership independently of when callers attach their
      // error handling. This does not turn rejection into successful settlement.
      completion.catch(() => {});
      controller = Object.freeze({ schemaVersion: 1, resourceId, invocationId, child,
        inspect: () => ({ sessionId, resourceId, invocationId, childPid: child.pid ?? null,
          issued, admitted, closed, settled: Boolean(closed && settlement && !protocolError),
          pending: !closed || !settlement || Boolean(protocolError) }) });
      readyResolve({ ...controller, completion: lifetime });
      return await completion;
    } catch (error) {
      // Never discard an issued capability based on an exception or elapsed
      // time. Child handles and descendants may still exist after disconnect.
      if (issued || (child && !closed)) context.retainExclusion();
      else {
        try { clean(); } catch (cleanupError) { context.retainExclusion(); error.delegationCleanupError = cleanupError; }
      }
      readyReject(error);
      throw error;
    }
  }, { coordinationRoot, localAccessHandoff });
  lifetime.then(result => {
    if (result.protected) readyReject(Object.assign(new Error(`Delegation blocked: ${result.reason}`), { code: 'ERR_REPO_CACHE_DELEGATION_BUSY' }));
  }, readyReject);
  lifetime.catch(() => {});
  return ready;
};

let childOwner = null;

/** Called only by the --import gate, before the command entry imports readers. */
export const admitDelegatedRepoCacheOwner = async () => {
  if (childOwner || typeof process.send !== 'function' || !process.connected) throw new Error('Delegated admission requires a fresh managed IPC child.');
  const nonce = token();
  const grant = await new Promise((resolve, reject) => {
    const disconnected = () => { process.off('message', receive); reject(new Error('Delegation parent disconnected before admission.')); };
    const receive = message => {
      if (message?.protocol !== PROTOCOL || message.type !== 'grant') return;
      process.off('message', receive); process.off('disconnect', disconnected); resolve(message);
    };
    process.on('message', receive); process.once('disconnect', disconnected);
    send(process, { protocol: PROTOCOL, type: 'hello', pid: process.pid, nonce }).catch(disconnected);
  });
  const { record, capability } = grant;
  if (!record || record.protocol !== PROTOCOL || record.schemaVersion !== 1 || record.phase !== 'issued'
    || record.parentPid !== process.ppid || record.childPid !== process.pid || record.childNonce !== nonce
    || record.hostname !== os.hostname() || !bounded(record.resourceId) || !bounded(record.commandIdentity)
    || !/^[a-f0-9]{64}$/u.test(capability || '') || digest(capability) !== record.capabilityDigest) throw new Error('Delegated child grant is forged or belongs to another process.');
  const paths = repoAccessPaths(record.root, { coordinationRoot: record.coordinationRoot });
  if (record.claimFile !== path.join(paths.leases, `delegation-${record.sessionId}-${nonce}.json`)) throw new Error('Delegated grant nominated an invalid child lease path.');
  requireRecord(paths, record);
  const invocationId = invocationIdentity({ executable: process.execPath, argv: process.argv.slice(1),
    execArgv: process.execArgv, cwd: process.cwd(), env: process.env, commandIdentity: record.commandIdentity });
  if (invocationId !== record.invocationId) throw new Error('Delegated command, arguments, environment or executable differ from the parent invocation.');
  const claim = createLockPayload({ scope: 'delegated-exclusive-native-owner', hostname: os.hostname(), sessionId: record.sessionId,
    childNonce: nonce, cleanupLockId: record.cleanupLockId, invocationId, resourceId: record.resourceId });
  fs.mkdirSync(paths.leases, { recursive: true });
  requireRecord(paths, record);
  fs.writeFileSync(record.claimFile, JSON.stringify(claim), { flag: 'wx' });
  const payload = { sessionId: record.sessionId, childPid: process.pid, childNonce: nonce, invocationId, resourceId: record.resourceId };
  await new Promise((resolve, reject) => {
    const disconnected = () => { process.off('message', receive); reject(new Error('Delegation parent disconnected before claim acknowledgement.')); };
    const receive = message => {
      if (message?.protocol !== PROTOCOL || message.type !== 'admitted') return;
      process.off('message', receive); process.off('disconnect', disconnected);
      if (message.sessionId !== record.sessionId || !validMac(capability, payload, message.signature)) reject(new Error('Delegation acknowledgement is forged.'));
      else resolve();
    };
    process.on('message', receive); process.once('disconnect', disconnected);
    send(process, { protocol: PROTOCOL, type: 'claim', signature: mac(capability, payload) }).catch(disconnected);
  });
  const owner = { paths, record, capability, claim, settled: false, settlementStarted: false, settlementFlight: null };
  registerDelegatedRepoCacheReader(paths, { assertAdmission: () => {
    if (owner.settlementStarted) throw new Error('Delegated native owner no longer admits reads after settlement starts.');
    requireRecord(paths, record);
    if (readLockInfoSync(record.claimFile)?.lockId !== claim.lockId) throw new Error('Delegated child lease changed.');
  } });
  childOwner = owner;
  return Object.freeze({ resourceId: record.resourceId, invocationId, root: paths.root, sessionId: record.sessionId });
};

/** Native resource owner calls this only after actual handle/descendant close.
 * Process exit alone cannot claim that spawned descendants have settled.
 */
export const settleDelegatedRepoCacheOwner = async ({ resourceId, handlesClosed, descendantsSettled, pending } = {}) => {
  const owner = childOwner;
  if (!owner || owner.settled || resourceId !== owner.record.resourceId || handlesClosed !== true
    || descendantsSettled !== true || pending !== false) throw new Error('Exact delegated native resource closure is required.');
  if (owner.settlementFlight) return owner.settlementFlight;
  requireRecord(owner.paths, owner.record);
  const receipt = { sessionId: owner.record.sessionId, childPid: process.pid, childNonce: owner.record.childNonce,
    invocationId: owner.record.invocationId, resourceId, handlesClosed: true, descendantsSettled: true, pending: false };
  // Stop new reads before the asynchronous send, but do not report successful
  // settlement until its actual callback confirms transmission. A failed send
  // has unknown delivery, so retain this one flight instead of replaying a
  // one-use authenticated receipt or allowing readers to resume.
  owner.settlementStarted = true;
  owner.settlementFlight = Promise.resolve().then(async () => {
    await send(process, { protocol: PROTOCOL, type: 'settled', receipt, signature: mac(owner.capability, receipt) });
    owner.settled = true;
    return { ...receipt, settled: true };
  });
  owner.settlementFlight.catch(() => {});
  return owner.settlementFlight;
};

export const getDelegatedRepoCacheOwner = () => childOwner ? Object.freeze({ resourceId: childOwner.record.resourceId,
  root: childOwner.paths.root, commandIdentity: childOwner.record.commandIdentity,
  invocationId: childOwner.record.invocationId, settled: childOwner.settled }) : null;
