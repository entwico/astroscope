import type { CapConfig } from './types.js';

// keyed on globalThis so the boot file and the injected middleware share one config even when
// they are evaluated as separate module instances (vite runner vs. native)
const CONFIG_KEY = Symbol.for('@astroscope/cap.config');

type ConfigHolder = { [CONFIG_KEY]?: CapConfig | undefined };

class CapSingleton {
  /** set the cap service credentials; call it in `onStartup` of `src/boot.ts`, before requests are served */
  configure(config: CapConfig): void {
    for (const key of ['baseUrl', 'siteKey', 'secretKey'] as const) {
      if (!config[key]?.trim()) {
        throw new Error(`cap.configure(): ${key} is required`);
      }
    }

    (globalThis as ConfigHolder)[CONFIG_KEY] = {
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ''),
      siteKey: config.siteKey.trim(),
      secretKey: config.secretKey.trim(),
    };
  }

  isConfigured(): boolean {
    return !!(globalThis as ConfigHolder)[CONFIG_KEY];
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
