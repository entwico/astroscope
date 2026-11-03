import { log } from '@astroscope/node/log';
import type { CapConfig } from './types.js';

const SITEVERIFY_TIMEOUT_MS = 10_000;

// what cap standalone answers a wrong secret (403) or an unknown site key (404) with
const CREDENTIALS_ERROR = 'Invalid site key or secret';

export type CapVerification = 'valid' | 'rejected' | 'unavailable';

/**
 * Asks the cap service whether a redeemed token is valid. A token is issued under the site key and
 * carries it as its first part, so one under another key is rejected here without a request. Cap
 * answers a malformed, unknown or expired token with a 4xx — a rejection like `success: false` —
 * but also the site's own credentials being wrong: that one means the verification is unavailable,
 * since no visitor could pass it. 5xx and network failures mean the service is unavailable.
 */
export async function verifyCapToken(config: CapConfig, token: string): Promise<CapVerification> {
  if (!token.startsWith(`${config.siteKey}:`)) {
    return 'rejected';
  }

  try {
    const response = await fetch(`${config.baseUrl}/${config.siteKey}/siteverify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      // a redirect would re-post the secret wherever the service points
      redirect: 'error',
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });

    if (response.status >= 400 && response.status < 500) {
      const data = await readJson(response);

      if (data?.error === CREDENTIALS_ERROR) {
        log.error({ status: response.status }, 'cap siteverify refused the site key or secret');

        return 'unavailable';
      }

      return 'rejected';
    }

    if (!response.ok) {
      log.error({ status: response.status }, 'cap siteverify failed');

      return 'unavailable';
    }

    const data = await readJson(response);

    return data?.success === true ? 'valid' : 'rejected';
  } catch (error) {
    log.error({ error }, 'cap siteverify request failed');

    return 'unavailable';
  }
}

async function readJson(response: Response): Promise<{ success?: boolean; error?: string } | undefined> {
  try {
    return (await response.json()) as { success?: boolean; error?: string };
  } catch {
    return undefined;
  }
}
