export const formatTruncationRecord = (record) => {
  if (!record) return '';
  const pieces = [`${record.cap}`];
  if (record.limit != null) pieces.push(`limit=${JSON.stringify(record.limit)}`);
  if (record.observed != null) pieces.push(`observed=${JSON.stringify(record.observed)}`);
  if (record.omitted != null) pieces.push(`omitted=${JSON.stringify(record.omitted)}`);
  return pieces.join(' ');
};

export const appendReportTruncation = (lines, truncation) => {
  const records = Array.isArray(truncation) ? truncation : [];
  if (!records.length) return;
  lines.push('Truncation:');
  for (const record of records) {
    lines.push(`- ${formatTruncationRecord(record)}`);
  }
};

export const appendReportWarnings = (lines, warnings) => {
  const records = Array.isArray(warnings) ? warnings : [];
  if (!records.length) return;
  lines.push('Warnings:');
  for (const warning of records) {
    const prefix = warning?.code ? `${warning.code}: ` : '';
    lines.push(`- ${prefix}${warning?.message || ''}`.trim());
  }
};

export const appendReportFooterSections = (lines, report) => {
  appendReportTruncation(lines, report?.truncation);
  appendReportWarnings(lines, report?.warnings);
};
