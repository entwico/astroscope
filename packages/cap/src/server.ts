import { defineGuard, deny } from '@astroscope/node/guards';
import { log } from '@astroscope/node/log';
import { z } from 'astro/zod';
import { cap } from './runtime.js';
import { CAP_FIELD_NAME } from './shared.js';
import type { CapConfig } from './types.js';
import { type CapVerification, verifyCapToken } from './verify.js';

export { CAP_FIELD_NAME } from './shared.js';

// cap consumes a token on its first siteverify, so a second captcha() guard on the same request (one
// in the guard middleware, one on the page) must reuse the first verification instead of asking
// again and meeting a consumed token. every guard instance imports this module from the site's own
// code, so one module instance sees them all
const verifications = new WeakMap<Request, Map<string, Promise<CapVerification>>>();

function verifyOnce(request: Request, config: CapConfig, token: string): Promise<CapVerification> {
  let byToken = verifications.get(request);

  if (!byToken) {
    byToken = new Map();
    verifications.set(request, byToken);
  }

  let verification = byToken.get(token);

  if (!verification) {
    verification = verifyCapToken(config, token);
    byToken.set(token, verification);
  }

  return verification;
}

export type CaptchaOptions = {
  /** the guard's name in denials and logs; default `captcha` */
  name?: string | undefined;
};

/**
 * Guard for requests that need a solved captcha: the token arrives in the `_cap` field (an action
 * input key, a form field, a json body key) and is verified with the cap service — one token per
 * request, cap rejects a second use. Denies with `FORBIDDEN` for a missing or rejected token and
 * `SERVICE_UNAVAILABLE` when cap cannot be reached or is not configured.
 */
// the return type stays inferred: it carries the `_cap` input shape into the action's client type
export function captcha(options: CaptchaOptions = {}) {
  return defineGuard({
    name: options.name ?? 'captcha',
    input: { [CAP_FIELD_NAME]: z.string().min(1).max(2048) },
    check: async (ctx, input) => {
      const config = cap.getConfig();

      if (!config) {
        log.error('cap is not configured — call cap.configure() in src/boot.ts');
        deny('SERVICE_UNAVAILABLE', 'captcha verification unavailable');
      }

      const verification = await verifyOnce(ctx.request, config, input[CAP_FIELD_NAME]);

      if (verification === 'rejected') {
        log.info('cap token rejected');
        deny('FORBIDDEN', 'captcha invalid');
      } else if (verification === 'unavailable') {
        deny('SERVICE_UNAVAILABLE', 'captcha verification unavailable');
      }
    },
  });
}
