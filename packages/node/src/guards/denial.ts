import { ActionError } from 'astro:actions';
import { type PageContext, deniedBy } from './guard.js';

/**
 * One denial policy for endpoints, pages and the middleware, decided by the request rather than
 * by the surface: a browser navigation — `text/html` in `Accept`, the same signal astro uses to
 * tell a form submission from an rpc call — gets the denying guard's `page` response (a redirect
 * to the login, a 404 rewrite), or the status with the message; anything else gets a json error
 * it can act on.
 */
export async function denialResponse(context: PageContext, denial: ActionError): Promise<Response> {
  const status = ActionError.codeToStatus(denial.code);

  if (!acceptsHtml(context.request)) {
    return Response.json({ error: { code: denial.code, message: denial.message } }, { status });
  }

  const page = deniedBy(denial)?.page;

  return page ? page(context, denial) : new Response(denial.message, { status });
}

export function acceptsHtml(request: Request): boolean {
  return request.headers.get('accept')?.includes('text/html') ?? false;
}
