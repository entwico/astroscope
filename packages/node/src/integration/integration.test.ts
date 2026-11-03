import { pathToFileURL } from 'node:url';
import type { AstroConfig, AstroIntegration } from 'astro';
import { sharpImageService } from 'astro/config';
import { describe, expect, test, vi } from 'vitest';
import node from './integration';

type ConfigSetup = Extract<AstroIntegration['hooks']['astro:config:setup'], (...args: never[]) => unknown>;

interface ImageUpdate {
  image?: { service?: { entrypoint: string } | undefined; endpoint?: { entrypoint: string } | undefined } | undefined;
}

function createConfig(service: { entrypoint: string; config: Record<string, unknown> }): AstroConfig {
  const root = pathToFileURL('/project/');

  return {
    root,
    srcDir: new URL('src/', root),
    trailingSlash: 'never',
    security: { allowedDomains: [] },
    image: { service, endpoint: {} },
    vite: {},
  } as unknown as AstroConfig;
}

function runSetup(config: AstroConfig): ImageUpdate {
  const updateConfig = vi.fn();
  const setup = node().hooks['astro:config:setup'] as ConfigSetup;

  setup({
    command: 'build',
    config,
    updateConfig,
    addMiddleware: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<ConfigSetup>[0]);

  return updateConfig.mock.calls[0]![0] as ImageUpdate;
}

describe('image service', () => {
  test('turns image processing off when the astro config leaves image.service at its default', () => {
    const update = runSetup(createConfig({ entrypoint: 'astro/assets/services/sharp', config: {} }));

    expect(update.image?.service?.entrypoint).toBe('@astroscope/node/image-service');
    expect(update.image?.endpoint?.entrypoint).toBe('@astroscope/node/image-endpoint');
  });

  test('keeps a non-sharp image.service from the astro config', () => {
    const update = runSetup(createConfig({ entrypoint: 'astro/assets/services/noop', config: {} }));

    expect(update.image?.service).toBeUndefined();
    expect(update.image?.endpoint?.entrypoint).toBe('astro/assets/endpoint/node');
  });

  test('treats an explicit sharpImageService() like the default: sharp needs imageService on', () => {
    const update = runSetup(createConfig({ ...sharpImageService(), config: {} }));

    expect(update.image?.service?.entrypoint).toBe('@astroscope/node/image-service');
  });
});
