import { z } from 'astro/zod';
import { deny } from './guard.js';

/**
 * Reads the fields guards declared from a request without a schema of its own (endpoints, pages):
 * json bodies as they are, form bodies as a flat object. The request itself stays readable. Only
 * called when a guard in the list declares `input` — a guard that works from the session or the
 * url never causes the body to be read.
 */
export async function readGuardInput(request: Request, shape: z.ZodRawShape): Promise<Record<string, unknown>> {
  const parsed = z.object(shape).safeParse(await readBody(request));

  if (!parsed.success) {
    deny('BAD_REQUEST', parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  return parsed.data;
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  const clone = request.clone();

  try {
    if (type.includes('application/json')) {
      return await clone.json();
    }

    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      return Object.fromEntries(await clone.formData());
    }
  } catch {
    deny('BAD_REQUEST', 'unreadable request body');
  }

  return {};
}
