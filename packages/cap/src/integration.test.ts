import fs from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import capIntegration from './integration';
import type { CapIntegrationOptions } from './types';

type ConfigPlugin = {
  resolveId: (id: string) => string | undefined;
  load: (id: string) => string | undefined;
};

function setup(options?: CapIntegrationOptions) {
  const addMiddleware = vi.fn();
  const updateConfig = vi.fn();
  const hook = capIntegration(options).hooks['astro:config:setup'] as unknown as (params: unknown) => void;

  hook({ addMiddleware, updateConfig });

  const { vite } = updateConfig.mock.calls[0]?.[0] as { vite: { plugins: ConfigPlugin[] } };

  return { addMiddleware, plugin: vite.plugins[0]! };
}

function loadConfig(plugin: ConfigPlugin): string | undefined {
  return plugin.load(plugin.resolveId('virtual:@astroscope/cap/config')!);
}

describe('cap integration', () => {
  test('injects the proxy middleware ahead of the site middleware', () => {
    const { addMiddleware } = setup();

    expect(addMiddleware).toHaveBeenCalledWith({ order: 'pre', entrypoint: '@astroscope/cap/middleware' });
  });

  test('serves the default path through the virtual config module', () => {
    const { plugin } = setup();

    expect(loadConfig(plugin)).toBe('export const path = "/_cap/";');
  });

  test.each(['captcha', '/captcha', 'captcha/', ' /captcha/ '])('normalizes the path option %j', (path) => {
    const { plugin } = setup({ path });

    expect(loadConfig(plugin)).toBe('export const path = "/captcha/";');
  });

  test('refuses the root as path when the integration is created', () => {
    expect(() => capIntegration({ path: '/' })).toThrow('path must not be empty');
  });

  test('loads nothing but the virtual config module', () => {
    const { plugin } = setup();

    expect(plugin.load('virtual:@astroscope/cap/config')).toBeUndefined();
    expect(plugin.load('/src/pages/index.astro')).toBeUndefined();
  });

  test('resolves the pako import to the umd build, keeping the query', () => {
    const { plugin } = setup();
    const resolved = plugin.resolveId('pako/browser/inflate');

    // the widget loads the file as a classic script, an esm build would be a syntax error there
    expect(fs.readFileSync(resolved!, 'utf8')).not.toMatch(/\bexport\s*(\{|default\b)/);
    expect(plugin.resolveId('pako/browser/inflate?url')).toBe(`${resolved}?url`);
  });

  test('leaves other ids to vite, other pako entries included', () => {
    const { plugin } = setup();

    expect(plugin.resolveId('pako')).toBeUndefined();
    expect(plugin.resolveId('pako/browser/inflate.js')).toBeUndefined();
    expect(plugin.resolveId('x/pako/browser/inflate')).toBeUndefined();
    expect(plugin.resolveId('virtual:@astroscope/cap/config?x')).toBeUndefined();
  });
});
