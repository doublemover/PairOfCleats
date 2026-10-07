import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';

export const RUNTIME_ADMISSION_POLICY_VERSION = 'tooling-runtime-admission@1';

/** Parse only an observed, bounded tool version; a provider contract version is not input evidence. */
export const parseObservedToolVersion = (text) => {
  const source = String(text || '').slice(0, 512);
  const match = /(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?:$|[^0-9])/u.exec(source);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2],
    prerelease: match[4]?.slice(1) || null, observed: match[0].replace(/^[^0-9v]+/u, '').trim() };
};

/** Upstream permits stable matching major/minor and differing patches; nightly compatibility remains unverified here. */
export const assessZlsZigCompatibility = ({ zlsVersionText, zigVersionText } = {}) => {
  const zls = parseObservedToolVersion(zlsVersionText);
  const zig = parseObservedToolVersion(zigVersionText);
  const base = { policyVersion: RUNTIME_ADMISSION_POLICY_VERSION, family: 'zls-zig', zls, zig,
    evidence: 'upstream-release-family-rule', semanticVerified: false };
  if (!zls || !zig) return { ...base, state: 'unverified', reasonCode: 'runtime_version_unavailable' };
  if (Boolean(zls.prerelease) !== Boolean(zig.prerelease)) {
    return { ...base, state: 'incompatible', reasonCode: 'zls_zig_release_channel_mismatch' };
  }
  if (zls.prerelease && zig.prerelease) {
    return { ...base, state: 'unverified', reasonCode: 'zls_zig_nightly_pair_unverified' };
  }
  if (zls.major !== zig.major || zls.minor !== zig.minor) {
    return { ...base, state: 'incompatible', reasonCode: 'zls_zig_release_family_mismatch' };
  }
  return { ...base, state: 'admissible', reasonCode: 'zls_zig_matching_release_family' };
};

/** Select from already-probed existing candidates only. This function does not discover, launch, install or authorize software. */
export const selectExistingRuntimeCandidate = ({ candidates = [], explicitCommand = false,
  strictReproducibility = false, requirePinnedIdentity = false, allowGlobalFallback = true,
  operationRequired = false } = {}) => {
  const inspected = (Array.isArray(candidates) ? candidates : []).slice(0, explicitCommand ? 1 : 3);
  const rejected = [];
  for (let index = 0; index < inspected.length; index += 1) {
    const candidate = inspected[index];
    if (!candidate || typeof candidate !== 'object') continue;
    if (candidate.authority !== 'allowed') {
      return { state: 'blocked', reasonCode: 'execution_authority_unavailable', selected: null,
        rejected, fallbackUsed: false, semanticVerified: false };
    }
    if (!allowGlobalFallback && ['global', 'path'].includes(candidate.source)) {
      rejected.push({ index, reasonCode: 'global_fallback_disabled' });
      continue;
    }
    if (strictReproducibility && (index > 0 || (requirePinnedIdentity && candidate.pinSatisfied !== true))) {
      rejected.push({ index, reasonCode: 'reproducible_selection_unavailable' });
      break;
    }
    if (candidate.probeOk !== true || candidate.layoutValid === false
      || candidate.compatibility?.state === 'incompatible') {
      rejected.push({ index, reasonCode: candidate.compatibility?.reasonCode
        || (candidate.layoutValid === false ? 'broken_layout' : 'command_unavailable') });
      continue;
    }
    return { state: candidate.compatibility?.state === 'admissible' ? 'operational-admissible' : 'operational-unverified',
      reasonCode: index > 0 ? 'existing_candidate_fallback' : 'preferred_existing_candidate', selected: candidate,
      rejected, fallbackUsed: index > 0, semanticVerified: false };
  }
  return { state: operationRequired ? 'required-unavailable' : 'optional-unavailable',
    reasonCode: rejected.some(item => item.reasonCode.includes('mismatch')) ? 'incompatible_runtime' : 'no_admissible_existing_candidate',
    selected: null, rejected, fallbackUsed: false, semanticVerified: false };
};

/** Missing wrapper/SDK/pin identity disables cache admission; timestamps alone are not universal compatibility evidence. */
export const buildRuntimeSelectionFingerprint = ({ selected, sdkPins = [], identityComplete = false,
  capabilityPolicyVersion = null } = {}) => {
  const identity = selected?.identity;
  if (!identityComplete || !identity || typeof identity.canonicalPath !== 'string'
    || !Number.isFinite(identity.size) || identity.size < 0 || !Number.isFinite(identity.mtimeMs)
    || typeof identity.contentOrPackageDigest !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(identity.contentOrPackageDigest)) return null;
  const pins = Array.isArray(sdkPins) ? sdkPins : [];
  if (pins.some(pin => !pin || typeof pin.id !== 'string' || typeof pin.digest !== 'string'
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(pin.digest))) return null;
  const payload = { policy: RUNTIME_ADMISSION_POLICY_VERSION, selectedSource: selected.source,
    identity, observedVersion: selected.observedVersion || null, compatibility: selected.compatibility || null,
    sdkPins: [...pins].sort((a, b) => a.id.localeCompare(b.id)), capabilityPolicyVersion };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
};
