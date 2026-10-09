import { type StringPattern, createMatcher } from '@entwico/dash/match';
import type { MiddlewareHandler } from 'astro';
import type { Guard } from './guard.js';
import { guard } from './pages.js';

export type GuardRule = {
  /** request paths the guards apply to, in the exclude-pattern vocabulary */
  match: readonly StringPattern[];
  guards: readonly Guard[];
};

/**
 * Guards whole areas from the middleware: every rule whose patterns match the request path runs
 * its guards, and the first denial answers per the request: the denying guard's `page` response
 * for a browser, a json error for an api caller. Defence in depth, not a replacement for the
 * page-level `guard()`: a middleware cannot narrow `locals`, and
 * guards that already passed here are not run again by the page's call.
 */
export function createGuardMiddleware(rules: readonly GuardRule[]): MiddlewareHandler {
  const compiled = rules.map((rule) => ({ matches: createMatcher(rule.match), guards: rule.guards }));

  return async (ctx, next) => {
    for (const rule of compiled) {
      if (!rule.matches(ctx.url.pathname)) continue;

      const { denied } = await guard(ctx, rule.guards);

      if (denied) return denied;
    }

    return next();
  };
}
