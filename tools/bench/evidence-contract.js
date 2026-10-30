export const BENCH_EVIDENCE_VERSION = 1;
export const BENCH_EVIDENCE_ROOT = '.benchmark-evidence-root.json';
export const BENCH_EVIDENCE_OWNER = '.evidence-owner.json';
export const BENCH_EVIDENCE_SETTLED = '.evidence-settled.json';
export const BENCH_EVIDENCE_LOCK = '.evidence-writer.lock';
export const BENCH_EVIDENCE_CONTROL = '.evidence-control';
export const BENCH_EVIDENCE_MAX_FILES = 10000;
export const BENCH_EVIDENCE_RECORD_BYTES = 16 * 1024 * 1024;
export const BENCH_EVIDENCE_HARD_BYTES = 2 * 1024 * 1024 * 1024;
export const BENCH_EVIDENCE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const BENCH_EVIDENCE_FAMILIES = Object.freeze(['ab-sweep', 'embedding-model-bakeoff']);
export const benchmarkEvidenceFailure = (code, message, cause) => Object.assign(new Error(message, { cause }), { code });
export const benchmarkEvidenceName = name => typeof name === 'string' && name.length > 0 && name.length <= 512
  && name !== '.' && name !== '..' && !/[\\/:\u0000-\u001f]/u.test(name)
  && !name.endsWith('.') && !name.endsWith(' ');
export const benchmarkEvidenceId = value => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
export const benchmarkEvidenceRootIdentity = stat => Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
export const sameBenchmarkEvidenceRoot = (left, right) => left?.dev === right?.dev && left?.ino === right?.ino;
