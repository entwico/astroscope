import fs from 'node:fs';
import type { AstroIntegration, AstroRenderer } from 'astro';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactOptions } from './integration';

type ViteConfig = { resolve?: { alias?: Record<string, string> }; plugins?: unknown[] };

async function loadIntegration(): Promise<(options?: ReactOptions) => AstroIntegration> {
  const module = await import('./integration');

  return module.default;
}

async function setup(integration: AstroIntegration, command = 'build') {
  const renderers: AstroRenderer[] = [];
  const configs: { vite: ViteConfig }[] = [];
  const injectScript = vi.fn();
  const hook = integration.hooks['astro:config:setup'] as unknown as (params: unknown) => Promise<void>;

  await hook({
    command,
    addRenderer: (renderer: AstroRenderer) => {
      renderers.push(renderer);
    },
    updateConfig: (config: { vite: ViteConfig }) => {
      configs.push(config);
    },
    injectScript,
  });

  const pluginNames = configs
    .flatMap((config) => config.vite.plugins ?? [])
    .flat(Infinity)
    .map((plugin) => (plugin as { name?: string } | null)?.name);

  return { renderers, configs, injectScript, pluginNames };
}

afterEach(() => {
  vi.doUnmock('@astrojs/react');
  vi.doUnmock('react-dom');
  vi.resetModules();
});

describe('react integration', () => {
  test('registers the upstream renderer with only the server entrypoint swapped', async () => {
    const { default: astroReact } = await import('@astrojs/react');
    const react = await loadIntegration();
    const upstreamSetup = await setup(astroReact());
    const [upstream] = upstreamSetup.renderers;
    const { renderers } = await setup(react());

    expect(upstream?.serverEntrypoint).toBe('@astrojs/react/server.js');
    expect(renderers).toEqual([{ ...upstream, serverEntrypoint: '@astroscope/react/server' }]);
  });

  test('aliases the upstream client entrypoint to a file on disk', async () => {
    const react = await loadIntegration();
    const { configs } = await setup(react());
    const alias = configs.map((config) => config.vite.resolve?.alias?.['@astrojs/react/client.js']).find(Boolean);

    expect(alias).toBeDefined();
    expect(fs.existsSync(alias!)).toBe(true);
  });

  test('adds the effect stripping plugin unless stripEffects is off', async () => {
    const react = await loadIntegration();

    const stripping = await setup(react());
    const plain = await setup(react({ stripEffects: false }));

    expect(stripping.pluginNames).toContain('@astroscope/react/strip-effects');
    expect(plain.pluginNames).not.toContain('@astroscope/react/strip-effects');
  });

  test('keeps what the upstream hook does besides the renderer', async () => {
    const react = await loadIntegration();
    const { injectScript, pluginNames } = await setup(react(), 'dev');

    expect(injectScript).toHaveBeenCalledWith('before-hydration', expect.any(String));
    expect(pluginNames).toContain('vite:react-babel');
  });

  test('delegates every other upstream hook and passes the upstream options on without stripEffects', async () => {
    const done = vi.fn();
    const upstream = vi.fn(() => ({ name: '@astrojs/react', hooks: { 'astro:config:done': done } }));

    vi.doMock('@astrojs/react', () => ({ default: upstream }));

    const react = await loadIntegration();
    const integration = react({ stripEffects: false, include: ['**/react/*'] });

    expect(upstream).toHaveBeenCalledWith({ include: ['**/react/*'] });
    expect(integration.hooks['astro:config:done']).toBe(done);
  });

  test('refuses an upstream renderer whose server entrypoint it does not know', async () => {
    vi.doMock('@astrojs/react', () => ({
      default: () => ({
        name: '@astrojs/react',
        hooks: {
          'astro:config:setup': ({ addRenderer }: { addRenderer: (renderer: AstroRenderer) => void }) => {
            addRenderer({ name: '@astrojs/react', serverEntrypoint: '@astrojs/react/server-v17.js' });
          },
        },
      }),
    }));

    const react = await loadIntegration();

    await expect(setup(react())).rejects.toThrow('unexpected @astrojs/react server entrypoint');
  });

  test.each(['18.3.1', 'canary'])('refuses react-dom %s', async (version) => {
    vi.doMock('react-dom', () => ({ version }));

    const react = await loadIntegration();

    expect(() => react()).toThrow(`unsupported react-dom version ${version}`);
  });
});
