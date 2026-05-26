import { describe, expect, test } from 'vitest';
import { stripSsrEffectsPlugin } from './strip-effects';

type TransformResult = { code: string; map: unknown } | null;
type TransformFn = (code: string, id: string, opts?: { ssr?: boolean }) => TransformResult;

function getTransform(): TransformFn {
  const plugin = stripSsrEffectsPlugin();
  const t = plugin.transform as unknown as TransformFn;

  if (typeof t !== 'function') throw new Error('transform should be a function');

  return (code, id, opts) => t.call({}, code, id, opts);
}

describe('stripSsrEffectsPlugin — scope filters', () => {
  test('returns null when not an SSR pass', () => {
    const transform = getTransform();
    const code = `import { useEffect } from 'react'; useEffect(() => { console.log('x'); });`;

    expect(transform(code, '/src/Island.tsx', { ssr: false })).toBeNull();
    expect(transform(code, '/src/Island.tsx', undefined)).toBeNull();
  });

  test('returns null for files inside node_modules', () => {
    const transform = getTransform();
    const code = `import { useEffect } from 'react'; useEffect(() => { console.log('x'); });`;

    expect(transform(code, '/foo/node_modules/some-lib/dist/index.js', { ssr: true })).toBeNull();
  });

  test('returns null for non-JS/TS extensions', () => {
    const transform = getTransform();
    const code = `useEffect(() => {})`;

    expect(transform(code, '/src/foo.css', { ssr: true })).toBeNull();
    expect(transform(code, '/src/foo.json', { ssr: true })).toBeNull();
  });

  test('returns null when code does not mention any hook name', () => {
    const transform = getTransform();
    const code = `import { useState } from 'react'; const [x] = useState(0);`;

    expect(transform(code, '/src/Island.tsx', { ssr: true })).toBeNull();
  });

  test('returns null when hook name is present but not imported from react', () => {
    const transform = getTransform();
    const code = `import { useEffect } from 'some-other-lib'; useEffect(() => { foo(); });`;

    expect(transform(code, '/src/Island.tsx', { ssr: true })).toBeNull();
  });
});

describe('stripSsrEffectsPlugin — replacement behavior', () => {
  test('empties useEffect callback imported as named binding', () => {
    const transform = getTransform();
    const code = [
      `import { useEffect } from 'react';`,
      `export function C() {`,
      `  useEffect(() => {`,
      `    import('maplibre-gl').then(m => m.create());`,
      `  }, []);`,
      `  return null;`,
      `}`,
    ].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true });

    expect(out).not.toBeNull();
    expect(out!.code).toContain('useEffect((()=>{}), [])');
    expect(out!.code).not.toContain('maplibre-gl');
  });

  test('empties useLayoutEffect and useInsertionEffect', () => {
    const transform = getTransform();
    const code = [
      `import { useLayoutEffect, useInsertionEffect } from 'react';`,
      `useLayoutEffect(() => { sideEffectA(); });`,
      `useInsertionEffect(() => { sideEffectB(); });`,
    ].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('useLayoutEffect((()=>{}))');
    expect(out.code).toContain('useInsertionEffect((()=>{}))');
    expect(out.code).not.toContain('sideEffectA');
    expect(out.code).not.toContain('sideEffectB');
  });

  test('respects aliased named imports', () => {
    const transform = getTransform();
    const code = [`import { useEffect as useFx } from 'react';`, `useFx(() => { import('hls.js'); });`].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('useFx((()=>{}))');
    expect(out.code).not.toContain('hls.js');
  });

  test('empties hook callbacks called via default react import', () => {
    const transform = getTransform();
    const code = [`import React from 'react';`, `React.useEffect(() => { import('maplibre-gl'); });`].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('React.useEffect((()=>{}))');
    expect(out.code).not.toContain('maplibre-gl');
  });

  test('empties hook callbacks called via namespace react import', () => {
    const transform = getTransform();
    const code = [
      `import * as React from 'react';`,
      `React.useEffect(() => { import('maplibre-gl'); });`,
      `React.useState(0);`,
    ].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('React.useEffect((()=>{}))');
    expect(out.code).toContain('React.useState(0)');
    expect(out.code).not.toContain('maplibre-gl');
  });

  test('does not touch React.useState — only effect hooks', () => {
    const transform = getTransform();
    const code = [`import * as React from 'react';`, `React.useState(0);`].join('\n');

    expect(transform(code, '/src/Island.tsx', { ssr: true })).toBeNull();
  });

  test('handles react subpath imports (react/jsx-runtime, etc.)', () => {
    const transform = getTransform();
    const code = [`import { useEffect } from 'react/foo';`, `useEffect(() => { thing(); });`].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('useEffect((()=>{}))');
  });

  test('preserves second argument (dependency array)', () => {
    const transform = getTransform();
    const code = [`import { useEffect } from 'react';`, `useEffect(() => { doThing(); }, [a, b, c]);`].join('\n');

    const out = transform(code, '/src/Island.tsx', { ssr: true })!;

    expect(out.code).toContain('useEffect((()=>{}), [a, b, c])');
  });

  test('returns null when syntactically broken (parser throws)', () => {
    const transform = getTransform();
    const code = `import { useEffect } from 'react'; useEffect(() => { `;

    expect(transform(code, '/src/Island.tsx', { ssr: true })).toBeNull();
  });
});
