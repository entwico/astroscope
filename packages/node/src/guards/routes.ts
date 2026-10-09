import type { APIContext, APIRoute } from 'astro';
import { denialResponse } from './denial.js';
import { type Guard, type GuardedContext, type Proofs, collectInput, isDenial, runGuards } from './guard.js';
import { readGuardInput } from './input.js';

export type GuardedRouteOptions<Guards extends readonly Guard[]> = {
  /**
   * run in order before the handler; a denial answers per the request:
   * json for api callers, the page response for a browser
   */
  guards: Guards;
  handler: (context: GuardedContext<APIContext, Proofs<Guards>>) => Response | Promise<Response>;
};

/**
 * An endpoint behind guards. Fields the guards declare in `input` are read from the request body
 * (json or form data); the body stays readable for the handler.
 */
export function defineRoute<const Guards extends readonly Guard[]>(options: GuardedRouteOptions<Guards>): APIRoute {
  const shape = collectInput(options.guards);

  return async (context) => {
    try {
      const input = shape ? await readGuardInput(context.request, shape) : undefined;

      await runGuards(options.guards, context, input);
    } catch (error) {
      if (!isDenial(error)) throw error;

      return denialResponse(context, error);
    }

    return options.handler(context as GuardedContext<APIContext, Proofs<Guards>>);
  };
}
