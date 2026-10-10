import { canonicalSemanticJson, semanticHash } from './identity.js';
import { assertSemanticTask } from '../../contracts/validators/semantic-task.js';
const fail = (message, code = 'ERR_SEMANTIC_FRONTIER') => Object.assign(new Error(message), { code });
const integer = (value, label, min = 0) => {
  if (!Number.isSafeInteger(value) || value < min) throw new TypeError('Invalid ' + label);
};
const text = (value, label) => { if (typeof value !== 'string' || !value) throw new TypeError('Invalid ' + label); };
const inputHash = task => semanticHash('pairofcleats.semantic.task-input.v1', {
  inputHashes: [...task.inputHashes].sort(), sourceUnits: [...task.sourceUnits].sort(),
  dependencies: [...task.dependencies].sort((a, b) => a.dependencyKey.localeCompare(b.dependencyKey))
});
const SCHEMA = `
CREATE TABLE frontier_meta(schemaVersion INTEGER NOT NULL CHECK(schemaVersion=1));
INSERT INTO frontier_meta VALUES(1);
CREATE TABLE tasks(taskId TEXT PRIMARY KEY,kind TEXT NOT NULL,baseBuildId TEXT NOT NULL,inputHash TEXT NOT NULL,
 policyHash TEXT NOT NULL,targetsRef TEXT NOT NULL,state TEXT NOT NULL,priority INTEGER NOT NULL,attempt INTEGER NOT NULL,
 leaseOwner TEXT,leaseUntil INTEGER,lastError TEXT);
CREATE INDEX tasks_ready ON tasks(baseBuildId,state,priority,taskId);
CREATE TABLE dependencies(taskId TEXT NOT NULL,dependencyKey TEXT NOT NULL,expectedHash TEXT NOT NULL,
 PRIMARY KEY(taskId,dependencyKey),FOREIGN KEY(taskId) REFERENCES tasks(taskId));
CREATE TABLE outputs(taskId TEXT PRIMARY KEY,manifestHash TEXT NOT NULL,publishedBuildId TEXT NOT NULL,
 FOREIGN KEY(taskId) REFERENCES tasks(taskId));
CREATE TABLE dependency_inventory(baseBuildId TEXT NOT NULL,dependencyKey TEXT NOT NULL,actualHash TEXT NOT NULL,PRIMARY KEY(baseBuildId,dependencyKey));
CREATE TABLE task_descriptors(taskId TEXT PRIMARY KEY,payload TEXT NOT NULL,
 FOREIGN KEY(taskId) REFERENCES tasks(taskId));`;
/** Dedicated transactional control database; never accepts the live retrieval database. */
export const openSemanticFrontier = ({ Database, filename, maxAttempts = 3, retryDelayMs = 1000 }) => {
  if (typeof Database !== 'function') return { available: false, reason: 'sqlite_control_store_unavailable' };
  integer(maxAttempts, 'max attempts', 1); integer(retryDelayMs, 'retry delay');
  const db = new Database(filename);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    if (tables.length && (tables.length !== 6 || !tables.includes('frontier_meta') || tables.some(name => !['frontier_meta', 'tasks', 'dependencies', 'outputs', 'task_descriptors', 'dependency_inventory'].includes(name)))) {
      throw fail('Semantic frontier requires its own control database.', 'ERR_SEMANTIC_CONTROL_STORE_SCOPE');
    }
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    if (!tables.length) db.transaction(() => db.exec(SCHEMA)).immediate();
    const version = db.prepare('SELECT schemaVersion FROM frontier_meta').all();
    if (version.length !== 1 || version[0].schemaVersion !== 1) throw fail('Unsupported semantic control-store schema.');
    db.pragma('foreign_keys = ON');
    const read = id => db.prepare('SELECT * FROM tasks WHERE taskId=?').get(id) || null;
    const descriptor = id => {
      const row = db.prepare('SELECT payload FROM task_descriptors WHERE taskId=?').get(id);
      return row ? assertSemanticTask(JSON.parse(row.payload)) : null;
    };
    const requireLease = ({ taskId, owner, now }) => {
      const row = read(taskId);
      if (!row || row.state !== 'leased' || row.leaseOwner !== owner || row.leaseUntil <= now) {
        throw fail('Semantic task lease is missing, expired or owned elsewhere.', 'ERR_SEMANTIC_LEASE_LOST');
      }
      return row;
    };
    const enqueue = ({ task, durableInputHashes }) => db.transaction(() => {
      assertSemanticTask(task);
      if (!(durableInputHashes instanceof Set) || task.inputHashes.some(hash => !durableInputHashes.has(hash))) throw fail('Task inputs must be durable before enqueue.');
      const payload = canonicalSemanticJson(task), existing = descriptor(task.taskId);
      if (existing) {
        if (canonicalSemanticJson(existing) !== payload) throw fail('Conflicting immutable task descriptor.');
        return read(task.taskId);
      }
      db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(task.taskId, task.kind, task.baseBuildId,
        inputHash(task), task.policyHash, task.targetsRef, 'pending', task.priority, 0, null, null, null);
      db.prepare('INSERT INTO task_descriptors VALUES(?,?)').run(task.taskId, payload);
      const insert = db.prepare('INSERT INTO dependencies VALUES(?,?,?)');
      for (const dependency of task.dependencies) insert.run(task.taskId, dependency.dependencyKey, dependency.expectedHash);
      return read(task.taskId);
    }).immediate();
    const leaseReady = ({ baseBuildId, owner, now = Date.now(), leaseMs = 30000, limit = 16, dependencyHashes = new Map() }) => db.transaction(() => {
      text(baseBuildId, 'base build'); text(owner, 'lease owner'); integer(now, 'clock'); integer(leaseMs, 'lease duration', 1); integer(limit, 'window size', 1);
      if (limit > 128 || !Number.isSafeInteger(now + leaseMs)) throw new TypeError('Lease window exceeds bounds.');
      db.prepare("UPDATE tasks SET state=CASE WHEN attempt>=? THEN 'failed' ELSE 'pending' END,leaseOwner=NULL,leaseUntil=NULL,lastError=? WHERE baseBuildId=? AND state='leased' AND leaseUntil<=?")
        .run(maxAttempts, JSON.stringify({ reason: 'lease_expired', retryAt: now }), baseBuildId, now);
      // One generation-scoped inventory per caller snapshot; never reuse stale readiness.
      db.prepare('DELETE FROM dependency_inventory WHERE baseBuildId=?').run(baseBuildId);
      const inventory = db.prepare('INSERT INTO dependency_inventory VALUES(?,?,?)');
      for (const [key, hash] of dependencyHashes) inventory.run(baseBuildId, key, hash);
      db.prepare("UPDATE tasks SET state='blocked' WHERE baseBuildId=? AND state IN ('pending','blocked') AND EXISTS (SELECT 1 FROM dependencies d LEFT JOIN dependency_inventory i ON i.baseBuildId=tasks.baseBuildId AND i.dependencyKey=d.dependencyKey WHERE d.taskId=tasks.taskId AND (i.actualHash IS NULL OR i.actualHash<>d.expectedHash))").run(baseBuildId);
      const candidates = db.prepare("SELECT * FROM tasks WHERE baseBuildId=? AND state IN ('pending','blocked') AND attempt<? AND (lastError IS NULL OR json_extract(lastError,'$.retryAt') IS NULL OR json_extract(lastError,'$.retryAt')<=?) AND NOT EXISTS (SELECT 1 FROM dependencies d LEFT JOIN dependency_inventory i ON i.baseBuildId=tasks.baseBuildId AND i.dependencyKey=d.dependencyKey WHERE d.taskId=tasks.taskId AND (i.actualHash IS NULL OR i.actualHash<>d.expectedHash)) ORDER BY priority DESC,taskId LIMIT ?")
        .all(baseBuildId, maxAttempts, now, limit);
      const result = [];
      for (const row of candidates) {
        if (result.length === limit) break;
        const failure = row.lastError ? JSON.parse(row.lastError) : null;
        if (failure?.retryAt > now) continue;
        const dependencies = db.prepare('SELECT dependencyKey,expectedHash FROM dependencies WHERE taskId=?').all(row.taskId);
        const ready = dependencies.every(dep => dependencyHashes.get(dep.dependencyKey) === dep.expectedHash);
        if (!ready) {
          db.prepare("UPDATE tasks SET state='blocked',lastError=? WHERE taskId=?").run(JSON.stringify({ reason: 'dependency_not_ready' }), row.taskId);
          continue;
        }
        db.prepare("UPDATE tasks SET state='leased',attempt=attempt+1,leaseOwner=?,leaseUntil=?,lastError=NULL WHERE taskId=?")
          .run(owner, now + leaseMs, row.taskId);
        result.push({ ...read(row.taskId), descriptor: descriptor(row.taskId) });
      }
      return result;
    }).immediate();
    const release = ({ taskId, owner, now = Date.now(), reason, transient = false, cancelled = false }) => db.transaction(() => {
      integer(now, 'clock'); text(reason, 'reason');
      const row = requireLease({ taskId, owner, now });
      const state = cancelled ? 'cancelled' : transient && row.attempt < maxAttempts ? 'pending' : 'failed';
      const retryAt = state === 'pending' ? now + retryDelayMs * (2 ** Math.min(row.attempt - 1, 20)) : null;
      db.prepare('UPDATE tasks SET state=?,leaseOwner=NULL,leaseUntil=NULL,lastError=? WHERE taskId=?')
        .run(state, JSON.stringify({ reason, transient, retryAt }), taskId);
      return read(taskId);
    }).immediate();
    const renew = ({ taskId, owner, now = Date.now(), leaseMs = 30000 }) => db.transaction(() => {
      integer(now, 'clock'); integer(leaseMs, 'lease duration', 1); requireLease({ taskId, owner, now });
      if (!Number.isSafeInteger(now + leaseMs)) throw new TypeError('Unsafe lease expiry.');
      db.prepare('UPDATE tasks SET leaseUntil=? WHERE taskId=?').run(now + leaseMs, taskId);
      return read(taskId);
    }).immediate();
    const acknowledgePublished = async ({ taskId, owner, publication, verifyPublication, now = () => Date.now() }) => {
      const before = requireLease({ taskId, owner, now: now() });
      if (!publication || !/^[a-f0-9]{64}$/.test(publication.manifestHash) || !publication.publishedBuildId
        || publication.taskId !== taskId || publication.policyHash !== before.policyHash
        || publication.baseBuildId !== before.baseBuildId || publication.inputHash !== before.inputHash
        || typeof verifyPublication !== 'function' || !await verifyPublication(publication)) {
        throw fail('Completion requires verified generation publication for the exact task inputs.', 'ERR_SEMANTIC_PUBLICATION_REQUIRED');
      }
      return db.transaction(() => {
        const current = requireLease({ taskId, owner, now: now() });
        if (current.inputHash !== before.inputHash || current.attempt !== before.attempt) throw fail('Task changed during publication verification.');
        db.prepare('INSERT INTO outputs VALUES(?,?,?)').run(taskId, publication.manifestHash, publication.publishedBuildId);
        db.prepare("UPDATE tasks SET state='completed',leaseOwner=NULL,leaseUntil=NULL,lastError=NULL WHERE taskId=?").run(taskId);
        return read(taskId);
      }).immediate();
    };
    const reconcilePublished = async ({ taskId, publication, verifyPublication }) => {
      const before = read(taskId);
      if (!before || ['cancelled', 'superseded'].includes(before.state)
        || publication?.taskId !== taskId || publication.policyHash !== before.policyHash
        || publication.baseBuildId !== before.baseBuildId || publication.inputHash !== before.inputHash
        || !/^[a-f0-9]{64}$/.test(publication.manifestHash) || !publication.publishedBuildId
        || typeof verifyPublication !== 'function' || !await verifyPublication(publication)) {
        throw fail('Published task recovery requires verified exact current inputs.', 'ERR_SEMANTIC_PUBLICATION_REQUIRED');
      }
      return db.transaction(() => {
        const current = read(taskId);
        if (!current || ['cancelled', 'superseded'].includes(current.state) || current.inputHash !== before.inputHash) throw fail('Task became stale during output recovery.');
        const existing = db.prepare('SELECT * FROM outputs WHERE taskId=?').get(taskId);
        if (existing && (existing.manifestHash !== publication.manifestHash || existing.publishedBuildId !== publication.publishedBuildId)) throw fail('Conflicting published output receipt.');
        if (!existing) db.prepare('INSERT INTO outputs VALUES(?,?,?)').run(taskId, publication.manifestHash, publication.publishedBuildId);
        db.prepare("UPDATE tasks SET state='completed',leaseOwner=NULL,leaseUntil=NULL,lastError=NULL WHERE taskId=?").run(taskId);
        return read(taskId);
      }).immediate();
    };
    const supersede = ({ taskId, expectedInputHash }) => db.transaction(() => {
      const row = read(taskId);
      if (!row || row.inputHash !== expectedInputHash) throw fail('Stale task supersession request.');
      if (row.state === 'completed') return row;
      db.prepare("UPDATE tasks SET state='superseded',leaseOwner=NULL,leaseUntil=NULL,lastError=? WHERE taskId=?")
        .run(JSON.stringify({ reason: 'source_or_configuration_changed' }), taskId);
      return read(taskId);
    }).immediate();
    return { available: true, enqueue, leaseReady, release, renew, acknowledgePublished, reconcilePublished, supersede, getTask: read,
      getDescriptor: descriptor, getOutput: id => db.prepare('SELECT * FROM outputs WHERE taskId=?').get(id) || null,
      close: () => db.close() };
  } catch (error) { db.close(); throw error; }
};
