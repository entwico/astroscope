import type { CapConfig } from './types.js';

// keyed on globalThis so the boot file and the injected middleware share one config even when
// they are evaluated as separate module instances (vite runner vs. native)
const CONFIG_KEY = Symbol.for('@astroscope/cap.config');

type ConfigHolder = { [CONFIG_KEY]?: CapConfig | undefined };

// the site key is a path segment of every upstream url: these would change which path is hit
const SITE_KEY_FORBIDDEN = /[/?#]/;

/** the origin and base path of the cap service, so a typo fails the boot instead of every request */
function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('cap.configure(): baseUrl must be an absolute http(s) url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`cap.configure(): baseUrl must be an http(s) url, got ${url.protocol}`);
  }

  if (value.includes('?') || value.includes('#')) {
    throw new Error('cap.configure(): baseUrl must not carry a query or fragment');
  }

  return url.href.replace(/\/+$/, '');
}

class CapSingleton {
  /** set the cap service credentials; call it in `onStartup` of `src/boot.ts`, before requests are served */
  configure(config: CapConfig): void {
    for (const key of ['baseUrl', 'siteKey', 'secretKey'] as const) {
      if (!config[key]?.trim()) {
        throw new Error(`cap.configure(): ${key} is required`);
      }
    }

    const siteKey = config.siteKey.trim();

    if (SITE_KEY_FORBIDDEN.test(siteKey)) {
      throw new Error('cap.configure(): siteKey must not contain "/", "?" or "#"');
    }

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the `Symbol.for` slot on globalThis is the store shared across module instances
    (globalThis as ConfigHolder)[CONFIG_KEY] = {
      baseUrl: normalizeBaseUrl(config.baseUrl.trim()),
      siteKey,
      secretKey: config.secretKey.trim(),
    };
  }

  isConfigured(): boolean {
    return this.getConfig() !== undefined;
  }

  /** @internal */
  getConfig(): CapConfig | undefined {
    return (globalThis as ConfigHolder)[CONFIG_KEY];
  }

  /** @internal */
  reset(): void {
    delete (globalThis as ConfigHolder)[CONFIG_KEY];
  }
}

export const cap = new CapSingleton();
