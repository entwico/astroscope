import { z } from 'astro/zod';
import { deny } from './guard.js';

/**
 * Reads the fields guards declared from a request without a schema of its own (endpoints, pages):
 * json bodies as they are, form bodies as a flat object. The request itself stays readable. Only
 * called when a guard in the list declares `input` — a guard that works from the session or the
 * url never causes the body to be read.
 */
export async function readGuardInput(request: Request, shape: z.ZodRawShape): Promise<Record<string, unknown>> {
  const parsed = z.object(shape).safeParse(await readBody(request, shape));

  if (!parsed.success) {
    deny('BAD_REQUEST', parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  return parsed.data;
}

async function readBody(request: Request, shape: z.ZodRawShape): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  const clone = request.clone();

  try {
    if (type.includes('application/json')) {
      return await clone.json();
    }

    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      return readFormFields(await clone.formData(), shape);
    }
  } catch {
    deny('BAD_REQUEST', 'unreadable request body');
  }

  return {};
}

/**
 * The declared fields, read the way astro's action form parsing reads them: the first value of a
 * repeated field (`get`), every value for an array schema (`getAll`), `true`/`false`/presence for
 * a boolean, `Number()` for a number, an absent field left to its default — so a guard checks the
 * value the guarded code will see.
 */
function readFormFields(formData: FormData, shape: z.ZodRawShape): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const [name, declared] of Object.entries(shape)) {
    const { schema, defaulted } = unwrap(declared);

    if (defaulted && !formData.has(name)) continue;

    if (schema instanceof z.ZodBoolean) {
      fields[name] = toBoolean(formData.get(name), formData.has(name));
    } else if (schema instanceof z.ZodArray) {
      fields[name] = readAll(formData.getAll(name), schema.element);
    } else {
      const value = formData.get(name);

      if (value) {
        fields[name] = schema instanceof z.ZodNumber ? Number(value) : value;
      } else {
        fields[name] = declared instanceof z.ZodOptional ? undefined : null;
      }
    }
  }

  return fields;
}

// the schema behind optional/nullable/default wrappers and pipes, and whether a default was among them
function unwrap(declared: unknown): { schema: unknown; defaulted: boolean } {
  let schema = declared;
  let defaulted = false;

  while (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    defaulted ||= schema instanceof z.ZodDefault;
    schema = schema.unwrap();
  }

  while (schema instanceof z.ZodPipe) {
    schema = schema.in;
  }

  return { schema, defaulted };
}

function readAll(values: FormDataEntryValue[], element: unknown): unknown[] {
  if (element instanceof z.ZodNumber) {
    return values.map(Number);
  }

  if (element instanceof z.ZodBoolean) {
    return values.map((value) => toBoolean(value, Boolean(value)));
  }

  return values;
}

// a checkbox posts `on`, a hidden field `true`/`false`; anything else counts as `present`
function toBoolean(value: FormDataEntryValue | null, present: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return present;
}
