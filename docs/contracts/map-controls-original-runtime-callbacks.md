# Original map runtime callbacks

The controls constructor captures renderer render/size/pixel-ratio operations
and camera matrix/projection operations once, binding each original object as
its receiver. Later method replacement on those same objects cannot substitute
native work. The facade carries operation callbacks only; renderer/camera
disposal remains with the existing original scene owner.

Operation entry/return uses the original controls lifetime prerequisite. Native
callback capture happens inside guarded construction; a throwing getter retains
the exact primary and participates in existing independent scene-work cleanup.
Loss of original authority during any getter capture prevents every later
getter, the next resource's callback capture and subsequent controls
construction. Original authority is checked immediately before/after each
getter and between renderer/camera capture. Resize checks authority after viewport, projection, pixel-ratio,
size and camera-lock callback returns before admitting later work. Frame
submission and telemetry retain their existing original publication fences.

These source changes and actual inert initControls controls are **UNVALIDATED**.
No tests, syntax/lint/format, bootstrap, Three/browser/native/GPU, editor, build
or benchmark execution occurred. Synchronous native callback ownership is not
proof of asynchronous render support, failed native callback recovery, desired
UI effect, GPU quiescence or performance acceptance.
