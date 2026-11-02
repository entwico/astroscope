import { type ServerDestination, defineRelayServer, normalizeEmail, sha256 } from '@astroscope/relay/server';

export type CrmRecord = {
  id: string;
  event: string;
  key: string | undefined;
  email: string | undefined;
  clientAddress: string;
};

/** what the crm "conversions api" received, for the page and the tests */
export const crmRecords: CrmRecord[] = [];

/** the server half of the crm: consent by its name, the one the browser destination carries */
const crmSender: ServerDestination<'crm'> = {
  name: 'crm',
  send: async (event, { id, key, request }) => {
    const email = normalizeEmail(event.email);

    crmRecords.push({
      id,
      event: event.name,
      key,
      email: email && (await sha256(email)),
      clientAddress: request.clientAddress,
    });
  },
};

export default defineRelayServer({
  destinations: { crm: crmSender },
  // e2e sessions are excluded from reporting the way a real site would exclude its test traffic
  exclude: (ctx) => ctx.request.headers.get('x-e2e') === '1',
});
