import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../stable-json.js';
import { embeddingArtifactReusable } from '../embedding-artifact-identity.js';

const leases = new WeakMap();
const require = createRequire(import.meta.url);
const invalid = message => Object.assign(new Error(message), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
export const currentOnnxQualificationRuntime = () => {
  let directory = path.dirname(require.resolve('onnxruntime-node')), version = null;
  for (let depth = 0; depth < 8; depth++) {
    const filename = path.join(directory, 'package.json');
    if (fs.existsSync(filename) && fs.statSync(filename).size <= 64 * 1024) {
      const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (metadata.name === 'onnxruntime-node') { version = metadata.version; break; }
    }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  if (!version) throw invalid('ONNX runtime package identity is unavailable.');
  return { provider: 'onnx', runtime: `onnxruntime-node@${version}`, node: process.version,
    abi: process.versions.modules || null, platform: process.platform, arch: process.arch };
};

export const createOnnxQualificationBinding = ({ modelArtifact, modelPath, cpuBudget, memory,
  processing = null, workload = null, sessionSettings = null, source = null, runtime = currentOnnxQualificationRuntime() }) => {
  if (!embeddingArtifactReusable(modelArtifact) || modelArtifact.status !== 'verified' || !modelPath
    || !Number.isSafeInteger(cpuBudget) || cpuBudget <= 0 || !Number.isSafeInteger(memory?.totalBytes) || memory.totalBytes <= 0) throw invalid('Qualification requires verified model/tokenizer, runtime and resource identity.');
  return { schemaVersion: 1, modelArtifact, modelPath: path.resolve(modelPath), runtime,
    processing, workload, sessionSettings, source,
    resources: { cpuBudget, totalBytes: memory.totalBytes, constrainedBytes: memory.constrainedBytes ?? null,
      configuredLimitBytes: memory.configuredLimitBytes ?? null } };
};

/** Native single-session reports are memory admission evidence only. They never
 * activate settings or equate requested options with effective native threads. */
export const sealOnnxMemoryEvidence = ({ binding, measuredSessionBytes, completedAt = new Date().toISOString() }) => {
  if (!Number.isSafeInteger(measuredSessionBytes) || measuredSessionBytes <= 0) return null;
  const value = { schemaVersion: 1, qualifier: 'native-onnx-profile-v1', bindingDigest: digest(binding),
    measuredSessionBytes, sessions: 1, disposalConfirmed: true, completedAt };
  return { ...value, digest: digest(value) };
};
const admitMemory = (evidence, binding, sessions, freeBytes, now) => {
  if (sessions === 1) return;
  const { digest: supplied, ...value } = evidence || {};
  const at = Date.parse(value.completedAt);
  if (value.schemaVersion !== 1 || value.qualifier !== 'native-onnx-profile-v1' || value.sessions !== 1
    || value.disposalConfirmed !== true || value.bindingDigest !== digest(binding) || supplied !== digest(value)
    || !Number.isSafeInteger(value.measuredSessionBytes) || value.measuredSessionBytes <= 0
    || !Number.isFinite(at) || now < at || now - at > 30 * 60 * 1000
    || !Number.isSafeInteger(freeBytes) || freeBytes <= 0
    || value.measuredSessionBytes * sessions > Math.floor(freeBytes / 4)) throw invalid('Session pools require fresh matching native memory/disposal evidence within current headroom.');
};

/** A process-local experiment capability, never deserialized as an accepted
 * production profile. One experiment owns at most two independent sessions. */
export const createOnnxQualificationLease = ({ binding, candidate, memory, memoryEvidence = null, now = Date.now() }) => {
  candidate = candidate && typeof candidate === 'object' ? candidate : {};
  const sessions = candidate?.sessions ?? 1, intra = candidate?.intraOpNumThreads ?? 1,
    inter = candidate?.interOpNumThreads ?? 1;
  if (!binding?.resources || binding.schemaVersion !== 1 || !embeddingArtifactReusable(binding.modelArtifact)
    || binding.modelArtifact.status !== 'verified' || !Number.isSafeInteger(binding.resources.cpuBudget) || binding.resources.cpuBudget <= 0
    || ![1, 2].includes(sessions) || !Number.isSafeInteger(intra) || intra <= 0
    || inter !== 1 || sessions * intra > binding.resources.cpuBudget
    || !['disabled', 'basic', 'extended', 'all'].includes(candidate.graphOptimizationLevel)
    || typeof candidate.enableCpuMemArena !== 'boolean' || typeof candidate.enableMemPattern !== 'boolean') throw invalid('Requested ONNX profile exceeds the experiment CPU/settings envelope.');
  const settings = { intraOpNumThreads: intra, interOpNumThreads: inter, graphOptimizationLevel: candidate.graphOptimizationLevel,
    enableCpuMemArena: candidate.enableCpuMemArena, enableMemPattern: candidate.enableMemPattern };
  if (!binding.sessionSettings || digest(binding.sessionSettings) !== digest(settings)) throw invalid('Profile settings disagree with their evidence binding.');
  // Separate pools are investigated only after a completed same-model real run.
  admitMemory(memoryEvidence, binding, sessions, memory?.freeBytes, now);
  const lease = Object.freeze({ kind: 'onnx-qualification-only', id: randomUUID(), bindingDigest: digest(binding) });
  leases.set(lease, { binding: structuredClone(binding), candidate: { sessions, intraOpNumThreads: intra, interOpNumThreads: inter,
    graphOptimizationLevel: candidate.graphOptimizationLevel, enableCpuMemArena: candidate.enableCpuMemArena,
    enableMemPattern: candidate.enableMemPattern, executionMode: 'sequential',
    executionProviders: [{ name: 'cpu', useArena: candidate.enableCpuMemArena }] },
  active: new Set(), closed: false });
  return lease;
};

export const acquireOnnxQualificationSlot = (lease, { modelArtifact, modelPath, lowMemory, processing = null }) => {
  const entry = leases.get(lease);
  if (!entry || entry.closed || entry.active.size >= entry.candidate.sessions
    || digest(modelArtifact) !== digest(entry.binding.modelArtifact)
    || digest(processing) !== digest(entry.binding.processing)
    || path.resolve(modelPath) !== entry.binding.modelPath
    || digest(currentOnnxQualificationRuntime()) !== digest(entry.binding.runtime)) throw invalid('ONNX qualification capability is stale, forged, full or incompatible.');
  if (lowMemory && (entry.candidate.enableCpuMemArena || entry.candidate.enableMemPattern
    || !['disabled', 'basic'].includes(entry.candidate.graphOptimizationLevel))) throw invalid('Unqualified profiles cannot weaken large-model memory safeguards.');
  const id = randomUUID(); entry.active.add(id);
  const { sessions: ignored, ...options } = entry.candidate; void ignored;
  let released = false;
  return { sessionKey: `${lease.id}:${id}`, options: structuredClone(options), bindingDigest: lease.bindingDigest,
    release() { if (!released) { released = true; entry.active.delete(id); } } };
};

export const closeOnnxQualificationLease = lease => {
  const entry = leases.get(lease);
  if (!entry) throw invalid('Unknown ONNX qualification capability.');
  entry.closed = true;
  if (entry.active.size) {
    const error = invalid('ONNX qualification still owns unsettled native sessions.');
    Object.defineProperties(error, { qualificationLease: { value: lease },
      cacheOwnershipPending: { get: () => entry.active.size > 0 },
      cacheOwnershipReleased: { value: () => entry.closed && entry.active.size === 0 } });
    throw error;
  }
};
