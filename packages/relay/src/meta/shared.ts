// imported by the pixel and the conversions api — no node or browser imports here

import type { ConversionUser } from '../conversion-user.js';

/** the standard events meta optimizes on; anything else is a custom event */
export type MetaStandardEventName =
  | 'AddPaymentInfo'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'CompleteRegistration'
  | 'Contact'
  | 'CustomizeProduct'
  | 'Donate'
  | 'FindLocation'
  | 'InitiateCheckout'
  | 'Lead'
  | 'PageView'
  | 'Purchase'
  | 'Schedule'
  | 'Search'
  | 'StartTrial'
  | 'SubmitApplication'
  | 'Subscribe'
  | 'ViewContent';

/** an item of `contents` */
export type MetaContent = {
  id: string;
  quantity: number;
  item_price?: number | undefined;
  title?: string | undefined;
  category?: string | undefined;
  [key: string]: unknown;
};

/** the parameters of an event, as the pixel and the conversions api take them under `custom_data` */
export type MetaCustomData = {
  value?: number | undefined;
  currency?: string | undefined;
  content_name?: string | undefined;
  content_category?: string | undefined;
  content_ids?: readonly string[] | undefined;
  content_type?: 'product' | 'product_group' | undefined;
  contents?: readonly MetaContent[] | undefined;
  num_items?: number | undefined;
  order_id?: string | undefined;
  search_string?: string | undefined;
  status?: string | undefined;
  predicted_ltv?: number | undefined;
  [key: string]: unknown;
};

export type MetaPurchaseData = MetaCustomData & { value: number; currency: string };

/**
 * What meta takes, from the pixel and from the conversions api alike: the event, its parameters
 * and, for a conversion the visitor entered identifiers for, the identifiers — hashed by whichever
 * half sends them.
 */
export type MetaEvent = {
  name: string;
  /** a custom event goes through `trackCustom`; a standard one through `track` */
  custom: boolean;
  data: MetaCustomData;
  user?: ConversionUser | undefined;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    meta: MetaEvent;
  }
}

const standard = (name: MetaStandardEventName, data: MetaCustomData = {}, user?: ConversionUser): MetaEvent => ({
  name,
  custom: false,
  data,
  user,
});

/**
 * The meta builders: the standard events, and `event(name, data)` for a custom one. What an event
 * definition puts under `meta`.
 */
export const meta = {
  /** a standard event by name, for one without its own builder */
  standard,
  /** a custom event: any name meta has no standard event for */
  event: (name: string, data: MetaCustomData = {}, user?: ConversionUser): MetaEvent => ({
    name,
    custom: true,
    data,
    user,
  }),
  pageView: (): MetaEvent => standard('PageView'),
  viewContent: (data: MetaCustomData, user?: ConversionUser): MetaEvent => standard('ViewContent', data, user),
  search: (data: MetaCustomData, user?: ConversionUser): MetaEvent => standard('Search', data, user),
  addToCart: (data: MetaCustomData, user?: ConversionUser): MetaEvent => standard('AddToCart', data, user),
  initiateCheckout: (data: MetaCustomData, user?: ConversionUser): MetaEvent => standard('InitiateCheckout', data, user),
  addPaymentInfo: (data: MetaCustomData, user?: ConversionUser): MetaEvent => standard('AddPaymentInfo', data, user),
  purchase: (data: MetaPurchaseData, user?: ConversionUser): MetaEvent => standard('Purchase', data, user),
  lead: (data?: MetaCustomData, user?: ConversionUser): MetaEvent => standard('Lead', data, user),
  completeRegistration: (data?: MetaCustomData, user?: ConversionUser): MetaEvent => standard('CompleteRegistration', data, user),
  subscribe: (data?: MetaCustomData, user?: ConversionUser): MetaEvent => standard('Subscribe', data, user),
  schedule: (data?: MetaCustomData, user?: ConversionUser): MetaEvent => standard('Schedule', data, user),
  contact: (data?: MetaCustomData, user?: ConversionUser): MetaEvent => standard('Contact', data, user),
};
