// imported by the pixel and the conversions api — no node or browser imports here

import type { ConversionUser } from '../conversion-user.js';

/** monetary values are integers in the minor unit of the currency: 12999 for 129.99 EUR */
export type OpenAiContent = {
  id?: string | undefined;
  name?: string | undefined;
  /** e.g. `product`, `plan`, `page` */
  content_type?: string | undefined;
  quantity?: number | undefined;
  /** per unit */
  amount?: number | undefined;
  currency?: string | undefined;
};

/** what every data shape may carry: the money, and the items, where the event has any */
type OpenAiBaseData = {
  amount?: number | undefined;
  /** required with `amount` */
  currency?: string | undefined;
  contents?: readonly OpenAiContent[] | undefined;
};

export type OpenAiContentsData = OpenAiBaseData & {
  type: 'contents';
};

export type OpenAiCustomerActionData = Omit<OpenAiBaseData, 'contents'> & {
  type: 'customer_action';
};

export type OpenAiPlanEnrollmentData = OpenAiBaseData & {
  type: 'plan_enrollment';
  plan_id?: string | undefined;
};

export type OpenAiCustomData = OpenAiBaseData & {
  type: 'custom';
  plan_id?: string | undefined;
};

export type OpenAiContentsEventName = 'contents_viewed' | 'items_added' | 'checkout_started' | 'order_created' | 'page_viewed';
export type OpenAiCustomerActionEventName = 'lead_created' | 'registration_completed' | 'appointment_scheduled';
export type OpenAiPlanEnrollmentEventName = 'subscription_created' | 'trial_started';

/**
 * What openai takes, from the pixel and from the conversions api alike: the event and, for a
 * conversion the visitor entered identifiers for, the identifiers — hashed by whichever half sends.
 * The app events (`app_installed`, `app_opened`) are a mobile app's, not a website's, and have no builder.
 */
export type OpenAiEvent = (
  | {
    name: OpenAiContentsEventName;
    data: OpenAiContentsData;
  }
  | {
    name: OpenAiCustomerActionEventName;
    data: OpenAiCustomerActionData;
  }
  | {
    name: OpenAiPlanEnrollmentEventName;
    data: OpenAiPlanEnrollmentData;
  }
  | {
    name: 'custom';
    /** 1 to 64 lowercase letters, digits, underscores or dashes, no standard event's name */
    customName: string;
    data: OpenAiCustomData;
  }
) & {
  user?: ConversionUser | undefined;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    openai: OpenAiEvent;
  }
}

/** an item as the site has it: the price in the major unit, 129.99 for 129.99 EUR */
export type OpenAiContentInput = { id: string; name: string; price: number; quantity: number };

/** the money of an event: the total in the major unit, and its currency */
export type OpenAiMoney = { value: number; currency: string };

export type OpenAiContents = {
  items: readonly OpenAiContentInput[];
  currency: string;
  /** the total; default: the items summed */
  value?: number | undefined;
  /** the `content_type` of the contents; default `product` */
  contentType?: string | undefined;
  user?: ConversionUser | undefined;
};

export type OpenAiPlan = {
  /** the site's plan identifier */
  id?: string | undefined;
  money?: OpenAiMoney | undefined;
  /** the plan's items, if any; `content_type` `plan` by default */
  items?: readonly OpenAiContentInput[] | undefined;
  contentType?: string | undefined;
  user?: ConversionUser | undefined;
};

export type OpenAiCustom = OpenAiPlan & {
  /** the `content_type` of the items; default `product` */
  contentType?: string | undefined;
};

/**
 * The openai builders: every event openai has a name for, and `custom(name)`. What an event
 * definition puts under `openai`.
 */
export const openai = {
  contentsViewed: (contents: OpenAiContents): OpenAiEvent => contentsEvent('contents_viewed', contents),
  itemsAdded: (contents: OpenAiContents): OpenAiEvent => contentsEvent('items_added', contents),
  checkoutStarted: (contents: OpenAiContents): OpenAiEvent => contentsEvent('checkout_started', contents),
  orderCreated: (contents: OpenAiContents): OpenAiEvent => contentsEvent('order_created', contents),
  /** the page as a content: its id is what the reports group by, e.g. the path */
  pageViewed: (page: { id: string; name: string }): OpenAiEvent => ({
    name: 'page_viewed',
    data: { type: 'contents', contents: [{ id: page.id, name: page.name, content_type: 'page' }] },
  }),
  leadCreated: (user?: ConversionUser, money?: OpenAiMoney): OpenAiEvent => actionEvent('lead_created', user, money),
  registrationCompleted: (user?: ConversionUser, money?: OpenAiMoney): OpenAiEvent =>
    actionEvent('registration_completed', user, money),
  appointmentScheduled: (user?: ConversionUser, money?: OpenAiMoney): OpenAiEvent =>
    actionEvent('appointment_scheduled', user, money),
  subscriptionCreated: (plan: OpenAiPlan = {}): OpenAiEvent => planEvent('subscription_created', plan),
  trialStarted: (plan: OpenAiPlan = {}): OpenAiEvent => planEvent('trial_started', plan),
  /** a custom event: any name openai has no standard event for; throws for a name outside openai's rule */
  custom: (name: string, { id, money, items, contentType = 'product', user }: OpenAiCustom = {}): OpenAiEvent => ({
    name: 'custom',
    customName: validCustomName(name),
    data: { type: 'custom', plan_id: id, ...toMoneyData(money), ...toContentsData(items, contentType, money?.currency) },
    user,
  }),
};

function contentsEvent(name: OpenAiContentsEventName, { items, currency, value, contentType = 'product', user }: OpenAiContents): OpenAiEvent {
  const total = value ?? items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    name,
    data: { type: 'contents', ...toMoneyData({ value: total, currency }), ...toContentsData(items, contentType, currency) },
    user,
  };
}

function actionEvent(name: OpenAiCustomerActionEventName, user?: ConversionUser, money?: OpenAiMoney): OpenAiEvent {
  return { name, data: { type: 'customer_action', ...toMoneyData(money) }, user };
}

function planEvent(name: OpenAiPlanEnrollmentEventName, { id, money, items, contentType = 'plan', user }: OpenAiPlan): OpenAiEvent {
  return {
    name,
    data: { type: 'plan_enrollment', plan_id: id, ...toMoneyData(money), ...toContentsData(items, contentType, money?.currency) },
    user,
  };
}

const STANDARD_EVENT_NAMES: ReadonlySet<string> = new Set([
  'contents_viewed',
  'items_added',
  'checkout_started',
  'order_created',
  'page_viewed',
  'lead_created',
  'registration_completed',
  'appointment_scheduled',
  'subscription_created',
  'trial_started',
  'app_installed',
  'app_opened',
  'custom',
]);

const CUSTOM_EVENT_NAME = /^[a-z0-9_-]{1,64}$/;

function validCustomName(name: string): string {
  if (!CUSTOM_EVENT_NAME.test(name)) {
    throw new TypeError(`relay: openai custom event name ${JSON.stringify(name)} must be 1 to 64 lowercase letters, digits, _ or -`);
  }

  if (STANDARD_EVENT_NAMES.has(name)) {
    throw new TypeError(`relay: openai custom event name ${JSON.stringify(name)} is a standard event's`);
  }

  return name;
}

function toMoneyData(money: OpenAiMoney | undefined): Pick<OpenAiBaseData, 'amount' | 'currency'> {
  return money ? { amount: toMinorUnits(money.value, money.currency), currency: money.currency } : {};
}

function toContentsData(
  items: readonly OpenAiContentInput[] | undefined,
  contentType: string,
  currency: string | undefined,
): Pick<OpenAiBaseData, 'contents'> {
  if (!items) return {};

  return {
    contents: items.map((item) => ({
      id: item.id,
      name: item.name,
      content_type: contentType,
      quantity: item.quantity,
      amount: toMinorUnits(item.price, currency),
      currency,
    })),
  };
}

const fractionDigits = new Map<string | undefined, number>();

/** the minor unit of the currency: 1000 for 10.00 EUR, 10 for 10 JPY, 1500 for 1.500 KWD; two decimals where unknown */
export function toMinorUnits(value: number, currency?: string | undefined): number {
  return Math.round(value * 10 ** fractionDigitsOf(currency));
}

function fractionDigitsOf(currency: string | undefined): number {
  const known = fractionDigits.get(currency);

  if (known !== undefined) {
    return known;
  }

  let digits = 2;

  if (currency) {
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      // not a currency code intl knows: two decimals, as most have
    }
  }

  fractionDigits.set(currency, digits);

  return digits;
}
