// imported by the pixel and the conversions api — no node or browser imports here

import type { ConversionUser } from '../conversion-user.js';

/** monetary values are integers in the minor unit of the currency: 12999 for 129.99 EUR */
export type OpenAiContent = {
  id: string;
  name: string;
  content_type: string;
  quantity: number;
  amount: number;
  currency: string;
};

export type OpenAiContentsData = {
  type: 'contents';
  amount: number;
  currency: string;
  contents: readonly OpenAiContent[];
};

export type OpenAiCustomerActionData = {
  type: 'customer_action';
};

/**
 * What openai takes, from the pixel and from the conversions api alike: the event and, for a
 * conversion the visitor entered identifiers for, the identifiers — hashed by whichever half sends.
 */
export type OpenAiEvent = (
  | {
    name: 'contents_viewed' | 'items_added' | 'checkout_started' | 'order_created';
    data: OpenAiContentsData;
  }
  | {
    name: 'lead_created';
    data: OpenAiCustomerActionData;
  }
) & {
  user?: ConversionUser | undefined;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    openai: OpenAiEvent;
  }
}

export type OpenAiContentInput = { id: string; name: string; price: number; quantity: number };

export type OpenAiContents = {
  items: readonly OpenAiContentInput[];
  currency: string;
  /** the total; default: the items summed */
  value?: number | undefined;
  /** the `content_type` of the contents; default `product` */
  contentType?: string | undefined;
  user?: ConversionUser | undefined;
};

/** the openai builders: the events openai has a name for. What an event definition puts under `openai` */
export const openai = {
  contentsViewed: (contents: OpenAiContents): OpenAiEvent => contentsEvent('contents_viewed', contents),
  itemsAdded: (contents: OpenAiContents): OpenAiEvent => contentsEvent('items_added', contents),
  checkoutStarted: (contents: OpenAiContents): OpenAiEvent => contentsEvent('checkout_started', contents),
  orderCreated: (contents: OpenAiContents): OpenAiEvent => contentsEvent('order_created', contents),
  leadCreated: (user?: ConversionUser): OpenAiEvent => ({ name: 'lead_created', data: { type: 'customer_action' }, user }),
};

function contentsEvent(
  name: 'contents_viewed' | 'items_added' | 'checkout_started' | 'order_created',
  { items, currency, value, contentType = 'product', user }: OpenAiContents,
): OpenAiEvent {
  const total = value ?? items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    name,
    data: {
      type: 'contents',
      amount: toMinorUnits(total),
      currency,
      contents: items.map((item) => ({
        id: item.id,
        name: item.name,
        content_type: contentType,
        quantity: item.quantity,
        amount: toMinorUnits(item.price),
        currency,
      })),
    },
    user,
  };
}

export function toMinorUnits(value: number): number {
  return Math.round(value * 100);
}
