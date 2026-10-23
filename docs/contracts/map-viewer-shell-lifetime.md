# Viewer shell lifetime

The actual scene-first shell publishes its original facade before construction
and guards partial publication, DOM changes, subscriptions and ResizeObserver
acquisition. Initial setter failures retain the original value, including falsey
values. Every returned observer is adopted before a post-construction authority
check, and every subscription captures removal before registration can install.

Shell retirement immediately revokes issued callbacks. Its stable `dispose()`
flight waits for original construction/callback stacks, attempts original child
and DOM cleanup independently, and restores original menu nodes, summary
placement, shared properties, classes, layout height and published callbacks.
Shared restoration checks the original facade and exact last-issued values;
another facade or callback cannot be overwritten. Retained detached callbacks
remain inert. The original settings session is closed, including a late
acquisition; later disposer replacement cannot redirect that operation.

Native cleanup tracks each original child separately. A settings close that is
still pending does not suppress unrelated removers or DOM cleanup. Failed child
capabilities retain their original scene/cache/diagnostic prerequisites and
successful closures are not repeated. The retired facade remains published
while a child requires explicit reconciliation; reconcile that exact child and
then the original parent resource owner. Public resource fields are inspection
references and cannot confer closure authority.

The actual-consumer DOM/observer controls are authored but unrun. Browser focus,
dialog, ResizeObserver, native allocation and scheduling acceptance remain open.
This owner covers the shell; renderer/source/controls/data owners retain their
separate lifetimes. It does not claim disposal of inaccessible objects from a
throwing native constructor or preservation of edits hidden behind host getters.
