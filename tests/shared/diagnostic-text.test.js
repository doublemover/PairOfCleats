import assert from 'node:assert/strict';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

for (const field of ['token', 'TOKEN', 'access_token', 'access-token', 'api_key', 'api-key', 'password', 'passwd', 'client_secret']) {
  for (const separator of ['=', ': ', ' = ']) {
    const result = redactDiagnosticText(`failure ${field}${separator}private-value; phase=search`);
    assert.ok(!result.includes('private-value'), `${field}${separator} must be redacted`);
    assert.ok(result.endsWith('; phase=search'));
    assert.ok(result.includes('[redacted]'));
  }
}
assert.equal(redactDiagnosticText('token count: 12; tokenizer=v3; tokenization failed'),
  'token count: 12; tokenizer=v3; tokenization failed', 'ordinary token diagnostics keep their meaning');
assert.equal(redactDiagnosticText('Bearer private-value, https://user:pass@host/path?token=private-value&mode=code'),
  'Bearer [redacted], https://[redacted]@host/path?token=[redacted]&mode=code');
for (const key of ['token', 'access-token', 'password', 'client_secret']) {
  assert.equal(redactDiagnosticText(`https://host/path?${key}=private-value&mode=code#fragment`),
    `https://host/path?${key}=[redacted]&mode=code#fragment`);
}
assert.equal(redactDiagnosticText('\u001b[31mred\u001b[0m\u0000value'), 'red value');
assert.equal(redactDiagnosticText('abc😀tail', 4), 'abc', 'bounded output must not end in a lone high surrogate');
console.log('Credential assignment redaction preserves surrounding diagnostics and bounded Unicode text.');
