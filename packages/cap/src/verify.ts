import { log } from '@astroscope/node/log';
import type { CapConfig } from './types.js';

const SITEVERIFY_TIMEOUT_MS = 10_000;

export type CapVerification = 'valid' | 'rejected' | 'unavailable';

/**
 * Asks the cap service whether a redeemed token is valid. Cap answers a malformed or unknown token
 * with a 4xx (e.g. 400 "Missing required parameters") — that is a rejection like `success: false`,
 * only 5xx and network failures mean the service is unavailable.
 */
export async function verifyCapToken(config: CapConfig, token: string): Promise<CapVerification> {
  try {
    const response = await fetch(`${config.baseUrl}/${config.siteKey}/siteverify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });

    if (response.status >= 400 && response.status < 500) {
      return 'rejected';
    }

    if (!response.ok) {
      log.error({ status: response.status }, 'cap siteverify failed');

      return 'unavailable';
    }

    const data = (await response.json()) as { success?: boolean };

    return data.success ? 'valid' : 'rejected';
  } catch (error) {
    log.error({ error }, 'cap siteverify request failed');

    return 'unavailable';
  }
}
