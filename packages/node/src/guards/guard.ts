import type { MaybePromise } from '@entwico/dash';
import type { APIContext } from 'astro';
import type { z } from 'astro/zod';
import { type ActionAPIContext, ActionError, type ActionErrorCode } from 'astro:actions';

/** what a guard proves about the request: merged into `locals` for the guarded code */
export type Proof = Record<string, unknown>;

/** the request context every guard runs against — the part actions, endpoints and pages share */
export type GuardContext = ActionAPIContext;

/** the page context: an endpoint's `context` or a page's `Astro`, which can also redirect and rewrite */
export type PageContext = GuardContext & Pick<APIContext, 'redirect' | 'rewrite'>;

export type GuardedLocals<Locals, P extends Proof> = Omit<Locals, keyof P> & P;

/** the context with the proofs of the guards made required on `locals` */
export type GuardedContext<Ctx extends GuardContext, P extends Proof> = Omit<Ctx, 'locals'> & {
  locals: GuardedLocals<Ctx['locals'], P>;
};

export type GuardInput<Shape extends z.ZodRawShape | undefined> = Shape extends z.ZodRawShape
  ? z.output<z.ZodObject<Shape>>
  : unknown;

export type GuardPageDenial = (ctx: PageContext, denial: ActionError) => MaybePromise<Response>;

export type GuardDefinition<
  R extends Proof | void,
  Shape extends z.ZodRawShape | undefined,
  Ctx extends GuardContext,
> = {
  name: string;
  /** request fields the guard needs: merged into the action's input schema, stripped again before the handler */
  input?: Shape | undefined;
  /** denies by throwing (see `deny`), proves by returning the values the guarded code may rely on */
  check: (ctx: Ctx, input: GuardInput<Shape>) => MaybePromise<R>;
  /** what a browser sees when this guard denies (a redirect, a rewrite); default: the denial's status with its message */
  page?: GuardPageDenial | undefined;
};

type ProofOf<R> = R extends Proof ? R : Record<never, never>;

type ShapeOf<Shape> = Shape extends z.ZodRawShape ? Shape : Record<never, never>;

export interface Guard<P extends Proof = Record<never, never>, Shape extends z.ZodRawShape = Record<never, never>> {
  readonly name: string;
  /** the fields this guard and its parents need from the request */
  readonly input: Shape | undefined;
  readonly page: GuardPageDenial | undefined;
  /** @internal runs the parents, then the check; the proofs land on `ctx.locals` and are returned merged */
  run(ctx: GuardContext, input: unknown): Promise<P>;
  /** a guard that runs after this one, with this one's proofs already on `locals` */
  extend<R extends Proof | void, NextShape extends z.ZodRawShape | undefined = undefined>(
    definition: GuardDefinition<R, NextShape, GuardedContext<GuardContext, P>>,
  ): Guard<P & ProofOf<R>, Shape & ShapeOf<NextShape>>;
}

// distributive helpers: applied to a union of guards they infer per member; `any` in the other
// slot keeps the interface's variance out of the inference

type ProofOfGuard<G> = G extends Guard<infer P, any> ? P : never;

type ShapeOfGuard<G> = G extends Guard<any, infer S> ? S : never;

type Intersected<T> = UnionToIntersection<T> extends infer I ? (I extends object ? I : Record<never, never>) : never;

/** proofs of a guard list, intersected */
export type Proofs<Guards extends readonly Guard[]> = Intersected<ProofOfGuard<Guards[number]>>;

/** request fields of a guard list, intersected */
export type GuardShapes<Guards extends readonly Guard[]> = Intersected<ShapeOfGuard<Guards[number]>>;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

export function defineGuard<R extends Proof | void, Shape extends z.ZodRawShape | undefined = undefined>(
  definition: GuardDefinition<R, Shape, GuardContext>,
): Guard<ProofOf<R>, ShapeOf<Shape>> {
  return createGuard(
    undefined,
    definition as GuardDefinition<Proof | void, z.ZodRawShape | undefined, GuardContext>,
  ) as Guard<ProofOf<R>, ShapeOf<Shape>>;
}

/** denies the request: an `ActionError` for actions, the matching status for endpoints and pages */
export function deny(code: ActionErrorCode, message?: string): never {
  throw new ActionError({ code, ...(message === undefined ? {} : { message }) });
}

export function isDenial(error: unknown): error is ActionError {
  return error instanceof ActionError;
}

function createGuard(
  parent: Guard<Proof> | undefined,
  definition: GuardDefinition<Proof | void, z.ZodRawShape | undefined, GuardContext>,
): Guard<Proof> {
  const input = mergeShapes(parent?.input, definition.input);
  const page = definition.page ?? parent?.page;

  // the denial is attributed to the guard whose own check threw, so an extension's `page`
  // handler answers only its own denials — a parent's denial keeps the parent's response
  const check = async (ctx: GuardContext, raw: unknown): Promise<Proof | void> => {
    try {
      return await definition.check(ctx, raw as GuardInput<z.ZodRawShape>);
    } catch (error) {
      if (isDenial(error) && !DENIED_BY.has(error)) {
        DENIED_BY.set(error, guard);
      }

      throw error;
    }
  };

  const guard: Guard<Proof> = {
    name: definition.name,
    input,
    page,

    async run(ctx, raw) {
      const memo = memoFor(ctx.request);
      const passed = memo.get(guard);

      if (passed) {
        Object.assign(ctx.locals, passed);

        return passed;
      }

      const inherited = parent ? await parent.run(ctx, raw) : {};
      const proof = (await check(ctx, raw)) ?? {};

      Object.assign(ctx.locals, proof);

      const proofs = { ...inherited, ...proof };

      memo.set(guard, proofs);

      return proofs;
    },

    extend(next) {
      return createGuard(
        guard,
        next as GuardDefinition<Proof | void, z.ZodRawShape | undefined, GuardContext>,
      ) as never;
    },
  };

  return guard;
}

function mergeShapes(...shapes: (z.ZodRawShape | undefined)[]): z.ZodRawShape | undefined {
  const defined = shapes.filter((shape) => shape !== undefined);

  if (defined.length === 0) return undefined;

  return Object.assign({}, ...defined) as z.ZodRawShape;
}

/** the request fields all guards of a list need, or `undefined` when none declares any */
export function collectInput(guards: readonly Guard[]): z.ZodRawShape | undefined {
  return mergeShapes(...guards.map((guard) => guard.input));
}

/** runs the guards in order, merging their proofs */
export async function runGuards(guards: readonly Guard[], ctx: GuardContext, input: unknown): Promise<Proof> {
  const proofs: Proof = {};

  for (const guard of guards) {
    Object.assign(proofs, await guard.run(ctx, input));
  }

  return proofs;
}

const DENIED_BY = new WeakMap<ActionError, Guard>();

// a guard that passed runs once per request: a middleware guarding the area and the page's own
// `guard()` call share the result, as do extensions sharing a parent
const PASSED = new WeakMap<Request, Map<Guard<Proof>, Proof>>();

function memoFor(request: Request): Map<Guard<Proof>, Proof> {
  let memo = PASSED.get(request);

  if (!memo) {
    memo = new Map();
    PASSED.set(request, memo);
  }

  return memo;
}

export function deniedBy(error: ActionError): Guard | undefined {
  return DENIED_BY.get(error);
}
