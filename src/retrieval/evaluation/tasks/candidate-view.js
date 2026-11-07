import { randomUUID } from 'node:crypto';
import { evidenceTaskSplitMembership } from './splits.js';
import { projectCandidateEvidenceTask, readCandidateEvidenceSource, readCandidateEvidencePrefix } from './compiler.js';

const views = new WeakMap(), retired = new WeakMap();
const fail = () => Object.assign(new Error('Original active visible task view required.'), { code: 'ERR_EVIDENCE_TASK_VIEW' });
const get = view => {
  const value = view && typeof view === 'object' ? views.get(view) : null;
  if (!value) throw fail(); return value;
};
/** A candidate role capability, without oracle/split/compilation accessors.
 * Only registered declarative methods execute; arbitrary candidate JS does not.
 */
export const materializeEvidenceTaskView = ({ task, manifest }) => {
  const membership = evidenceTaskSplitMembership(manifest, task);
  if (membership.state !== 'frozen') throw Object.assign(new Error('Quarantined task cannot materialize a candidate view.'), { code: 'ERR_EVIDENCE_TASK_QUARANTINED' });
  const packet = projectCandidateEvidenceTask(task, { limit: 1, maxBytes: 131072 });
  const view = Object.freeze({ profile: 'finite-source-evidence-v1', publicTaskId: packet.publicTaskId });
  views.set(view, { task }); return view;
};
export const projectEvidenceTaskView = (view, options = {}) => projectCandidateEvidenceTask(get(view).task, options);
export const readEvidenceTaskViewSource = (view, ref, options = {}) => readCandidateEvidenceSource(get(view).task, ref, options);
export const readEvidenceTaskViewPrefix = (view, sourceUnitId, options = {}) => readCandidateEvidencePrefix(get(view).task, sourceUnitId, options);
export const disposeEvidenceTaskView = view => {
  if (view && typeof view === 'object' && retired.has(view)) return retired.get(view);
  get(view);
  const receipt = Object.freeze({ kind: 'finite-evidence-candidate-view-retirement', publicTaskId: view.publicTaskId,
    executionId: randomUUID(), status: 'retired', compiledTask: 'remains-owned-by-corpus', nativeResources: 'none' });
  views.delete(view); retired.set(view, receipt); return receipt;
};
