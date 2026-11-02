import { hashUser } from '../conversion-user.js';
import type { RelayRequest, ServerDestination } from '../runtime.js';
import { withoutQuery } from '../source-url.js';
import type { MetaEvent } from './shared.js';

const CONVERSIONS_API_URL = 'https://graph.facebook.com';
const CONVERSIONS_API_VERSION = 'v24.0';
const CONVERSIONS_API_TIMEOUT_MS = 10_000;

/** the cookies the pixel sets: the browser id, and the click id of the visitor who came from a meta ad */
const BROWSER_ID_COOKIE = '_fbp';
const CLICK_ID_COOKIE = '_fbc';
const CLICK_ID_PARAM = 'fbclid';

export type MetaConversionsOptions = {
  /** the system user access token from the events manager */
  accessToken: string;
  pixelId: string;
  /** the code from the events manager's test events tab: the events show up there instead of counting */
  testEventCode?: string | undefined;
  /** the country calling code national phone numbers get before hashing, e.g. `49` */
  countryCallingCode?: string | undefined;
  /** the graph api version; default the one this package was written against */
  apiVersion?: string | undefined;
  fetch?: typeof fetch | undefined;
};

/**
 * The meta conversions api as a server destination: reports the `meta` payload of an event under
 * the id the pixel fires it with, with the identifiers hashed and the browser and click ids off
 * the pixel's cookies; a click id the pixel has not stored yet is taken from the page's `fbclid`.
 */
export function metaConversions(options: MetaConversionsOptions): ServerDestination<'meta'> {
  const doFetch = options.fetch ?? fetch;
  const url = `${CONVERSIONS_API_URL}/${options.apiVersion ?? CONVERSIONS_API_VERSION}/${encodeURIComponent(options.pixelId)}/events`;

  return {
    name: 'meta',
    async send(event: MetaEvent, { id, at, request }) {
      const hashed = await hashUser(event.user ?? {}, { countryCallingCode: options.countryCallingCode });
      const body = {
        access_token: options.accessToken,
        ...(options.testEventCode && { test_event_code: options.testEventCode }),
        data: [
          {
            event_name: event.name,
            event_time: Math.floor(at / 1000),
            event_id: id,
            event_source_url: withoutQuery(request.sourceUrl),
            action_source: 'website',
            user_data: withoutEmpty({
              em: toList(hashed.email),
              ph: toList(hashed.phone),
              fn: toList(hashed.firstName),
              ln: toList(hashed.lastName),
              ct: toList(hashed.city),
              zp: toList(hashed.postalCode),
              country: toList(hashed.country),
              external_id: toList(hashed.externalId),
              client_ip_address: request.clientAddress,
              client_user_agent: request.headers.get('user-agent') ?? undefined,
              fbp: request.cookie(BROWSER_ID_COOKIE),
              fbc: request.cookie(CLICK_ID_COOKIE) ?? clickIdOf(request, at),
            }),
            custom_data: event.data,
          },
        ],
      };

      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONVERSIONS_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`conversions api responded ${response.status}: ${await response.text()}`);
      }
    },
  };
}

/** the click id in the pixel's cookie format, from the `fbclid` of the page the conversion happened on */
function clickIdOf(request: RelayRequest, at: number): string | undefined {
  let fbclid: string | null;

  try {
    fbclid = new URL(request.sourceUrl).searchParams.get(CLICK_ID_PARAM);
  } catch {
    return undefined;
  }

  return fbclid ? `fb.1.${at}.${fbclid}` : undefined;
}

function toList(value: string | undefined): string[] | undefined {
  return value ? [value] : undefined;
}

function withoutEmpty<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>;
}
