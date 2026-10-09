import { defineGuard, deny } from '@astroscope/node/guards';
import { log } from '@astroscope/node/log';
import { z } from 'astro/zod';
import { cap } from './runtime.js';
import { CAP_FIELD_NAME } from './shared.js';
import { verifyCapToken } from './verify.js';

export { CAP_FIELD_NAME } from './shared.js';

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
    check: async (_ctx, input) => {
      const config = cap.getConfig();

      if (!config) {
        log.error('cap is not configured — call cap.configure() in src/boot.ts');
        deny('SERVICE_UNAVAILABLE', 'captcha verification unavailable');
      }

      const verification = await verifyCapToken(config, input[CAP_FIELD_NAME]);

      if (verification === 'rejected') {
        log.info('cap token rejected');
        deny('FORBIDDEN', 'captcha invalid');
      } else if (verification === 'unavailable') {
        deny('SERVICE_UNAVAILABLE', 'captcha verification unavailable');
      }
    },
  });
}
