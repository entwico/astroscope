import { defineEvent } from '@astroscope/relay';
import { ga4 } from '@astroscope/relay/ga4';

/** what the demo shop sells */
export type DemoItem = { id: string; name: string; price: number };

/** what the demo's crm takes: the event's name and, for a lead, the email it records */
export type CrmEvent = { name: string; email?: string | undefined };

declare module '@astroscope/relay' {
  interface RelayDestinations {
    crm: CrmEvent;
  }
}

/** a completed lead: the email, and the event id when the server already reported it */
export type Lead = { id?: string | undefined; email: string };

const toItem = (item: DemoItem) => ({ item_id: item.id, item_name: item.name, price: item.price, quantity: 1 });

// the demo's events: the site's own objects in, a payload per destination out
export const viewProductEvent = defineEvent('viewProduct', (item: DemoItem) => ({
  ga4: ga4.viewItem({ items: [toItem(item)] }),
  crm: { name: 'view_item' },
}));

export const selectOfferEvent = defineEvent('selectOffer', (item: DemoItem, list: string) => ({
  ga4: ga4.selectItem({ item_list_name: list, items: [toItem(item)] }),
  crm: { name: 'select_item' },
}));

export const searchEvent = defineEvent('search', (term: string) => ({ ga4: ga4.search({ search_term: term }), crm: { name: 'search' } }));

export const newsletterEvent = defineEvent('newsletter', ({ id, email }: Lead) => ({
  id,
  ga4: ga4.signUp({ method: 'newsletter' }),
  crm: { name: 'sign_up', email },
}));

// the form view is the tag's business only: the crm does not get it
export const viewFormEvent = defineEvent('viewForm', (form: string) => ({ ga4: ga4.event('view_form', { form }) }));
