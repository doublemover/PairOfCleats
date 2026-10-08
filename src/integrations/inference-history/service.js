import { validateInferenceHistoryAccess } from '../../contracts/validators/inference-history.js';
import path from 'node:path';
import { visitChatGptExport } from './archive.js';
import { hashCanonicalJson } from './normalize.js';
import { normalizeHistoryRecord } from './records.js';
import { normalizeMemberLinks } from './member-links.js';
import { READ_GUARDS, visibleNode, searchHistory, readVisibleContext, readHistoryReferences } from './reader.js';
import { openHistoryStore } from './store.js';
import { correlateAuthorizedCode, validateCodeAccess } from './correlation.js';
import { ADAPTER_VERSION, PROJECTION_VERSION, DEFAULT_LIMITS, digest, privateReference, historyError, projectHistoryText, redactHistoryText, resolveLimits } from './common.js';

const denied = () => historyError('ERR_INFERENCE_HISTORY_DENIED', 'Inference-history access denied.');
const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid inference-history request.');
const opaqueId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const partitionIdentity = (access) => JSON.stringify([
  'inference-history', access.tenantId, access.ownerType, access.ownerId, access.sourceScope
]);
const securityIdentity = (access) => JSON.stringify([
  partitionIdentity(access), access.principalId, access.policyEpoch
]);

/**
 * A policy-bound local service, intentionally not mounted into ordinary search,
 * federation, HTTP or MCP. resolveAccess is a trusted host callback. It must
 * authenticate requestContext and authorize the ENTIRE selected partition for
 * the requested action; the caller's partition selector is never an identity.
 */
export function createInferenceHistoryService({ vaultRoot, resolveAccess, resolveImportSource = null, resolveCodeAccess = null,
  verifyPrivateVault = null, limits: inputLimits, audit = null }) {
  if (typeof resolveAccess !== 'function') throw denied();
  const limits = resolveLimits(inputLimits);
  const projectionFingerprint = digest(JSON.stringify([ADAPTER_VERSION, PROJECTION_VERSION, limits.maxTextChars]));
  const accessFor = async (requestContext, partition, action) => {
    let access;
    try { access = await resolveAccess({ requestContext, partition, action }); } catch { throw denied(); }
    if (!validateInferenceHistoryAccess(access).ok) throw denied();
    return Object.freeze({ ...access });
  };
  const recheck = async (access, request) => {
    const current = await accessFor(request.requestContext, request.partition, request.action);
    if (securityIdentity(access) !== securityIdentity(current)) throw denied();
  };
  const sourceFor = async (request) => {
    if (typeof resolveImportSource !== 'function') throw denied();
    let source;
    try { source = await resolveImportSource({ requestContext: request.requestContext, source: request.source }); }
    catch { throw denied(); }
    if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path)
      || typeof source.policyEpoch !== 'string' || !source.policyEpoch) throw denied();
    return { path: source.path, policyEpoch: source.policyEpoch };
  };
  const perform = async (request, create, operation) => {
    let db;
    let access;
    let outcome = 'denied';
    try {
      access = await accessFor(request.requestContext, request.partition, request.action);
      const partitionKey = digest(partitionIdentity(access));
      db = await openHistoryStore(vaultRoot, partitionKey, { create, verifyPrivateVault });
      const result = await operation(db, access, () => recheck(access, request));
      if (typeof audit === 'function') await audit({ action: request.action, outcome: 'allowed',
        principalId: access.principalId, partitionKey, policyEpoch: access.policyEpoch });
      await recheck(access, request);
      // A concurrent tombstone must also gate an in-flight response, even when
      // host policy did not need to change its epoch for this local deletion.
      if (db && ['search', 'read_original', 'read_context', 'read_references', 'correlate'].includes(request.action)) {
        const visibleUnit = db.prepare(`SELECT 1 FROM units JOIN records
          ON records.id=units.record_id WHERE units.id=? AND records.deleted=0`);
        const visibleSnapshot = db.prepare(`SELECT 1 FROM snapshots JOIN records
          ON records.id=snapshots.record_id WHERE snapshots.id=? AND records.deleted=0`);
        if (result?.[READ_GUARDS]?.some(ref => !visibleUnit.get(ref.sourceRef) || !visibleSnapshot.get(ref.snapshotRef))
          || (request.action === 'read_context' && result && !visibleSnapshot.get(request.snapshotRef))
          || result?.hits?.some((hit) => !visibleUnit.get(hit.sourceRef) || !visibleSnapshot.get(hit.snapshotRef))
          || (request.action === 'read_original' && request.target !== 'member' && result && !visibleSnapshot.get(request.snapshotRef))
          || (request.target === 'member' && result && !db.prepare('SELECT 1 FROM member_evidence WHERE import_id=? AND name=?').get(request.importRef, request.member))
          || (request.action === 'correlate' && result?.sourceRef && !visibleUnit.get(result.sourceRef))) throw denied();
      }
      outcome = 'allowed';
      return result;
    } catch (error) {
      if (error?.code?.startsWith('ERR_INFERENCE_HISTORY_')) throw error;
      throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Inference-history operation failed.');
    } finally {
      if (db?.inTransaction) db.exec('ROLLBACK');
      db?.close();
      // Audit is a trusted sink. Never include queries, source paths, IDs supplied
      // by the archive, titles, bodies or raw dependency errors.
      if (outcome !== 'allowed' && typeof audit === 'function') await audit({
        action: request.action, outcome,
        principalId: access?.principalId ?? null,
        partitionKey: access ? digest(partitionIdentity(access)) : null,
        policyEpoch: access?.policyEpoch ?? null
      });
    }
  };

  const importExport = async (request) => perform({ ...request, action: 'import' }, true,
    async (db, _access, reauthorize) => {
      const authorizedSource = await sourceFor(request);
      db.exec('BEGIN IMMEDIATE');
      const scope = digest(partitionIdentity(_access));
      const referenceKey = db.prepare("SELECT value FROM vault_meta WHERE key='reference_key'").get().value;
      let importId;
      let previous = null;
      let newSnapshots = 0;
      let newUnits = 0;
      let seenUnits = 0;
      let tombstonedRecords = 0;
      const touched = new Map();
      const source = await visitChatGptExport({
        sourcePath: authorizedSource.path, limits, signal: request.signal,
        onArchive: (hash) => {
          importId = privateReference(referenceKey, JSON.stringify([scope, hash, ADAPTER_VERSION, projectionFingerprint]));
          previous = db.prepare('SELECT summary FROM imports WHERE id=?').get(importId);
          if (previous) return false;
          db.prepare('INSERT INTO imports VALUES (?, ?)').run(importId, '{}');
          return true;
        },
        onMember: (member) => db.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)')
          .run(importId, member.name, member.kind, member.bytes, member.sha256),
        onMetadata: ({ member, kind, rawJson, raw }) => {
          const links = normalizeMemberLinks(raw, kind, member, limits.maxEntries);
          db.prepare('INSERT INTO member_evidence VALUES (?, ?, ?, ?)').run(importId, member, kind, rawJson);
          const insert = db.prepare('INSERT OR IGNORE INTO member_links VALUES (?, ?, ?, ?, ?, ?)');
          for (const link of links) {
            if (++seenUnits > limits.maxUnits) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Evidence unit limit exceeded.');
            insert.run(importId, link.relation, link.logicalId, link.memberPath, link.bytes, 'pending');
          }
        },
        onRecord: (raw, locator) => {
          const normalized = normalizeHistoryRecord(raw, locator.evidenceKind, limits);
          seenUnits += normalized.nodes.length;
          if (seenUnits > limits.maxUnits) {
            throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Conversation import exceeded the unit limit.');
          }
          const recordRef = digest(JSON.stringify([scope, normalized.evidenceKind, normalized.recordId]));
          const existing = db.prepare('SELECT deleted FROM records WHERE id=?').get(recordRef);
          if (existing?.deleted) { tombstonedRecords += 1; return; }
          const snapshotRef = privateReference(referenceKey, JSON.stringify([recordRef, normalized.snapshotHash, digest(locator.raw), projectionFingerprint]));
          // Conflicting snapshots in one export must not pick a last-shard winner.
          if (touched.has(recordRef) && touched.get(recordRef) !== normalized.snapshotHash) {
            throw historyError('ERR_INFERENCE_HISTORY_CONFLICT', 'Conflicting conversation snapshots in one import.');
          }
          touched.set(recordRef, normalized.snapshotHash);
          db.prepare('INSERT OR IGNORE INTO records(id) VALUES (?)').run(recordRef);
          const added = db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            snapshotRef, recordRef, normalized.evidenceKind, normalized.recordId, locator.raw,
            redactHistoryText(raw.title).slice(0, 512), JSON.stringify(normalized.diagnostics)
          );
          newSnapshots += added.changes;
          db.prepare('INSERT INTO occurrences VALUES (?, ?, ?, ?, ?)').run(
            importId, locator.member, locator.ordinal, snapshotRef, digest(locator.raw)
          );
          if (!added.changes) {
            db.prepare('UPDATE records SET latest_snapshot=? WHERE id=?').run(snapshotRef, recordRef);
            return;
          }
          for (const node of normalized.nodes) {
            const nodeRevision = node.sourceRevision;
            const sourceRef = privateReference(referenceKey, JSON.stringify([recordRef, node.nodeId, nodeRevision, projectionFingerprint]));
            const fullText = visibleNode(raw, normalized.evidenceKind, node.nodeId)?.text ?? '';
            const projection = projectHistoryText(fullText, limits.maxTextChars);
            const metadata = {
              evidenceKind: normalized.evidenceKind,
              sourceDetails: Object.fromEntries(Object.entries(node.sourceDetails || {})
                .filter(([, value]) => value === null || ['string', 'boolean'].includes(typeof value))
                .map(([key, value]) => [key, typeof value === 'string' ? redactHistoryText(value).slice(0, 512) : value])),
              messageId: redactHistoryText(node.messageId).slice(0, 512), role: redactHistoryText(node.role).slice(0, 128),
              createdAt: { utc: node.createdAt.utc, state: node.createdAt.state },
              // Asset payloads and arbitrary metadata require original-read authority.
              assetCount: node.assets.length, partCount: node.parts.length,
              nodeRevision, projectionVersion: PROJECTION_VERSION, projectionFingerprint, projection: projection.metadata
            };
            // Redact complete extracted parts before clipping; otherwise a
            // credential cut by the projection boundary could evade detection.
            const inserted = db.prepare('INSERT OR IGNORE INTO units VALUES (?, ?, ?, ?, ?)').run(
              sourceRef, recordRef, node.nodeId,
              projection.text, JSON.stringify(metadata)
            );
            newUnits += inserted.changes;
            db.prepare('INSERT OR IGNORE INTO snapshot_units VALUES (?, ?, ?)')
              .run(snapshotRef, sourceRef, node.pathState);
          }
          db.prepare('UPDATE records SET latest_snapshot=? WHERE id=?').run(snapshotRef, recordRef);
        }
      });
      if (tombstonedRecords) {
        db.prepare('DELETE FROM member_evidence WHERE import_id=?').run(importId);
        db.prepare('DELETE FROM member_links WHERE import_id=?').run(importId);
      }
      const currentSource = await sourceFor(request);
      if (JSON.stringify(currentSource) !== JSON.stringify(authorizedSource)) throw denied();
      await reauthorize();
      if (previous) {
        db.exec('ROLLBACK');
        return { ...JSON.parse(previous.summary), repeated: true, newSnapshots: 0, newUnits: 0 };
      }
      db.prepare("UPDATE member_links SET state=CASE WHEN NOT EXISTS (SELECT 1 FROM members WHERE members.import_id=member_links.import_id AND members.name=member_links.path) THEN 'not_in_selected_input' WHEN declared_bytes IS NOT NULL AND declared_bytes != (SELECT bytes FROM members WHERE members.import_id=member_links.import_id AND members.name=member_links.path) THEN 'size_mismatch' ELSE 'linked_member' END WHERE import_id=?").run(importId);
      const linkStates = Object.fromEntries(db.prepare('SELECT state, COUNT(*) AS count FROM member_links WHERE import_id=? GROUP BY state ORDER BY state')
        .all(importId).map(row => [row.state, row.count]));
      const result = {
        importRef: importId, archiveSha256: source.archiveSha256,
        conversations: source.conversations, tasks: source.tasks, records: source.conversations + source.tasks, members: source.members,
        memberLinkStates: linkStates, coverage: 'selected_input',
        unsupportedArchives: source.unsupportedArchives, complete: source.complete && !linkStates.not_in_selected_input && !linkStates.size_mismatch,
        newSnapshots, newUnits, tombstonedRecords, repeated: false,
        adapterVersion: ADAPTER_VERSION, projectionVersion: PROJECTION_VERSION
      };
      db.prepare('UPDATE imports SET summary=? WHERE id=?').run(JSON.stringify(result), importId);
      db.exec('COMMIT');
      return result;
    });

  const search = async (request) => perform({ ...request, action: 'search' }, false,
    async db => searchHistory(db, request));
  const readContext = async (request) => perform({ ...request, action: 'read_context' }, false,
    async db => readVisibleContext(db, request));
  const readReferences = async (request) => perform({ ...request, action: 'read_references' }, false,
    async db => readHistoryReferences(db, request));
  const readOriginal = async (request) => perform({ ...request, action: 'read_original', target: 'record' }, false, async (db) => {
    if (!opaqueId(request.snapshotRef)) throw invalid();
    const row = db?.prepare(`SELECT snapshots.raw_json, snapshots.diagnostics, snapshots.source_kind FROM snapshots
      JOIN records ON records.id=snapshots.record_id
      WHERE snapshots.id=? AND records.deleted=0`).get(request.snapshotRef);
    if (!row) return null;
    const occurrences = db.prepare(`SELECT import_id AS importRef, member, ordinal, raw_sha256 AS rawSha256
      FROM occurrences WHERE snapshot_id=? ORDER BY import_id, member, ordinal`).all(request.snapshotRef);
    const raw = JSON.parse(row.raw_json);
    let assetReferences = [], assetReferencesComplete = true;
    try {
      const normalized = normalizeHistoryRecord(raw, row.source_kind, DEFAULT_LIMITS);
      assetReferences = normalized.nodes.flatMap((node) => node.assets.map((asset) => ({
        nodeId: node.nodeId, pointer: asset.pointer, state: 'unresolved'
      })));
    } catch (error) {
      if (!['ERR_INFERENCE_HISTORY_LIMIT', 'ERR_INFERENCE_HISTORY_INPUT'].includes(error?.code)) throw error;
      assetReferencesComplete = false;
    }
    const archiveMembers = db.prepare(`SELECT DISTINCT members.import_id AS importRef,
      members.name, members.kind, members.bytes, members.sha256 FROM members
      JOIN occurrences ON occurrences.import_id=members.import_id WHERE occurrences.snapshot_id=?
      ORDER BY members.import_id, members.name`).all(request.snapshotRef);
    return { evidenceKind: row.source_kind, raw, rawJson: row.raw_json, diagnostics: JSON.parse(row.diagnostics), occurrences, assetReferences, assetReferencesComplete, archiveMembers };
  });

  const readMemberEvidence = async (request) => perform({ ...request, action: 'read_original', target: 'member' }, false, async (db) => {
    if (!opaqueId(request.importRef) || typeof request.member !== 'string' || request.member.length > 4096) throw invalid();
    const row = db?.prepare('SELECT kind, raw_json FROM member_evidence WHERE import_id=? AND name=?').get(request.importRef, request.member);
    if (!row) return null;
    const links = db.prepare('SELECT kind, logical_id AS logicalId, path, declared_bytes AS declaredBytes, state FROM member_links WHERE import_id=? ORDER BY kind, logical_id, path').all(request.importRef);
    return { importRef: request.importRef, member: request.member, kind: row.kind, rawJson: row.raw_json,
      raw: JSON.parse(row.raw_json), links, instructionAuthority: 'none', filesystemAuthority: 'none' };
  });

  const correlate = async (request) => perform({ ...request, action: 'correlate' }, false, async (db) => {
    if (!opaqueId(request.sourceRef) || typeof resolveCodeAccess !== 'function') throw denied();
    const row = db?.prepare(`SELECT units.text FROM units
      JOIN records ON records.id=units.record_id
      WHERE units.id=? AND records.deleted=0`).get(request.sourceRef);
    if (!row) return { relations: [], unresolvedCommitMentions: [] };
    // Code grants are independent of history grants. Only trusted host policy
    // supplies repository roots and Markdown files, never retrieved text.
    const codeAccess = validateCodeAccess(await resolveCodeAccess({ requestContext: request.requestContext }));
    const identity = hashCanonicalJson(codeAccess);
    const result = await correlateAuthorizedCode(row.text, codeAccess, { signal: request.signal });
    const current = validateCodeAccess(await resolveCodeAccess({ requestContext: request.requestContext }));
    if (hashCanonicalJson(current) !== identity) throw denied();
    return { sourceRef: request.sourceRef, ...result, instructionAuthority: 'none' };
  });

  const deleteRecord = async (request) => perform({ ...request, action: 'delete' }, true,
    async (db, _access, reauthorize) => {
      if (!opaqueId(request.recordRef)) throw invalid();
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT OR IGNORE INTO records(id, deleted) VALUES (?, 1)').run(request.recordRef);
      db.prepare('UPDATE records SET deleted=1, latest_snapshot=NULL WHERE id=?').run(request.recordRef);
      db.prepare('DELETE FROM member_evidence WHERE import_id IN (SELECT import_id FROM occurrences JOIN snapshots ON snapshots.id=occurrences.snapshot_id WHERE snapshots.record_id=?)').run(request.recordRef);
      db.prepare('DELETE FROM member_links WHERE import_id IN (SELECT import_id FROM occurrences JOIN snapshots ON snapshots.id=occurrences.snapshot_id WHERE snapshots.record_id=?)').run(request.recordRef);
      db.prepare('DELETE FROM snapshots WHERE record_id=?').run(request.recordRef);
      db.prepare('DELETE FROM units WHERE record_id=?').run(request.recordRef);
      // FTS segment merges remove deleted text from live index pages. Filesystem
      // snapshots/backups and the caller-retained original archive are external.
      db.prepare("INSERT INTO units_fts(units_fts) VALUES ('optimize')").run();
      await reauthorize();
      db.exec('COMMIT');
      return { recordRef: request.recordRef, tombstoned: true,
        vaultRowsRemoved: true, sharedMemberEvidencePruned: true, originalArchiveRetainedByCaller: true,
        importInventoryRetained: true, externalBackupsErased: false };
    });

  return Object.freeze({ importExport, search, readContext, readReferences, readOriginal, readMemberEvidence, correlate, deleteRecord });
}
