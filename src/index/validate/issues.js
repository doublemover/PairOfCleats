export const validationFindings = report => (report.findings ||= []);

export const validationErrorMetadata = (error, artifact, fallbackCode = 'ERR_INDEX_ARTIFACT_READ') => {
  const code = error?.code;
  return { artifact, code: typeof code === 'string' && code ? code : fallbackCode,
    state: ['ENOENT', 'ENOTDIR', 'ERR_MANIFEST_MISSING'].includes(code) ? 'missing'
      : ['EIO', 'EACCES', 'EPERM', 'EMFILE', 'ENFILE', 'ERR_FILE_CHANGED'].includes(code) ? 'unverified' : 'invalid' };
};

export const addIssue = (report, mode, message, hint = null, bucket = 'issues', metadata = {}) => {
  const scope = metadata.displayScope ?? mode;
  const tag = scope ? `[${scope}] ` : '';
  const finding = Object.freeze({ mode: mode || null, capability: metadata.capability || 'artifacts',
    code: metadata.code || 'ERR_INDEX_VALIDATION', severity: bucket === 'warnings' ? 'warning' : 'error',
    state: metadata.state || (bucket === 'warnings' ? 'warning' : 'invalid'), artifact: metadata.artifact || null,
    detail: message, display: `${tag}${message}`, modeMessage: metadata.modeMessage ?? message, hint });
  validationFindings(report).push(finding);
  report[bucket].push(finding.display);
  if (hint) report.hints.push(hint);
  return finding;
};

export const mergeValidationFindings = (report, source, index = validationFindings(report).length) => {
  const rows = validationFindings(source);
  const prefix = index === report.findings.length ? null : report.findings.slice(0, index);
  const issueIndex = prefix ? prefix.filter(row => row.severity === 'error').length : report.issues.length;
  const warningIndex = prefix ? prefix.filter(row => row.severity === 'warning').length : report.warnings.length;
  for (let offset = 0; offset < rows.length; offset += 2048) {
    validationFindings(report).splice(index + offset, 0, ...rows.slice(offset, offset + 2048));
  }
  for (const [bucket, at, severity] of [['issues', issueIndex, 'error'], ['warnings', warningIndex, 'warning']]) {
    const messages = rows.filter(row => row.severity === severity).map(row => row.display);
    for (let offset = 0; offset < messages.length; offset += 2048) {
      report[bucket].splice(at + offset, 0, ...messages.slice(offset, offset + 2048));
    }
  }
};

const projectValidationDiagnostics = report => {
  report.issues = validationFindings(report).filter(row => row.severity === 'error').map(row => row.display);
  report.warnings = validationFindings(report).filter(row => row.severity === 'warning').map(row => row.display);
};

/** Called after deferred manifest and backend owners settle, without more I/O. */
export const finalizeValidationReport = report => {
  projectValidationDiagnostics(report);
  for (const [mode, receipt] of Object.entries(report.modes)) {
    const owned = report.findings.filter(row => row.mode === mode);
    const errors = owned.filter(row => row.severity === 'error');
    receipt.ok = errors.length === 0;
    receipt.missing = errors.filter(row => row.state === 'missing').map(row => row.modeMessage);
    receipt.invalid = errors.filter(row => row.state === 'invalid').map(row => row.modeMessage);
    receipt.warnings = owned.filter(row => row.severity === 'warning').map(row => row.modeMessage);
    receipt.unverified = owned.filter(row => row.state === 'unverified').map(row => row.modeMessage);
    receipt.state = receipt.invalid.length ? 'invalid' : receipt.missing.length ? 'missing'
      : receipt.unverified.length ? 'unverified' : 'valid';
  }
  for (const capability of ['sqlite', 'lmdb']) if (report[capability]) {
    report[capability].ok = !report.findings.some(row => row.capability === capability && row.severity === 'error');
  }
  report.ok = report.findings.every(row => row.severity !== 'error');
  return report;
};
