# Installer result observations

The existing managed-child/session owner already captures its first action
observation and controls lease/reservation release. The installer adapter must
carry its actual child result into that boundary, rather than wrapping it in an
unconditionally closed record that loses a nested original observation.

The adapter captures and checks the original result, projects each report field
under that same observation, then exposes the captured observer on its completion
record. The existing session owner rechecks it before automatic metadata release.
The settlement callback checks the session's first action observation before
termination diagnostics; it cannot reread a substituted reconciliation callback.
Outer failure projection checks the original error and every nested result field.
Existing pending-marker failures keep their throw/recovery contract. Ordinary
settled failures retain status/output and caught falsy values as exact causes.

`observeStorageResource.read` shares the existing before/after/inspection guard
with canonical diagnostic classification. These checks grant no native close,
new storage admission or deletion authority, and perform no native-status retry.

Four locally unrun cases use the actual installer and real storage sessions,
reservations and protection inspection, with explicitly inert child callbacks.
They cover returned pending results, errors before diagnostics, per-field pending
intervals and ordinary/falsy failures. Recovery uses the actual retained owners;
fixture deletion checks its physical root and exact disposable marker first.
These are original-observation boundary models, not reproduced OS handle leaks
or package-build/high-water qualification. Existing real-child and publication
fixtures remain under their original execution owners.
