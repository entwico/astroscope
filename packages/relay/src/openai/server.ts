import { hashUser } from '../conversion-user.js';
import type { ServerDestination } from '../runtime.js';
import { withoutQuery } from '../source-url.js';
import type { OpenAiEvent } from './shared.js';

const CONVERSIONS_API_URL = 'https://bzr.openai.com/v1/events';
const CONVERSIONS_API_TIMEOUT_MS = 10_000;

/** the click reference the pixel stores for the visitor who came from an openai ad */
const CLICK_REFERENCE_COOKIE = '__obref';

export type OpenAiConversionsOptions = {
  /** the conversions api key from the ads manager */
  apiKey: string;
  pixelId: string;
  /** names the sending system in the request, e.g. `my-site-de` */
  integrationSource: string;
  /** the country calling code national phone numbers get before hashing, e.g. `49` */
  countryCallingCode?: string | undefined;
  fetch?: typeof fetch | undefined;
};

/**
 * The openai ads conversions api as a server destination: reports the `openai` payload of an event
 * under the id the pixel fires it with.
 */
export function openAiConversions(options: OpenAiConversionsOptions): ServerDestination<'openai'> {
  const doFetch = options.fetch ?? fetch;

  return {
    name: 'openai',
    async send(event: OpenAiEvent, { id, at, request }) {
      const hashed = await hashUser(event.user ?? {}, { countryCallingCode: options.countryCallingCode });
      const body = {
        integration_source: options.integrationSource,
        events: [
          {
            id,
            type: event.name,
            ...(event.name === 'custom' && { custom_event_name: event.customName }),
            timestamp_ms: at,
            source_url: withoutQuery(request.sourceUrl),
            action_source: 'web',
            user: {
              emails_sha256: toList(hashed.email),
              phone_numbers_sha256: toList(hashed.phone),
              first_names_sha256: toList(hashed.firstName),
              last_names_sha256: toList(hashed.lastName),
              ip_address: request.clientAddress,
              user_agent: request.headers.get('user-agent') ?? undefined,
              obref: request.cookie(CLICK_REFERENCE_COOKIE),
            },
            data: event.data,
          },
        ],
      };

      const response = await doFetch(`${CONVERSIONS_API_URL}?pid=${encodeURIComponent(options.pixelId)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONVERSIONS_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`conversions api responded ${response.status}: ${await response.text()}`);
      }
    },
  };
}

function toList(value: string | undefined): string[] | undefined {
  return value ? [value] : undefined;
}
