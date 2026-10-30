import { verifyNativeTuiLifetime } from '../helpers/native-tui-lifetime.js';

// Authored acceptance only. Requires the actual native host and platform terminal.
// The proxy closes only the event pipe while the real supervisor/owned family
// remain alive; EOF must initiate the existing exact shutdown owner.
await verifyNativeTuiLifetime('event-transport-error');
