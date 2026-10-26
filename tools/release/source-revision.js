import { execFileSync } from 'node:child_process';

const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
export const releaseSourceErrors = (observed, expected = null) => {
  const errors = [];
  if (typeof observed !== 'string' || !COMMIT.test(observed)) errors.push('observed source commit must be a full Git object ID');
  if (expected !== null) {
    if (typeof expected !== 'string' || !COMMIT.test(expected)) errors.push('prepared source commit must be a full Git object ID');
    else if (typeof observed === 'string' && observed.toLowerCase() !== expected.toLowerCase()) errors.push('observed source commit differs from prepared source commit');
  }
  return errors;
};

/** Observe the checkout itself; metadata and GitHub event variables are not
 * substitutes for the revision whose source is actually being executed. */
export const observeReleaseSource = root => {
  const observed = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 4096,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  const errors = releaseSourceErrors(observed);
  if (errors.length) throw new Error('release source: ' + errors.join('; '));
  return observed.toLowerCase();
};

export const assertReleaseSource = (root, expected = null) => {
  const observed = observeReleaseSource(root), errors = releaseSourceErrors(observed, expected);
  if (errors.length) throw new Error('release source: ' + errors.join('; '));
  return observed;
};

export const releaseWorkflowSourceErrors = workflow => {
  const errors = [];
  if (!workflow?.jobs?.prepare) return ['release workflow requires prepare'];
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const checkouts = (job.steps || []).filter(step => /^actions\/checkout@/.test(step.uses || ''));
    if (!checkouts.length) continue;
    const ref = name === 'prepare' ? "${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref }}"
      : '${{ needs.prepare.outputs.release_git_sha }}';
    if (checkouts.some(step => step.with?.ref !== ref)) errors.push(`${name} must check out ${ref}`);
    if (name !== 'prepare' && ![].concat(job.needs || []).includes('prepare')) errors.push(`${name} must depend directly on prepare`);
  }
  return errors;
};

export const SBOM_SOURCE_PROPERTY = 'pairofcleats:observedSourceCommit';
export const bindSbomSource = (bom, observed) => {
  const errors = releaseSourceErrors(observed);
  if (!bom || bom.bomFormat !== 'CycloneDX') errors.push('SBOM must be CycloneDX');
  const properties = bom?.metadata?.properties || [];
  if (!Array.isArray(properties)) errors.push('SBOM metadata.properties must be an array');
  else for (const property of properties) if (property?.name === SBOM_SOURCE_PROPERTY) errors.push(...releaseSourceErrors(property.value, observed));
  if (errors.length) throw new Error('release source: ' + errors.join('; '));
  return { ...bom, metadata: { ...(bom.metadata || {}), properties: [
    ...properties.filter(property => property?.name !== SBOM_SOURCE_PROPERTY), { name: SBOM_SOURCE_PROPERTY, value: observed }
  ] } };
};
