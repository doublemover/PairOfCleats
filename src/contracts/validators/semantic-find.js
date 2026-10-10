import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA, SEMANTIC_FIND_RESULT_SCHEMA } from '../schemas/semantic-find.js';
const ajv=createAjv({allErrors:true,strict:true});
const validators={request:compileSchema(ajv,SEMANTIC_FIND_REQUEST_SCHEMA),result:compileSchema(ajv,SEMANTIC_FIND_RESULT_SCHEMA)};
export const assertSemanticFind=(kind,value)=>{const validate=validators[kind];if(!validate||!validate(value))throw new TypeError('Invalid semantic find '+kind+': '+ajv.errorsText(validate?.errors));return value;};
