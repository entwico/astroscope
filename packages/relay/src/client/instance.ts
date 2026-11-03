import { type TrackInput, isBrowser, isTrackInput } from '../shared.js';
import { type Bus, createBus } from './bus.js';
import { installConsentHeader } from './fetch.js';

/** the queue the head script creates for inline calls before the bus is installed, and the bus itself afterwards */
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

  if (isBus(existing)) {
    return existing;
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
  }

  return created;
}

// an installed bus, and not an element content clobbered the global with (`<form id="__relay__">`
// with inputs named after the methods): the functions are what a later module instance needs
function isBus(value: RelayGlobal | undefined): value is RelayGlobal & Bus {
  return (
    typeof value?.track === 'function' &&
    typeof value.configure === 'function' &&
    typeof value.notify === 'function' &&
    typeof value.consent === 'function'
  );
}
