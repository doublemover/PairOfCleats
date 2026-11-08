import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA, SEMANTIC_FIND_RESULT_SCHEMA } from '../schemas/semantic-find.js';
const ajv=createAjv({allErrors:true,strict:true});
const validators={request:compileSchema(ajv,SEMANTIC_FIND_REQUEST_SCHEMA),result:compileSchema(ajv,SEMANTIC_FIND_RESULT_SCHEMA)};
const invalid = (kind, message) => Object.assign(new TypeError(message),
  kind === 'request' ? { code: 'ERR_SEMANTIC_QUERY_CONTRACT' } : {});
export const assertSemanticFind=(kind,value)=>{const validate=validators[kind];if(!validate||!validate(value))throw invalid(kind,'Invalid semantic find '+kind+': '+ajv.errorsText(validate?.errors));if(kind==='request'&&value.selector.range){const {start,end}=value.selector.range;if(!['sourcePath','sourceUnitId'].includes(value.selector.field)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)throw invalid(kind,'Source range requires a nonempty half-open UTF16 interval and source selector.');}return value;};
