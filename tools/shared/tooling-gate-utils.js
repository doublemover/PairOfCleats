import path from 'node:path';
import { normalizeProviderId } from '../../src/index/tooling/provider-contract.js';
import { readJsonFileResolved, writeJsonFileResolved } from './json-utils.js';

export { normalizeProviderId };

export const mapProvidersById = (providers) => new Map(
  (Array.isArray(providers) ? providers : [])
    .map((provider) => [normalizeProviderId(provider?.id), provider])
    .filter(([id]) => Boolean(id))
);

/**
 * Resolve a doctor input path that may be either a full report or gate payload.
 *
 * @param {string} doctorPath
 * @returns {Promise<{report:object,reportPath:string,inputPath:string}>}
 */
export const resolveDoctorReportInput = async (doctorPath) => {
  const inputPath = path.resolve(String(doctorPath || ''));
  const payload = await readJsonFileResolved(inputPath);
  if (payload && Array.isArray(payload.providers)) {
    return {
      report: payload,
      reportPath: inputPath,
      inputPath
    };
  }
  const reportPathRaw = String(payload?.reportPath || '').trim();
  if (!reportPathRaw) {
    throw new Error(`doctor input missing providers/reportPath: ${inputPath}`);
  }
  const reportPath = path.isAbsolute(reportPathRaw)
    ? reportPathRaw
    : path.resolve(path.dirname(inputPath), reportPathRaw);
  const report = await readJsonFileResolved(reportPath);
  if (!report || !Array.isArray(report.providers)) {
    throw new Error(`resolved doctor report missing providers: ${reportPath}`);
  }
  return {
    report,
    reportPath: path.resolve(reportPath),
    inputPath
  };
};

/**
 * Emit a gate payload to disk, render a compact console summary, and optionally fail.
 *
 * @param {{
 *   jsonPath: string,
 *   payload: object,
 *   heading: string,
 *   summaryLines?: string[],
 *   failures?: unknown[],
 *   renderFailure?: (failure: unknown) => string
 * }} input
 * @returns {Promise<void>}
 */
export const emitGateResult = async ({
  jsonPath,
  payload,
  heading,
  summaryLines = [],
  failures = [],
  renderFailure = (failure) => String(failure)
}) => {
  await writeJsonFileResolved(jsonPath, payload, { trailingNewline: true });
  console.error(heading);
  for (const line of Array.isArray(summaryLines) ? summaryLines : []) {
    console.error(line);
  }
  if (!Array.isArray(failures) || !failures.length) return;
  for (const failure of failures) {
    console.error(`  - ${renderFailure(failure)}`);
  }
  process.exit(3);
};
