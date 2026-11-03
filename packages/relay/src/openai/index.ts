import type { Destination } from '../client/bus.js';
import { type HashedUser, hashUser } from '../conversion-user.js';
import { type EventMeta, isBrowser } from '../shared.js';
import type { OpenAiEvent } from './shared.js';

export type {
  OpenAiContent,
  OpenAiContentInput,
  OpenAiContents,
  OpenAiContentsData,
  OpenAiCustom,
  OpenAiCustomData,
  OpenAiCustomerActionData,
  OpenAiEvent,
  OpenAiMoney,
  OpenAiPlan,
  OpenAiPlanEnrollmentData,
} from './shared.js';
export { openai, toMinorUnits } from './shared.js';

/** advanced matching data of the pixel: normalized identifiers as lowercase sha256 hex */
type OpenAiUser = {
  email_sha256?: string | undefined;
  phone_number_sha256?: string | undefined;
  first_name_sha256?: string | undefined;
  last_name_sha256?: string | undefined;
};

type OpenAiOptions = {
  /** deduplicates against the same event sent through the conversions api */
  event_id?: string | undefined;
  /** the name of a `custom` event; no standard event takes one */
  custom_event_name?: string | undefined;
};

type Oaiq = {
  (command: 'init', options: { user: OpenAiUser }): void;
  (command: 'measure', name: OpenAiEvent['name'], data: OpenAiEvent['data'], options?: OpenAiOptions): void;
};

declare global {
  interface Window {
    oaiq?: Oaiq | undefined;
  }
}

export type OpenAiPixelOptions = {
  /** the country calling code national phone numbers get before hashing, e.g. `49` */
  countryCallingCode?: string | undefined;
};

/**
 * The openai ads pixel as a destination: measures the `openai` payload of an event under the event's
 * id, so a conversion the server also reported through the conversions api counts once. The pixel
 * is injected by the cmp after consent, so `window.oaiq` shows up late: events wait for it. The
 * identifiers an event carries are hashed and sent through `init` right before it.
 */
export function openAiPixel(options: OpenAiPixelOptions = {}): Destination<'openai'> {
  // the visitor this pixel identified last, so the same identifiers are not sent again
  const identified = { key: undefined as string | undefined };

  return {
    name: 'openai',
    ready: () => isBrowser() && typeof globalThis.window.oaiq === 'function',
    send: (event, meta) => {
      const user = event.user ? hashUser(event.user, { countryCallingCode: options.countryCallingCode }) : undefined;

      void Promise.resolve(user)
        .then((hashed) => measure(event, meta, hashed, identified))
        .catch((error: unknown) => console.error('relay: destination openai failed', error));
    },
  };
}

function measure(
  event: OpenAiEvent,
  meta: EventMeta,
  hashed: HashedUser | undefined,
  identified: { key: string | undefined },
): void {
  const oaiq = window.oaiq;

  if (!oaiq) return;

  if (hashed) {
    identify(oaiq, hashed, identified);
  }

  oaiq('measure', event.name, event.data as OpenAiEvent['data'], {
    event_id: meta.id,
    ...(event.name === 'custom' && { custom_event_name: event.customName }),
  });
}

function identify(oaiq: Oaiq, hashed: HashedUser, identified: { key: string | undefined }): void {
  const user = withoutEmpty({
    email_sha256: hashed.email,
    phone_number_sha256: hashed.phone,
    first_name_sha256: hashed.firstName,
    last_name_sha256: hashed.lastName,
  });
  const key = JSON.stringify(user);

  if (key === identified.key || Object.keys(user).length === 0) {
    return;
  }

  identified.key = key;
  oaiq('init', { user });
}

function withoutEmpty(user: OpenAiUser): OpenAiUser {
  return Object.fromEntries(Object.entries(user).filter(([, value]) => value)) as OpenAiUser;
}
