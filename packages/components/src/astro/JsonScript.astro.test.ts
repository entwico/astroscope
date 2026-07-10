import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

import JsonScript from './JsonScript.astro';

const scriptBody = (html: string) => html.match(/<script[^>]*>(.*)<\/script>/s)?.[1] ?? '';

describe('JsonScript', () => {
  let container: Awaited<ReturnType<typeof AstroContainer.create>>;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  const render = (props: Record<string, unknown>) => container.renderToString(JsonScript, { props });

  test('defaults the type to application/json', async () => {
    const html = await render({ data: { a: 1 } });

    expect(html).toContain('<script type="application/json">');
    expect(scriptBody(html)).toBe('{"a":1}');
  });

  test('honors a custom type and id', async () => {
    const html = await render({ data: { a: 1 }, type: 'application/ld+json', id: 'x' });

    expect(html).toContain('<script type="application/ld+json" id="x">');
  });

  test('escapes `<` so a value cannot break out of the script', async () => {
    const html = await render({ data: { evil: '</script><img src=x onerror=alert(1)>' } });
    const body = scriptBody(html);

    expect(body).not.toContain('<');
    expect(body).toContain('\\u003c');
  });

  test('the escaped block parses back to the exact original', async () => {
    const data = { evil: '</script>', ok: 'a<b & c' };
    const html = await render({ data });

    expect(JSON.parse(scriptBody(html))).toEqual(data);
  });
});
