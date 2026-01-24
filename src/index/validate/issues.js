export const addIssue = (report, mode, message, hint = null, bucket = 'issues') => {
  const tag = mode ? `[${mode}] ` : '';
  report[bucket].push(`${tag}${message}`);
  if (hint) report.hints.push(hint);
};
