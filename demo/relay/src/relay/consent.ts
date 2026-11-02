import { notifyRelay } from '@astroscope/relay/client';

const STORAGE_KEY = 'demo-consent';

/** the choice by destination name */
export type DemoConsent = Record<'ga4' | 'crm', boolean>;

/**
 * A stand-in for a cmp: the choice lives in localStorage, `undefined` until the visitor chose, and
 * the bus is told on every change. A real site wraps its cmp's api and events the same way.
 */
export const demoConsent = {
  get(): DemoConsent | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      return raw ? (JSON.parse(raw) as DemoConsent) : undefined;
    } catch {
      return undefined;
    }
  },

  /** what a destination asks: `undefined` while the visitor has not chosen */
  consented(name: keyof DemoConsent): boolean | undefined {
    return demoConsent.get()?.[name];
  },

  set(choice: DemoConsent | undefined): void {
    if (choice) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }

    notifyRelay();
  },
};
