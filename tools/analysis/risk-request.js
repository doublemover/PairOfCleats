import {
  buildValidatedRiskFilters,
  normalizeValidatedRiskFilters
} from '../../src/shared/risk-filters.js';

const toTrimmedString = (value) => (
  value == null ? '' : String(value).trim()
);

const resolveNestedRiskFilters = (input) => normalizeValidatedRiskFilters(input?.filters || null);

/**
 * Project API/MCP-style risk explain input into the payload builder shape.
 * Repo resolution, index checks, progress, and transport errors stay local to
 * each surface.
 *
 * @param {object} [input]
 * @returns {{
 *   chunkUid:string,
 *   max:unknown,
 *   filters:object|null,
 *   filterValidation:{ok:boolean,errors:string[]},
 *   includePartialFlows:boolean,
 *   maxPartialFlows:unknown
 * }}
 */
export function projectRiskExplainRequest(input = {}) {
  const { filters, validation: filterValidation } = resolveNestedRiskFilters(input);
  return {
    chunkUid: toTrimmedString(input?.chunk),
    max: input?.max,
    filters,
    filterValidation,
    includePartialFlows: input?.includePartialFlows === true,
    maxPartialFlows: input?.maxPartialFlows
  };
}

/**
 * Project CLI risk explain argv, where filter fields live on argv itself.
 *
 * @param {object} [argv]
 * @returns {ReturnType<typeof projectRiskExplainRequest>}
 */
export function projectCliRiskExplainRequest(argv = {}) {
  const { filters, validation: filterValidation } = buildValidatedRiskFilters(argv);
  return {
    chunkUid: toTrimmedString(argv?.chunk),
    max: argv?.max,
    filters,
    filterValidation,
    includePartialFlows: argv?.includePartialFlows === true,
    maxPartialFlows: argv?.maxPartialFlows
  };
}

/**
 * Project API/MCP-style risk delta input into the payload builder shape.
 *
 * @param {object} [input]
 * @returns {{
 *   fromRef:string,
 *   toRef:string,
 *   seed:string,
 *   filters:object|null,
 *   filterValidation:{ok:boolean,errors:string[]},
 *   includePartialFlows:boolean
 * }}
 */
export function projectRiskDeltaRequest(input = {}) {
  const { filters, validation: filterValidation } = resolveNestedRiskFilters(input);
  return {
    fromRef: toTrimmedString(input?.from),
    toRef: toTrimmedString(input?.to),
    seed: toTrimmedString(input?.seed),
    filters,
    filterValidation,
    includePartialFlows: input?.includePartialFlows === true
  };
}

/**
 * Project CLI risk delta argv, where filter fields live on argv itself.
 *
 * @param {object} [argv]
 * @returns {ReturnType<typeof projectRiskDeltaRequest>}
 */
export function projectCliRiskDeltaRequest(argv = {}) {
  const { filters, validation: filterValidation } = buildValidatedRiskFilters(argv);
  return {
    fromRef: toTrimmedString(argv?.from),
    toRef: toTrimmedString(argv?.to),
    seed: toTrimmedString(argv?.seed),
    filters,
    filterValidation,
    includePartialFlows: argv?.includePartialFlows === true
  };
}
