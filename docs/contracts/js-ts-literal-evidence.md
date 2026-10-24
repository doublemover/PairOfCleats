# JS/TS parser literal evidence

Parser-owned defaults and bounded call previews carry version-1 literal evidence,
separate from display text. ESTree and Babel scalar kinds share one projector;
only primitive parser values reach the existing semantic scalar owner. BigInt is
a decimal tagged string without Number conversion. Non-finite numeric values
retain numeric kind with unavailable scalar value, never a fabricated null.
Regex and unsupported values remain explicit unknown type evidence. Projection
does not execute regexes, source code, object conversion or value accessors.

Each record retains its half-open UTF-16 source range, an 80-character raw
preview and truncation flag. Scalar representation is bounded to 4096 characters;
large values can preserve kind without a scalar. Default inference and positional
cross-file inference prefer typed evidence. The conservative textual literal
parser remains the compatibility owner when typed evidence is absent.

Call-site JSONL retains at most five literal records alongside the existing five
preview slots, with canonical schema/semantic validation. They do not establish
full argument count, spread expansion or positional coverage beyond those slots;
issue #1678 owns that independent contract. Unsupported values cannot discard
otherwise valid relations. SourceChunking 20, TypeNormalization 10, CallFlow 46
and RecordsProducer 5 invalidate derived output from the old projection.

Authored parser-specific defaults/local inference, call-site writer reload,
JSON/precision/size/conversion negatives and cross-file cold/warm replay fixtures
are UNRUN. Runtime acceptance remains deferred until the implementation wave ends.
