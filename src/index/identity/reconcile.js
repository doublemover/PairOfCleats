import path from 'node:path';
import {
  MAX_JSON_BYTES,
  loadChunkMetaRows,
  loadJsonArrayArtifactRows,
  loadPiecesManifest
} from '../../shared/artifact-io.js';
import {
  assertChunkIdentityEnvelope,
  buildChunkIdentityEnvelopeFromArtifactRow
} from '../../shared/identity.js';

const DEFAULT_MAX_ISSUES = 50;

const hasManifestPiece = (manifest, name) => (
  Array.isArray(manifest?.pieces)
  && manifest.pieces.some((entry) => entry?.name === name)
);

const isMissingArtifactError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === 'ERR_ARTIFACT_MISSING'
    || code === 'ERR_MANIFEST_ENTRY_MISSING'
    || code === 'ERR_MANIFEST_MISSING'
    || code === 'ENOENT'
    || /Missing manifest entry/i.test(message)
    || /Missing pieces manifest/i.test(message)
  );
};

const pushIssue = (report, code, message, extra = {}) => {
  report.totalIssues += 1;
  report.ok = false;
  if (report.issues.length >= report.maxIssues) return;
  report.issues.push({ code, message, ...extra });
};

const extractChunkIdentityProvenance = (row) => {
  const meta = row?.metaV2 && typeof row.metaV2 === 'object' ? row.metaV2 : {};
  const identity = row?.identity && typeof row.identity === 'object' ? row.identity : {};
  return {
    mintedByStage: String(identity.mintedByStage || meta.mintedByStage || '').trim() || null,
    disambiguation: String(identity.disambiguation || meta.disambiguation || '').trim() || null,
    canonicalEnvelopeVersion: String(
      identity.canonicalEnvelopeVersion || meta.canonicalEnvelopeVersion || ''
    ).trim() || null
  };
};

const formatArtifactLabel = (artifact, detail) => (
  detail ? `${artifact} ${detail}` : artifact
);

const validateKnownChunkReference = ({
  report,
  artifact,
  detail = '',
  reference,
  chunkByUid
}) => {
  const uid = typeof reference?.chunkUid === 'string' ? reference.chunkUid.trim() : '';
  if (!uid) {
    pushIssue(
      report,
      'ERR_ID_CHUNK_REFERENCE_MISSING',
      `${formatArtifactLabel(artifact, detail)} missing chunkUid`
    );
    return null;
  }
  const expected = chunkByUid.get(uid);
  if (!expected) {
    pushIssue(
      report,
      'ERR_ID_CHUNK_REFERENCE_UNKNOWN',
      `${formatArtifactLabel(artifact, detail)} chunkUid missing in chunk_meta (${uid})`,
      {
        chunkUid: uid,
        detectedByStage: `identity.reconcile.${artifact}`
      }
    );
    return null;
  }
  const file = typeof reference?.file === 'string' ? reference.file.trim() : '';
  if (file && expected.file && file !== expected.file) {
    pushIssue(
      report,
      'ERR_ID_CHUNK_REFERENCE_FILE_MISMATCH',
      `${formatArtifactLabel(artifact, detail)} file mismatch for ${uid} (${file} != ${expected.file})`,
      {
        chunkUid: uid,
        detectedByStage: `identity.reconcile.${artifact}`,
        mintedByStage: expected.mintedByStage || null
      }
    );
  }
  const virtualPath = typeof reference?.virtualPath === 'string' ? reference.virtualPath.trim() : '';
  if (virtualPath && expected.virtualPath && virtualPath !== expected.virtualPath) {
    pushIssue(
      report,
      'ERR_ID_CHUNK_REFERENCE_VIRTUAL_PATH_MISMATCH',
      `${formatArtifactLabel(artifact, detail)} virtualPath mismatch for ${uid} (${virtualPath} != ${expected.virtualPath})`,
      {
        chunkUid: uid,
        detectedByStage: `identity.reconcile.${artifact}`,
        mintedByStage: expected.mintedByStage || null
      }
    );
  }
  const segmentUid = typeof reference?.segmentUid === 'string' ? reference.segmentUid.trim() : '';
  if (segmentUid && expected.segmentUid && segmentUid !== expected.segmentUid) {
    pushIssue(
      report,
      'ERR_ID_CHUNK_REFERENCE_SEGMENT_MISMATCH',
      `${formatArtifactLabel(artifact, detail)} segmentUid mismatch for ${uid} (${segmentUid} != ${expected.segmentUid})`,
      {
        chunkUid: uid,
        detectedByStage: `identity.reconcile.${artifact}`,
        mintedByStage: expected.mintedByStage || null
      }
    );
  }
  return expected;
};

const iterateResolvedSymbolRefChunkUids = function* (ref) {
  if (!ref || typeof ref !== 'object') return;
  if (ref.resolved && typeof ref.resolved === 'object') {
    yield { detail: 'resolved', reference: ref.resolved };
  }
  const candidates = Array.isArray(ref.candidates) ? ref.candidates : [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate || typeof candidate !== 'object') continue;
    yield { detail: `candidate[${index}]`, reference: candidate };
  }
};

const buildChunkIndex = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report
}) => {
  const chunkByUid = new Map();
  const chunkByDocId = new Map();
  for await (const row of loadChunkMetaRows(indexDir, {
    manifest,
    strict,
    maxBytes,
    preferBinaryColumnar: true,
    includeCold: true,
    enforceBinaryDataBudget: false
  })) {
    report.counts.chunkMeta += 1;
    let identity = null;
    try {
      identity = assertChunkIdentityEnvelope(
        buildChunkIdentityEnvelopeFromArtifactRow(row),
        {
          label: 'chunk_meta',
          requireChunkUid: true,
          requireVirtualPath: true,
          requireSegmentUid: !!(row?.segment || row?.metaV2?.segment)
        }
      );
    } catch (error) {
      pushIssue(report, 'ERR_ID_CHUNK_META_INVALID', String(error?.message || error), {
        detectedByStage: 'identity.reconcile.chunk_meta',
        ...extractChunkIdentityProvenance(row)
      });
      continue;
    }
    const provenance = extractChunkIdentityProvenance(row);
    identity = {
      ...identity,
      ...provenance
    };
    if (chunkByUid.has(identity.chunkUid)) {
      pushIssue(
        report,
        'ERR_ID_CHUNK_META_DUPLICATE_UID',
        `chunk_meta duplicate chunkUid (${identity.chunkUid})`,
        {
          chunkUid: identity.chunkUid,
          detectedByStage: 'identity.reconcile.chunk_meta',
          mintedByStage: identity.mintedByStage || null
        }
      );
      continue;
    }
    if (Number.isFinite(identity.docId)) {
      if (chunkByDocId.has(identity.docId)) {
        pushIssue(
          report,
          'ERR_ID_CHUNK_META_DUPLICATE_DOC_ID',
          `chunk_meta duplicate docId (${identity.docId})`,
          {
            docId: identity.docId,
            detectedByStage: 'identity.reconcile.chunk_meta',
            mintedByStage: identity.mintedByStage || null
          }
        );
      } else {
        chunkByDocId.set(identity.docId, identity);
      }
    }
    chunkByUid.set(identity.chunkUid, identity);
  }
  return { chunkByUid, chunkByDocId };
};

const reconcileCallSites = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid
}) => {
  if (!hasManifestPiece(manifest, 'call_sites')) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'call_sites', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.callSites += 1;
    validateKnownChunkReference({
      report,
      artifact: 'call_sites',
      detail: 'caller',
      reference: {
        chunkUid: row?.callerChunkUid || null,
        file: row?.file || null
      },
      chunkByUid
    });
    if (row?.targetChunkUid) {
      validateKnownChunkReference({
        report,
        artifact: 'call_sites',
        detail: 'target',
        reference: {
          chunkUid: row.targetChunkUid
        },
        chunkByUid
      });
    }
  }
};

const reconcileRiskSummaries = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid
}) => {
  if (!hasManifestPiece(manifest, 'risk_summaries')) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'risk_summaries', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.riskSummaries += 1;
    validateKnownChunkReference({
      report,
      artifact: 'risk_summaries',
      reference: row,
      chunkByUid
    });
  }
};

const reconcileRiskFlows = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid,
  partial = false
}) => {
  const artifact = partial ? 'risk_partial_flows' : 'risk_flows';
  if (!hasManifestPiece(manifest, artifact)) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, artifact, {
    manifest,
    strict,
    maxBytes
  })) {
    if (partial) {
      report.counts.riskPartialFlows += 1;
    } else {
      report.counts.riskFlows += 1;
    }
    validateKnownChunkReference({
      report,
      artifact,
      detail: 'source',
      reference: row?.source,
      chunkByUid
    });
    validateKnownChunkReference({
      report,
      artifact,
      detail: partial ? 'frontier' : 'sink',
      reference: partial ? row?.frontier : row?.sink,
      chunkByUid
    });
    const chunkUids = Array.isArray(row?.path?.chunkUids) ? row.path.chunkUids : [];
    for (let index = 0; index < chunkUids.length; index += 1) {
      validateKnownChunkReference({
        report,
        artifact,
        detail: `path[${index}]`,
        reference: { chunkUid: chunkUids[index] },
        chunkByUid
      });
    }
  }
};

const reconcileSymbols = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid
}) => {
  if (!hasManifestPiece(manifest, 'symbols')) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'symbols', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.symbols += 1;
    validateKnownChunkReference({
      report,
      artifact: 'symbols',
      reference: row,
      chunkByUid
    });
  }
};

const reconcileSymbolOccurrences = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid
}) => {
  if (!hasManifestPiece(manifest, 'symbol_occurrences')) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'symbol_occurrences', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.symbolOccurrences += 1;
    validateKnownChunkReference({
      report,
      artifact: 'symbol_occurrences',
      detail: 'host',
      reference: row?.host,
      chunkByUid
    });
    for (const candidate of iterateResolvedSymbolRefChunkUids(row?.ref)) {
      validateKnownChunkReference({
        report,
        artifact: 'symbol_occurrences',
        detail: candidate.detail,
        reference: candidate.reference,
        chunkByUid
      });
    }
  }
};

const reconcileSymbolEdges = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid
}) => {
  if (!hasManifestPiece(manifest, 'symbol_edges')) return;
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'symbol_edges', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.symbolEdges += 1;
    validateKnownChunkReference({
      report,
      artifact: 'symbol_edges',
      detail: 'from',
      reference: row?.from,
      chunkByUid
    });
    for (const candidate of iterateResolvedSymbolRefChunkUids(row?.to)) {
      validateKnownChunkReference({
        report,
        artifact: 'symbol_edges',
        detail: candidate.detail,
        reference: candidate.reference,
        chunkByUid
      });
    }
  }
};

const reconcileChunkUidMap = async ({
  indexDir,
  manifest,
  strict,
  maxBytes,
  report,
  chunkByUid,
  chunkByDocId
}) => {
  if (!hasManifestPiece(manifest, 'chunk_uid_map')) return;
  const seenDocIds = new Set();
  for await (const row of loadJsonArrayArtifactRows(indexDir, 'chunk_uid_map', {
    manifest,
    strict,
    maxBytes
  })) {
    report.counts.chunkUidMap += 1;
    const docId = Number(row?.docId);
    if (!Number.isFinite(docId)) {
      pushIssue(report, 'ERR_ID_CHUNK_UID_MAP_DOC_ID_MISSING', 'chunk_uid_map row missing numeric docId');
      continue;
    }
    if (seenDocIds.has(docId)) {
      pushIssue(report, 'ERR_ID_CHUNK_UID_MAP_DUPLICATE_DOC_ID', `chunk_uid_map duplicate docId (${docId})`, { docId });
      continue;
    }
    seenDocIds.add(docId);
    const expected = chunkByDocId.get(docId);
    if (!expected) {
      pushIssue(
        report,
        'ERR_ID_CHUNK_UID_MAP_DOC_ID_UNKNOWN',
        `chunk_uid_map docId missing in chunk_meta (${docId})`,
        { docId }
      );
      continue;
    }
    validateKnownChunkReference({
      report,
      artifact: 'chunk_uid_map',
      detail: `docId=${docId}`,
      reference: row,
      chunkByUid
    });
    const chunkUid = typeof row?.chunkUid === 'string' ? row.chunkUid.trim() : '';
    if (chunkUid && expected.chunkUid !== chunkUid) {
      pushIssue(
        report,
        'ERR_ID_CHUNK_UID_MAP_UID_MISMATCH',
        `chunk_uid_map chunkUid mismatch for docId ${docId} (${chunkUid} != ${expected.chunkUid})`,
        { docId, chunkUid }
      );
    }
  }
};

export const reconcileIndexIdentity = async ({
  indexDir,
  mode = 'code',
  strict = true,
  maxBytes = MAX_JSON_BYTES,
  maxIssues = DEFAULT_MAX_ISSUES
} = {}) => {
  if (!indexDir) {
    throw new Error('reconcileIndexIdentity requires indexDir');
  }
  const resolvedIndexDir = path.resolve(indexDir);
  const manifest = loadPiecesManifest(resolvedIndexDir, { maxBytes, strict });
  const report = {
    ok: true,
    indexDir: resolvedIndexDir,
    mode,
    strict,
    maxIssues,
    totalIssues: 0,
    counts: {
      chunkMeta: 0,
      symbols: 0,
      symbolOccurrences: 0,
      symbolEdges: 0,
      chunkUidMap: 0,
      callSites: 0,
      riskSummaries: 0,
      riskFlows: 0,
      riskPartialFlows: 0
    },
    issues: []
  };

  const { chunkByUid, chunkByDocId } = await buildChunkIndex({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report
  });

  if (mode === 'code') {
    await reconcileSymbols({
      indexDir: resolvedIndexDir,
      manifest,
      strict,
      maxBytes,
      report,
      chunkByUid
    });
    await reconcileSymbolOccurrences({
      indexDir: resolvedIndexDir,
      manifest,
      strict,
      maxBytes,
      report,
      chunkByUid
    });
    await reconcileSymbolEdges({
      indexDir: resolvedIndexDir,
      manifest,
      strict,
      maxBytes,
      report,
      chunkByUid
    });
  }

  await reconcileChunkUidMap({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report,
    chunkByUid,
    chunkByDocId
  });

  await reconcileCallSites({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report,
    chunkByUid
  });
  await reconcileRiskSummaries({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report,
    chunkByUid
  });
  await reconcileRiskFlows({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report,
    chunkByUid
  });
  await reconcileRiskFlows({
    indexDir: resolvedIndexDir,
    manifest,
    strict,
    maxBytes,
    report,
    chunkByUid,
    partial: true
  });

  report.summary = {
    chunkUidCount: chunkByUid.size,
    docIdCount: chunkByDocId.size
  };
  return report;
};
