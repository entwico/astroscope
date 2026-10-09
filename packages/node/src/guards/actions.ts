import type { MaybePromise } from '@entwico/dash';
import { z } from 'astro/zod';
import { type ActionAPIContext, type ActionClient, defineAction as defineAstroAction } from 'astro:actions';
import { type Guard, type GuardShapes, type GuardedContext, type Proofs, collectInput, runGuards } from './guard.js';

type ActionAccept = 'form' | 'json';

export type GuardedActionHandler<
  TInputSchema,
  TOutput,
  Guards extends readonly Guard[],
> = TInputSchema extends z.core.$ZodType
  ? (input: z.output<TInputSchema>, context: GuardedContext<ActionAPIContext, Proofs<Guards>>) => MaybePromise<TOutput>
  : (input: any, context: GuardedContext<ActionAPIContext, Proofs<Guards>>) => MaybePromise<TOutput>;

/** the schema the client calls with: the action's own, plus the fields its guards read */
export type ClientInputSchema<TInputSchema, Guards extends readonly Guard[]> = keyof GuardShapes<Guards> extends never
  ? TInputSchema
  : TInputSchema extends z.ZodObject<infer Shape>
    ? z.ZodObject<Shape & GuardShapes<Guards>>
    : TInputSchema extends undefined
      ? z.ZodObject<GuardShapes<Guards>>
      : TInputSchema;

export type GuardedActionOptions<
  TOutput,
  TAccept extends ActionAccept | undefined,
  TInputSchema extends z.core.$ZodType | undefined,
  Guards extends readonly Guard[],
> = {
  accept?: TAccept;
  input?: TInputSchema;
  /** run in order after validation; a denial becomes the action's error, the proofs land on `context.locals` */
  guards?: Guards;
  handler: GuardedActionHandler<TInputSchema, TOutput, Guards>;
};

/**
 * Astro's `defineAction` with guards: the listed guards run after input validation and before the
 * handler, which sees `locals` with their proofs required. Fields a guard declares in `input` are
 * merged into the action's schema and stripped again before the handler — the action never learns
 * about them.
 */
export function defineAction<
  TOutput,
  TAccept extends ActionAccept | undefined = undefined,
  TInputSchema extends z.core.$ZodType | undefined = TAccept extends 'form' ? z.core.$ZodType<FormData> : undefined,
  const Guards extends readonly Guard[] = [],
>(
  options: GuardedActionOptions<TOutput, TAccept, TInputSchema, Guards>,
): ActionClient<TOutput, TAccept, ClientInputSchema<TInputSchema, Guards>> & string {
  const guards = options.guards ?? [];
  const shape = collectInput(guards);
  const input = shape ? extendSchema(options.input, shape, options.accept) : options.input;
  // a field the action declares itself stays, however many guards also read it
  const guardKeys = shape ? Object.keys(shape).filter((key) => !ownKeys(options.input).has(key)) : [];

  const handler = async (parsed: unknown, context: ActionAPIContext) => {
    if (guards.length > 0) {
      await runGuards(guards, context, parsed);
    }

    const handlerInput = guardKeys.length > 0 ? omit(parsed as Record<string, unknown>, guardKeys) : parsed;

    return (options.handler as (input: unknown, context: ActionAPIContext) => MaybePromise<TOutput>)(
      handlerInput,
      context,
    );
  };

  type AstroOptions = Parameters<typeof defineAstroAction<TOutput, TAccept, TInputSchema>>[0];

  type Client = ActionClient<TOutput, TAccept, ClientInputSchema<TInputSchema, Guards>> & string;

  return defineAstroAction({ accept: options.accept, input, handler } as unknown as AstroOptions) as unknown as Client;
}

function extendSchema(
  schema: z.core.$ZodType | undefined,
  shape: z.ZodRawShape,
  accept: ActionAccept | undefined,
): z.core.$ZodType {
  if (!schema) {
    if (accept === 'form') {
      throw new Error('@astroscope/node: guards declaring input need an input schema on a form action');
    }

    return z.object(shape);
  }

  if (!isObjectSchema(schema)) {
    throw new Error('@astroscope/node: guards declaring input need an object input schema');
  }

  return schema.extend(shape);
}

function ownKeys(schema: z.core.$ZodType | undefined): Set<string> {
  return new Set(schema && isObjectSchema(schema) ? Object.keys(schema.shape) : []);
}

function isObjectSchema(schema: z.core.$ZodType): schema is z.ZodObject {
  return typeof (schema as { extend?: unknown }).extend === 'function';
}

function omit(input: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const rest = { ...input };

  for (const key of keys) {
    delete rest[key];
  }

  return rest;
}
