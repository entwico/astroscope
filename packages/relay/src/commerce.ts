// the well-known events — ga4's recommended events, the catalogue every tag vendor maps from — as
// typed parameters, and a factory the ga4 and tag-manager builders are made of. No runtime imports here.

import type { RelayParams } from './shared.js';

/** an item of the commerce events */
export type CommerceItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  index?: number | undefined;
  affiliation?: string | undefined;
  coupon?: string | undefined;
  discount?: number | undefined;
  item_brand?: string | undefined;
  item_category?: string | undefined;
  item_category2?: string | undefined;
  item_category3?: string | undefined;
  item_category4?: string | undefined;
  item_category5?: string | undefined;
  item_list_id?: string | undefined;
  item_list_name?: string | undefined;
  item_variant?: string | undefined;
  location_id?: string | undefined;
  [key: string]: unknown;
};

type Items = { items: readonly CommerceItem[] };
type Money = { currency?: string | undefined; value?: number | undefined };
type Listed = { item_list_id?: string | undefined; item_list_name?: string | undefined };

/** every well-known params type takes custom parameters next to the known ones */
type Params<P> = P & RelayParams;

export type ViewItemParams = Params<Items & Money>;
export type ViewItemListParams = Params<Items & Listed>;
export type SelectItemParams = Params<Items & Listed>;
export type AddToCartParams = Params<Items & Money>;
export type RemoveFromCartParams = Params<Items & Money>;
export type ViewCartParams = Params<Items & Money>;
export type BeginCheckoutParams = Params<Items & Money & { coupon?: string | undefined }>;
export type AddShippingInfoParams = Params<
  Items & Money & { coupon?: string | undefined; shipping_tier?: string | undefined }
>;
export type AddPaymentInfoParams = Params<
  Items & Money & { coupon?: string | undefined; payment_type?: string | undefined }
>;
export type PurchaseParams = Params<
  Items & {
    transaction_id: string;
    value: number;
    currency: string;
    tax?: number | undefined;
    shipping?: number | undefined;
    coupon?: string | undefined;
  }
>;
export type RefundParams = Params<
  Money & {
    transaction_id: string;
    tax?: number | undefined;
    shipping?: number | undefined;
    items?: readonly CommerceItem[] | undefined;
  }
>;
export type SearchParams = Params<{ search_term: string }>;
export type SignUpParams = Params<{ method?: string | undefined }>;
export type LoginParams = Params<{ method?: string | undefined }>;
export type GenerateLeadParams = Params<Money>;

export type WellKnownName =
  | 'view_item'
  | 'view_item_list'
  | 'select_item'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'add_shipping_info'
  | 'add_payment_info'
  | 'purchase'
  | 'refund'
  | 'search'
  | 'sign_up'
  | 'login'
  | 'generate_lead';

const COMMERCE_NAMES: ReadonlySet<string> = new Set([
  'view_item',
  'view_item_list',
  'select_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'refund',
]);

/** whether a well-known event is a commerce one, whose parameters a container reads under `ecommerce` */
export function isCommerceEvent(name: string): boolean {
  return COMMERCE_NAMES.has(name);
}

/** what a builder set is made of: the event's name and parameters in, the destination's payload out */
export type WellKnownCreate<R> = (name: WellKnownName, params: RelayParams, extra: RelayParams | undefined) => R;

/**
 * The well-known events as builders over `create`: one function per event, typed by its
 * parameters, taking the destination's extra parameters second. The ga4 and tag-manager builders are
 * made of it; a site's own destination that speaks ga4's names can be too.
 */
export function wellKnownEvents<R>(create: WellKnownCreate<R>) {
  const builder =
    <P extends RelayParams>(name: WellKnownName) =>
      (params: P, extra?: RelayParams): R =>
        create(name, params, extra);

  return {
    viewItem: builder<ViewItemParams>('view_item'),
    viewItemList: builder<ViewItemListParams>('view_item_list'),
    selectItem: builder<SelectItemParams>('select_item'),
    addToCart: builder<AddToCartParams>('add_to_cart'),
    removeFromCart: builder<RemoveFromCartParams>('remove_from_cart'),
    viewCart: builder<ViewCartParams>('view_cart'),
    beginCheckout: builder<BeginCheckoutParams>('begin_checkout'),
    addShippingInfo: builder<AddShippingInfoParams>('add_shipping_info'),
    addPaymentInfo: builder<AddPaymentInfoParams>('add_payment_info'),
    purchase: builder<PurchaseParams>('purchase'),
    refund: builder<RefundParams>('refund'),
    search: builder<SearchParams>('search'),
    signUp: builder<SignUpParams>('sign_up'),
    login: builder<LoginParams>('login'),
    generateLead: builder<GenerateLeadParams>('generate_lead'),
  };
}
