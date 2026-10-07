import { validateInferenceHistoryAccess } from '../../contracts/validators/inference-history.js';
import path from 'node:path';
import { visitChatGptExport } from './archive.js';
import { normalizeConversation, hashCanonicalJson } from './normalize.js';
import { openHistoryStore } from './store.js';
import { correlateAuthorizedCode, validateCodeAccess } from './correlation.js';
import { ADAPTER_VERSION, PROJECTION_VERSION, digest, historyError, redactHistoryText, resolveLimits } from './common.js';

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
  const projectionFingerprint = digest(JSON.stringify([PROJECTION_VERSION, limits.maxTextChars]));
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
      if (db && ['search', 'read_original', 'correlate'].includes(request.action)) {
        const visibleUnit = db.prepare(`SELECT 1 FROM units JOIN conversations
          ON conversations.id=units.conversation_id WHERE units.id=? AND conversations.deleted=0`);
        const visibleSnapshot = db.prepare(`SELECT 1 FROM snapshots JOIN conversations
          ON conversations.id=snapshots.conversation_id WHERE snapshots.id=? AND conversations.deleted=0`);
        if (result?.hits?.some((hit) => !visibleUnit.get(hit.sourceRef) || !visibleSnapshot.get(hit.snapshotRef))
          || (request.action === 'read_original' && result && !visibleSnapshot.get(request.snapshotRef))
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
      let importId;
      let previous = null;
      let newSnapshots = 0;
      let newUnits = 0;
      let seenUnits = 0;
      let tombstonedConversations = 0;
      const touched = new Map();
      const source = await visitChatGptExport({
        sourcePath: authorizedSource.path, limits, signal: request.signal,
        onArchive: (hash) => {
          importId = digest(JSON.stringify([scope, hash, ADAPTER_VERSION, projectionFingerprint]));
          previous = db.prepare('SELECT summary FROM imports WHERE id=?').get(importId);
          if (previous) return false;
          db.prepare('INSERT INTO imports VALUES (?, ?)').run(importId, '{}');
          return true;
        },
        onMember: (member) => db.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)')
          .run(importId, member.name, member.kind, member.bytes, member.sha256),
        onConversation: (raw, locator) => {
          const normalized = normalizeConversation(raw, limits);
          const conversationRef = digest(JSON.stringify([scope, normalized.conversationId]));
          const existing = db.prepare('SELECT deleted FROM conversations WHERE id=?').get(conversationRef);
          if (existing?.deleted) { tombstonedConversations += 1; return; }
          const snapshotRef = digest(JSON.stringify([conversationRef, normalized.snapshotHash, projectionFingerprint]));
          // Conflicting snapshots in one export must not pick a last-shard winner.
          if (touched.has(conversationRef) && touched.get(conversationRef) !== snapshotRef) {
            throw historyError('ERR_INFERENCE_HISTORY_CONFLICT', 'Conflicting conversation snapshots in one import.');
          }
          touched.set(conversationRef, snapshotRef);
          db.prepare('INSERT OR IGNORE INTO conversations(id) VALUES (?)').run(conversationRef);
          const added = db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?, ?, ?, ?, ?, ?)').run(
            snapshotRef, conversationRef, normalized.conversationId, locator.raw,
            redactHistoryText(raw.title).slice(0, 512), JSON.stringify(normalized.diagnostics)
          );
          newSnapshots += added.changes;
          db.prepare('INSERT INTO occurrences VALUES (?, ?, ?, ?, ?)').run(
            importId, locator.member, locator.ordinal, snapshotRef, digest(locator.raw)
          );
          if (!added.changes) {
            db.prepare('UPDATE conversations SET latest_snapshot=? WHERE id=?').run(snapshotRef, conversationRef);
            return;
          }
          for (const node of normalized.nodes) {
            if (++seenUnits > limits.maxUnits) {
              throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Conversation import exceeded the unit limit.');
            }
            const nodeRevision = hashCanonicalJson(raw.mapping[node.nodeId]);
            const sourceRef = digest(JSON.stringify([conversationRef, node.nodeId, nodeRevision, projectionFingerprint]));
            const metadata = {
              messageId: redactHistoryText(node.messageId).slice(0, 512), role: redactHistoryText(node.role).slice(0, 128),
              createdAt: { utc: node.createdAt.utc, state: node.createdAt.state },
              // Asset payloads and arbitrary metadata require original-read authority.
              assetCount: node.assets.length, partCount: node.parts.length,
              nodeRevision, projectionVersion: PROJECTION_VERSION, projectionFingerprint
            };
            // Redact complete extracted parts before clipping; otherwise a
            // credential cut by the projection boundary could evade detection.
            const fullText = node.parts.filter((part) => typeof part.text === 'string')
              .map((part) => part.text).join('\n');
            const inserted = db.prepare('INSERT OR IGNORE INTO units VALUES (?, ?, ?, ?, ?)').run(
              sourceRef, conversationRef, node.nodeId,
              redactHistoryText(fullText).slice(0, limits.maxTextChars), JSON.stringify(metadata)
            );
            newUnits += inserted.changes;
            db.prepare('INSERT OR IGNORE INTO snapshot_units VALUES (?, ?, ?)')
              .run(snapshotRef, sourceRef, node.pathState);
          }
          db.prepare('UPDATE conversations SET latest_snapshot=? WHERE id=?').run(snapshotRef, conversationRef);
        }
      });
      const currentSource = await sourceFor(request);
      if (JSON.stringify(currentSource) !== JSON.stringify(authorizedSource)) throw denied();
      await reauthorize();
      if (previous) {
        db.exec('ROLLBACK');
        return { ...JSON.parse(previous.summary), repeated: true, newSnapshots: 0, newUnits: 0 };
      }
      const result = {
        importRef: importId, archiveSha256: source.archiveSha256,
        conversations: source.conversations, members: source.members,
        unsupportedArchives: source.unsupportedArchives, complete: source.complete,
        newSnapshots, newUnits, tombstonedConversations, repeated: false,
        adapterVersion: ADAPTER_VERSION, projectionVersion: PROJECTION_VERSION
      };
      db.prepare('UPDATE imports SET summary=? WHERE id=?').run(JSON.stringify(result), importId);
      db.exec('COMMIT');
      return result;
    });

  const search = async (request) => perform({ ...request, action: 'search' }, false, async (db) => {
    if (typeof request.query !== 'string' || request.query.length > 4096) throw invalid();
    const tokens = [...new Set(request.query.match(/[\p{L}\p{N}_]+/gu) || [])];
    if (!tokens.length || tokens.length > 32) throw invalid();
    const top = request.top ?? 10;
    if (!Number.isSafeInteger(top) || top < 1 || top > 100) throw invalid();
    const pathState = request.pathState ?? 'all';
    if (!['all', 'on_selected_path', 'off_selected_path', 'unknown'].includes(pathState)) throw invalid();
    if (request.snapshotRef != null && !opaqueId(request.snapshotRef)) throw invalid();
    if (!db) return { hits: [] };
    const query = tokens.map((token) => `"${token}"`).join(' AND ');
    const history = request.includeHistory === true || request.snapshotRef ? 1 : 0;
    const snapshot = request.snapshotRef ?? null;
    const rows = db.prepare(`
      SELECT units.id AS sourceRef, units.conversation_id AS conversationRef,
        units.text, units.metadata, bm25(units_fts) AS score
      FROM units_fts JOIN units ON units.id=units_fts.id
      JOIN conversations ON conversations.id=units.conversation_id
      WHERE units_fts MATCH ? AND conversations.deleted=0
        AND EXISTS (SELECT 1 FROM snapshot_units WHERE snapshot_units.unit_id=units.id
          AND (?=1 OR snapshot_units.snapshot_id=conversations.latest_snapshot)
          AND (? IS NULL OR snapshot_units.snapshot_id=?)
          AND (?='all' OR snapshot_units.path_state=?))
      ORDER BY score, units.id LIMIT ?
    `).all(query, history, snapshot, snapshot, pathState, pathState, top);
    const locate = db.prepare(`SELECT snapshots.id AS snapshotRef, snapshots.title,
        snapshot_units.path_state AS pathState FROM snapshot_units
      JOIN snapshots ON snapshots.id=snapshot_units.snapshot_id
      JOIN conversations ON conversations.id=snapshots.conversation_id
      WHERE snapshot_units.unit_id=? AND (?=1 OR snapshots.id=conversations.latest_snapshot)
        AND (? IS NULL OR snapshots.id=?) AND (?='all' OR snapshot_units.path_state=?)
      ORDER BY (snapshots.id=conversations.latest_snapshot) DESC, snapshots.id LIMIT 1`);
    return { hits: rows.map(({ metadata, ...row }) => ({ ...row, ...JSON.parse(metadata),
      ...locate.get(row.sourceRef, history, snapshot, snapshot, pathState, pathState),
      evidenceKind: 'exported_conversation', instructionAuthority: 'none'
    })) };
  });

  const readOriginal = async (request) => perform({ ...request, action: 'read_original' }, false, async (db) => {
    if (!opaqueId(request.snapshotRef)) throw invalid();
    const row = db?.prepare(`SELECT snapshots.raw_json, snapshots.diagnostics FROM snapshots
      JOIN conversations ON conversations.id=snapshots.conversation_id
      WHERE snapshots.id=? AND conversations.deleted=0`).get(request.snapshotRef);
    if (!row) return null;
    const occurrences = db.prepare(`SELECT import_id AS importRef, member, ordinal, raw_sha256 AS rawSha256
      FROM occurrences WHERE snapshot_id=? ORDER BY import_id, member, ordinal`).all(request.snapshotRef);
    const raw = JSON.parse(row.raw_json);
    const normalized = normalizeConversation(raw, limits);
    const assetReferences = normalized.nodes.flatMap((node) => node.assets.map((asset) => ({
      nodeId: node.nodeId, pointer: asset.pointer, state: 'unresolved'
    })));
    const archiveMembers = db.prepare(`SELECT DISTINCT members.import_id AS importRef,
      members.name, members.kind, members.bytes, members.sha256 FROM members
      JOIN occurrences ON occurrences.import_id=members.import_id WHERE occurrences.snapshot_id=?
      ORDER BY members.import_id, members.name`).all(request.snapshotRef);
    return { raw, rawJson: row.raw_json, diagnostics: JSON.parse(row.diagnostics), occurrences, assetReferences, archiveMembers };
  });

  const correlate = async (request) => perform({ ...request, action: 'correlate' }, false, async (db) => {
    if (!opaqueId(request.sourceRef) || typeof resolveCodeAccess !== 'function') throw denied();
    const row = db?.prepare(`SELECT units.text FROM units
      JOIN conversations ON conversations.id=units.conversation_id
      WHERE units.id=? AND conversations.deleted=0`).get(request.sourceRef);
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

  const deleteConversation = async (request) => perform({ ...request, action: 'delete' }, true,
    async (db, _access, reauthorize) => {
      if (!opaqueId(request.conversationRef)) throw invalid();
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT OR IGNORE INTO conversations(id, deleted) VALUES (?, 1)').run(request.conversationRef);
      db.prepare('UPDATE conversations SET deleted=1, latest_snapshot=NULL WHERE id=?').run(request.conversationRef);
      db.prepare('DELETE FROM snapshots WHERE conversation_id=?').run(request.conversationRef);
      db.prepare('DELETE FROM units WHERE conversation_id=?').run(request.conversationRef);
      // FTS segment merges remove deleted text from live index pages. Filesystem
      // snapshots/backups and the caller-retained original archive are external.
      db.prepare("INSERT INTO units_fts(units_fts) VALUES ('optimize')").run();
      await reauthorize();
      db.exec('COMMIT');
      return { conversationRef: request.conversationRef, tombstoned: true,
        vaultRowsRemoved: true, originalArchiveRetainedByCaller: true,
        importInventoryRetained: true, externalBackupsErased: false };
    });

  return Object.freeze({ importExport, search, readOriginal, correlate, deleteConversation });
}
