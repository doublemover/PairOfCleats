import { loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { addIssue } from './issues.js';
import { validateSchema } from './schema.js';

const normalizeBool = (value) => value === true;

export const validateRiskInterproceduralArtifacts = async ({
  report,
  mode,
  dir,
  manifest,
  strict,
  chunkUidSet,
  indexState,
  readJsonArtifact,
  shouldLoadOptional,
  checkPresence
}) => {
  if (mode !== 'code') return;
  const riskState = indexState?.riskInterprocedural || null;
  if (!riskState) return;

  const emitArtifacts = riskState.emitArtifacts !== 'none';
  const enabled = normalizeBool(riskState.enabled);
  const summaryOnly = normalizeBool(riskState.summaryOnly);

  if (strict && emitArtifacts && enabled) {
    checkPresence('risk_summaries', { required: true });
  }
  if (strict && emitArtifacts && enabled && !summaryOnly) {
    checkPresence('risk_flows', { required: true });
    checkPresence('call_sites', { required: true });
  }
  if (strict) {
    checkPresence('risk_interprocedural_stats', { required: true });
  }

  const stats = readJsonArtifact('risk_interprocedural_stats');
  if (stats) {
    validateSchema(report, mode, 'risk_interprocedural_stats', stats, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    if (stats.status === 'timed_out') {
      const flowsEmitted = Number(stats.counts?.flowsEmitted || 0);
      const uniqueCallSites = Number(stats.counts?.uniqueCallSitesReferenced || 0);
      if (flowsEmitted !== 0 || uniqueCallSites !== 0) {
        addIssue(report, mode, 'risk interprocedural stats timed_out but flows were emitted');
      }
    }
  }

  let chunkUidToFile = null;
  if (shouldLoadOptional('chunk_uid_map')) {
    try {
      const chunkUidMap = await loadJsonArrayArtifact(dir, 'chunk_uid_map', { manifest, strict });
      chunkUidToFile = new Map();
      for (const entry of chunkUidMap) {
        if (entry?.chunkUid && entry?.file && !chunkUidToFile.has(entry.chunkUid)) {
          chunkUidToFile.set(entry.chunkUid, entry.file);
        }
      }
    } catch (err) {
      addIssue(report, mode, `chunk_uid_map load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }
  const knownChunkUids = chunkUidSet?.size ? chunkUidSet : (chunkUidToFile ? new Set(chunkUidToFile.keys()) : chunkUidSet);

  if (!emitArtifacts || !enabled) return;

  if (shouldLoadOptional('risk_summaries')) {
    try {
      const summaries = await loadJsonArrayArtifact(dir, 'risk_summaries', { manifest, strict });
      validateSchema(report, mode, 'risk_summaries', summaries, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      const seenSummaryChunks = new Set();
      for (const summary of summaries) {
        const chunkUid = summary?.chunkUid || null;
        if (chunkUid) {
          if (seenSummaryChunks.has(chunkUid)) {
            addIssue(report, mode, `risk_summaries contains duplicate chunkUid ${chunkUid}`, 'Rebuild index artifacts for this mode.');
            break;
          }
          seenSummaryChunks.add(chunkUid);
          if (knownChunkUids && !knownChunkUids.has(chunkUid)) {
            addIssue(report, mode, `risk_summaries references unknown chunkUid ${chunkUid}`, 'Rebuild index artifacts for this mode.');
            break;
          }
          if (chunkUidToFile) {
            const expectedFile = chunkUidToFile.get(chunkUid);
            if (expectedFile && summary?.file && summary.file !== expectedFile) {
              addIssue(report, mode, `risk_summaries file mismatch for ${chunkUid} (${summary.file} != ${expectedFile})`, 'Rebuild index artifacts for this mode.');
              break;
            }
          }
        }
      }
      if (stats?.counts?.summariesEmitted !== undefined && summaries.length !== stats.counts.summariesEmitted) {
        addIssue(report, mode, `risk_summaries count mismatch (${summaries.length} != ${stats.counts.summariesEmitted})`, 'Rebuild index artifacts for this mode.');
      }
    } catch (err) {
      addIssue(report, mode, `risk_summaries load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }

  const shouldValidateFlows = !summaryOnly && stats?.status === 'ok';
  if (!shouldValidateFlows) return;

  let callSiteIds = null;
  if (shouldLoadOptional('call_sites')) {
    try {
      const callSites = await loadJsonArrayArtifact(dir, 'call_sites', { manifest, strict });
      callSiteIds = new Set(callSites.map((row) => row?.callSiteId).filter(Boolean));
      if (stats?.counts?.uniqueCallSitesReferenced !== undefined && stats.counts.uniqueCallSitesReferenced > callSiteIds.size) {
        addIssue(report, mode, `risk_interprocedural_stats uniqueCallSitesReferenced exceeds call_sites rows (${stats.counts.uniqueCallSitesReferenced} > ${callSiteIds.size})`, 'Rebuild index artifacts for this mode.');
      }
    } catch (err) {
      addIssue(report, mode, `call_sites load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }

  if (shouldLoadOptional('risk_flows')) {
    try {
      const flows = await loadJsonArrayArtifact(dir, 'risk_flows', { manifest, strict });
      validateSchema(report, mode, 'risk_flows', flows, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      if (stats?.counts?.flowsEmitted !== undefined && flows.length !== stats.counts.flowsEmitted) {
        addIssue(report, mode, `risk_flows count mismatch (${flows.length} != ${stats.counts.flowsEmitted})`, 'Rebuild index artifacts for this mode.');
      }
      const referencedCallSites = new Set();
      for (const flow of flows) {
        const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
        if (chunkUids.length < 2) {
          addIssue(report, mode, 'risk_flows path.chunkUids must have at least 2 entries', 'Rebuild index artifacts for this mode.');
          break;
        }
        const expectedSteps = chunkUids.length - 1;
        const steps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
        if (steps.length !== expectedSteps) {
          addIssue(report, mode, 'risk_flows path.callSiteIdsByStep length mismatch', 'Rebuild index artifacts for this mode.');
          break;
        }
        if (flow?.source?.chunkUid && flow.source.chunkUid !== chunkUids[0]) {
          addIssue(report, mode, 'risk_flows path start does not match source chunkUid', 'Rebuild index artifacts for this mode.');
          break;
        }
        if (flow?.sink?.chunkUid && flow.sink.chunkUid !== chunkUids[chunkUids.length - 1]) {
          addIssue(report, mode, 'risk_flows path end does not match sink chunkUid', 'Rebuild index artifacts for this mode.');
          break;
        }
        for (const uid of chunkUids) {
          if (uid && knownChunkUids && !knownChunkUids.has(uid)) {
            addIssue(report, mode, `risk_flows references unknown chunkUid ${uid}`, 'Rebuild index artifacts for this mode.');
            break;
          }
        }
        if (callSiteIds) {
          for (const step of steps) {
            for (const callSiteId of step || []) {
              if (callSiteId) {
                referencedCallSites.add(callSiteId);
                if (!callSiteIds.has(callSiteId)) {
                  addIssue(report, mode, `risk_flows references missing callSiteId ${callSiteId}`, 'Rebuild index artifacts for this mode.');
                  break;
                }
              }
            }
          }
        }
      }
      if (stats?.counts?.uniqueCallSitesReferenced !== undefined && referencedCallSites.size && referencedCallSites.size !== stats.counts.uniqueCallSitesReferenced) {
        addIssue(report, mode, `risk_interprocedural_stats uniqueCallSitesReferenced mismatch (${referencedCallSites.size} != ${stats.counts.uniqueCallSitesReferenced})`, 'Rebuild index artifacts for this mode.');
      }
    } catch (err) {
      addIssue(report, mode, `risk_flows load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }
};
