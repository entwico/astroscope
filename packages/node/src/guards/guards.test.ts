import type { APIContext } from 'astro';
import { z } from 'astro/zod';
import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import { defineAction } from './actions';
import { type GuardContext, defineGuard, deny } from './guard';
import { createGuardMiddleware } from './middleware';
import { guard } from './pages';
import { defineRoute } from './routes';

vi.mock('astro:actions', () => {
  const statuses: Record<string, number> = { BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };

  class ActionError extends Error {
    code: string;

    constructor({ code, message }: { code: string; message?: string }) {
      super(message ?? code);
      this.code = code;
    }

    static codeToStatus(code: string) {
      return statuses[code] ?? 500;
    }
  }

  // astro's shape, reduced to what the wrapper relies on: validate, then call the handler
  const defineAction = ({
    input,
    handler,
  }: {
    input?: z.ZodType;
    handler: (input: unknown, ctx: unknown) => unknown;
  }) => {
    return async (raw: unknown, ctx: unknown) => {
      if (!input) return handler(raw, ctx);

      const parsed = input.safeParse(raw);

      if (!parsed.success) throw new ActionError({ code: 'BAD_REQUEST', message: 'invalid input' });

      return handler(parsed.data, ctx);
    };
  };

  return { ActionError, defineAction };
});

type User = { id: string; admin: boolean };

type Locals = { user?: User | undefined };

// a browser navigation; everything else in these tests is an api caller
const browser: RequestInit = { headers: { accept: 'text/html,*/*' } };

function createContext(locals: Locals = {}, init: RequestInit = {}, path = '/x'): APIContext {
  return {
    request: new Request(`https://example.com${path}`, init),
    url: new URL(`https://example.com${path}`),
    locals,
    redirect: (location: string) => new Response(null, { status: 302, headers: { location } }),
    rewrite: () => new Response('rewritten', { status: 404 }),
  } as unknown as APIContext;
}

const authenticated = defineGuard({
  name: 'authenticated',
  check: (ctx: GuardContext & { locals: Locals }) => ({ user: ctx.locals.user ?? deny('UNAUTHORIZED') }),
  page: (ctx) => ctx.redirect('/login'),
});

const admin = authenticated.extend({
  name: 'admin',
  check: (ctx) => {
    expectTypeOf(ctx.locals.user).toEqualTypeOf<User>();

    if (!ctx.locals.user.admin) deny('FORBIDDEN');
  },
  page: (ctx) => ctx.rewrite('/404'),
});

const secret = defineGuard({
  name: 'secret',
  input: { _secret: z.string().min(1) },
  check: (_ctx, { _secret }) => {
    expectTypeOf(_secret).toEqualTypeOf<string>();

    if (_secret !== 'open sesame') deny('FORBIDDEN', 'wrong secret');
  },
});

type Action = (raw: unknown, ctx: unknown) => Promise<unknown>;

describe('defineAction', () => {
  test('runs guards after validation and hands the handler the narrowed context', async () => {
    const action = defineAction({
      input: z.object({ name: z.string() }),
      guards: [authenticated],
      handler: (input, ctx) => {
        expectTypeOf(input).toEqualTypeOf<{ name: string }>();
        expectTypeOf(ctx.locals.user).toEqualTypeOf<User>();

        return `${input.name}:${ctx.locals.user.id}`;
      },
    }) as unknown as Action;

    const user = { id: 'u1', admin: false };

    expect(await action({ name: 'x' }, createContext({ user }))).toBe('x:u1');
    await expect(action({ name: 'x' }, createContext())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('merges guard input into the schema and strips it before the handler', async () => {
    const handler = vi.fn((input: { name: string }) => input);
    const action = defineAction({
      input: z.object({ name: z.string() }),
      guards: [secret],
      handler,
    }) as unknown as Action;

    expect(await action({ name: 'x', _secret: 'open sesame' }, createContext())).toEqual({ name: 'x' });
    expect(handler).toHaveBeenCalledWith({ name: 'x' }, expect.anything());

    await expect(action({ name: 'x', _secret: 'nope' }, createContext())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(action({ name: 'x' }, createContext())).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('keeps a guard field the action declares itself', async () => {
    const owner = defineGuard({
      name: 'owner',
      input: { projectId: z.string() },
      check: (_ctx, { projectId }) => ({ project: { id: projectId } }),
    });
    const action = defineAction({
      input: z.object({ projectId: z.string(), name: z.string() }),
      guards: [owner],
      handler: (input, ctx) => ({ ...input, loaded: ctx.locals.project.id }),
    }) as unknown as Action;

    expect(await action({ projectId: 'p1', name: 'x' }, createContext())).toEqual({
      projectId: 'p1',
      name: 'x',
      loaded: 'p1',
    });
  });

  test('creates the schema from the guard input when the action has none', async () => {
    const action = defineAction({ guards: [secret], handler: (input) => input }) as unknown as Action;

    expect(await action({ _secret: 'open sesame', extra: 1 }, createContext())).toEqual({});
  });

  test('rejects guard input on a form action without a schema', () => {
    expect(() => defineAction({ accept: 'form', guards: [secret], handler: () => undefined })).toThrow('form action');
  });

  test('extended guards run their parent first and both proofs land on locals', async () => {
    const seen: string[] = [];
    const action = defineAction({
      guards: [admin],
      handler: (_input, ctx) => {
        seen.push(ctx.locals.user.id);
      },
    }) as unknown as Action;

    await action({}, createContext({ user: { id: 'root', admin: true } }));
    await expect(action({}, createContext({ user: { id: 'u1', admin: false } }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(action({}, createContext())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(seen).toEqual(['root']);
  });

  test('the client input carries the guard fields', () => {
    const withSchema = defineAction({
      input: z.object({ name: z.string() }),
      guards: [secret, authenticated],
      handler: () => undefined,
    });
    const withoutSchema = defineAction({ guards: [secret], handler: () => undefined });
    const unguarded = defineAction({ input: z.object({ name: z.string() }), handler: () => undefined });

    expectTypeOf(withSchema).parameter(0).toEqualTypeOf<{ name: string; _secret: string }>();
    expectTypeOf(withoutSchema).parameter(0).toEqualTypeOf<{ _secret: string }>();
    expectTypeOf(unguarded).parameter(0).toEqualTypeOf<{ name: string }>();
  });

  test('intersects the proofs of several guards', () => {
    const project = defineGuard({ name: 'project', check: () => ({ project: { name: 'p' } }) });

    defineAction({
      guards: [authenticated, project],
      handler: (_input, ctx) => {
        expectTypeOf(ctx.locals.user).toEqualTypeOf<User>();
        expectTypeOf(ctx.locals.project).toEqualTypeOf<{ name: string }>();
      },
    });
  });
});

describe('defineRoute', () => {
  test('answers a denial with its status and a json error', async () => {
    const route = defineRoute({ guards: [admin], handler: () => new Response('ok') });

    const denied = await route(createContext({ user: { id: 'u1', admin: false } }));

    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'FORBIDDEN' } });
    expect((await route(createContext())).status).toBe(401);
    expect(await (await route(createContext({ user: { id: 'root', admin: true } }))).text()).toBe('ok');
  });

  test('reads guard input from a json or form body and leaves the body readable', async () => {
    const route = defineRoute({
      guards: [secret],
      handler: async (ctx) => new Response(await ctx.request.text()),
    });

    const json = createContext(
      {},
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ _secret: 'open sesame', name: 'x' }),
      },
    );

    expect(await (await route(json)).text()).toContain('"name":"x"');

    const form = createContext(
      {},
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _secret: 'nope' }),
      },
    );

    expect((await route(form)).status).toBe(403);

    const empty = createContext({}, { method: 'POST' });

    expect((await route(empty)).status).toBe(400);
  });
});

describe('guard', () => {
  test('destructures into the denial or the proofs', async () => {
    const granted = await guard(createContext({ user: { id: 'u1', admin: false } }, browser), [authenticated]);

    if (granted.denied) throw new Error('unexpected denial');

    expectTypeOf(granted.user).toEqualTypeOf<User>();
    expect(granted.user.id).toBe('u1');

    const { denied, user } = await guard(createContext({}, browser), [authenticated]);

    expectTypeOf(user).toEqualTypeOf<User | undefined>();
    expect(denied?.status).toBe(302);
    expect(denied?.headers.get('location')).toBe('/login');
  });

  test('the denying guard picks the page response, inherited by extensions unless overridden', async () => {
    const asAnonymous = await guard(createContext({}, browser), [admin]);
    const asUser = await guard(createContext({ user: { id: 'u1', admin: false } }, browser), [admin]);

    expect(asAnonymous.denied?.headers.get('location')).toBe('/login');
    expect(await asUser.denied?.text()).toBe('rewritten');

    const plain = defineGuard({ name: 'plain', check: () => deny('NOT_FOUND', 'gone') });
    const fallback = await guard(createContext({}, browser), [plain]);

    expect(fallback.denied?.status).toBe(404);
    expect(await fallback.denied?.text()).toBe('gone');
  });

  test('answers per the request: the page response for a browser, json for everything else', async () => {
    const asApi = await guard(createContext(), [authenticated]);

    expect(asApi.denied?.status).toBe(401);
    expect(await asApi.denied?.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' } });

    const route = defineRoute({ guards: [authenticated], handler: () => new Response('ok') });
    const asBrowser = await route(createContext({}, browser));

    expect(asBrowser.status).toBe(302);
    expect(asBrowser.headers.get('location')).toBe('/login');
  });

  test('answers 400 when a request carries no guard input', async () => {
    const { denied } = await guard(createContext({}, { method: 'GET' }), [secret]);

    expect(denied?.status).toBe(400);
  });
});

describe('createGuardMiddleware', () => {
  const next = vi.fn(async () => new Response('page'));
  const middleware = createGuardMiddleware([
    { match: [{ prefix: '/admin' }], guards: [admin] },
    { match: [{ prefix: '/app' }, { exact: '/me' }], guards: [authenticated] },
  ]);

  test('runs the guards of every matching rule and answers the first denial as a page would', async () => {
    const anonymous = (await middleware(createContext({}, browser, '/admin/users'), next)) as Response;

    expect(anonymous.headers.get('location')).toBe('/login');

    const alice = (await middleware(
      createContext({ user: { id: 'u1', admin: false } }, browser, '/admin'),
      next,
    )) as Response;

    expect(await alice.text()).toBe('rewritten');

    const me = (await middleware(createContext({ user: { id: 'u1', admin: false } }, {}, '/me'), next)) as Response;

    expect(await me.text()).toBe('page');
  });

  test('leaves unmatched paths to the next handler without running anything', async () => {
    const check = vi.fn(() => ({}));
    const spy = defineGuard({ name: 'spy', check });
    const guarded = createGuardMiddleware([{ match: [{ prefix: '/app' }], guards: [spy] }]);

    await guarded(createContext({}, {}, '/public'), next);

    expect(check).not.toHaveBeenCalled();
  });
});

describe('per-request memo', () => {
  test('a guard that passed runs once per request, its proofs replayed', async () => {
    const check = vi.fn(() => ({ loaded: Math.random() }));
    const loader = defineGuard({ name: 'loader', check });
    const ctx = createContext({ user: { id: 'u1', admin: false } });

    const first = await guard(ctx, [loader]);
    const second = await guard(ctx, [loader, authenticated]);

    expect(check).toHaveBeenCalledTimes(1);
    expect(second.loaded).toBe(first.loaded);
    expect(ctx.locals).toMatchObject({ loaded: first.loaded, user: { id: 'u1' } });

    await guard(createContext(), [loader]);

    expect(check).toHaveBeenCalledTimes(2);
  });

  test('a denial is not remembered', async () => {
    const ctx = createContext();

    expect((await guard(ctx, [authenticated])).denied?.status).toBe(401);

    (ctx.locals as Locals).user = { id: 'u1', admin: false };

    expect((await guard(ctx, [authenticated])).user?.id).toBe('u1');
  });
});
