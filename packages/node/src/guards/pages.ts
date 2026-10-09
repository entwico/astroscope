import { denialResponse } from './denial.js';
import { type Guard, type PageContext, type Proof, type Proofs, collectInput, isDenial, runGuards } from './guard.js';
import { readGuardInput } from './input.js';

export type Guarded<P extends Proof> =
  ({ denied: Response } & { [K in keyof P]?: undefined }) | ({ denied?: undefined } & P);

/**
 * Guards a page from its frontmatter: `const { denied, user } = await guard(Astro, [authenticated]);
 * if (denied) return denied;` — after the check the proofs are required, before it they are not.
 * The denial is the one the request asked for: the denying guard's `page` response for a browser,
 * a json error for anything else (see `denialResponse`).
 */
export async function guard<const Guards extends readonly Guard[]>(
  context: PageContext,
  guards: Guards,
): Promise<Guarded<Proofs<Guards>>> {
  const shape = collectInput(guards);

  try {
    const input = shape ? await readGuardInput(context.request, shape) : undefined;
    const proofs = await runGuards(guards, context, input);

    return { denied: undefined, ...proofs } as Guarded<Proofs<Guards>>;
  } catch (error) {
    if (!isDenial(error)) throw error;

    return { denied: await denialResponse(context, error) } as Guarded<Proofs<Guards>>;
  }
}
