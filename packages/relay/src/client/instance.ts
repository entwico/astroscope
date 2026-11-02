import { RELAY_TRACK_ATTRIBUTE, type TrackInput, isBrowser, isTrackInput } from '../shared.js';
import { type Bus, createBus } from './bus.js';
import { installConsentHeader } from './fetch.js';

/** what inline scripts push into before the bus is installed, and the bus itself afterwards */
type Queue = { q: { push: (input: TrackInput) => void } };

type RelayGlobal = Queue & Partial<Bus>;

declare global {
  // the global the inline queue and the bus share
  var __relay__: RelayGlobal | undefined;
}

/** the bus of this page: one instance, whichever module loads first */
export const bus: Bus = install();

function install(): Bus {
  const existing = globalThis.__relay__;

  if (existing?.track && existing.configure && existing.notify && existing.consent) {
    return existing as Bus;
  }

  const created = createBus();
  const queued = Array.isArray(existing?.q) ? (existing.q as unknown[]) : [];

  // later inline pushes land on the bus directly
  const installed: RelayGlobal = { ...created, q: { push: (input) => void created.track(input) } };

  // eslint-disable-next-line unicorn/no-global-object-property-assignment -- `self.__relay__` is the queue inline scripts push into before the bus exists; the bus takes its place
  globalThis.__relay__ = installed;

  for (const input of queued) {
    if (isTrackInput(input)) created.track(input);
  }

  if (isBrowser()) {
    installConsentHeader(created.consent);
    document.addEventListener('click', trackClick, { capture: true });
  }

  return created;
}

// an element marked `data-track` (a button, a link) tracks the event serialized into the attribute
// when clicked — before hydration too, and without a listener per component
function trackClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const element = target.closest(`[${CSS.escape(RELAY_TRACK_ATTRIBUTE)}]`);
  const raw = element?.getAttribute(RELAY_TRACK_ATTRIBUTE);

  if (!raw) return;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (isTrackInput(parsed)) bus.track(parsed);
}
