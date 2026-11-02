import { type Destination, defineRelayClient } from '@astroscope/relay/client';
import { ga4Tag } from '@astroscope/relay/ga4';
import { demoConsent } from './consent';

declare global {
  interface Window {
    demoConsent: typeof demoConsent;
    /** what the `crm` destination took, for the page and the tests */
    crmLog: { name: string; id: string; key: string | undefined }[];
  }
}

// the crm "pixel" of the demo: a destination that is never ready until the page says so, to show the readiness wait
const crm: Destination<'crm'> = {
  name: 'crm',
  ready: () => document.documentElement.dataset['crmLoaded'] === 'true',
  send: (event, meta) => {
    window.crmLog.push({ name: event.name, id: meta.id, key: meta.key });
    document.dispatchEvent(new CustomEvent('crm'));
  },
};

Object.assign(window, { crmLog: [], demoConsent });

export default defineRelayClient({
  destinations: { ga4: ga4Tag(), crm },
  // the stand-in cmp as a consent source: its choice by name, re-checked through `notifyRelay()` in its `set()`
  consent: { names: ['ga4', 'crm'], of: (name) => demoConsent.consented(name) },
});
