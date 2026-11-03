export type { ConversionUser } from './conversion-user.js';
export { inlineTrack } from './inline.js';
export type { CollectOptions } from './collect.js';
export { collect } from './client/collect.js';
export type {
  AddPaymentInfoParams,
  AddShippingInfoParams,
  AddToCartParams,
  BeginCheckoutParams,
  CommerceItem,
  GenerateLeadParams,
  LoginParams,
  PurchaseParams,
  RefundParams,
  RemoveFromCartParams,
  SearchParams,
  SelectItemParams,
  SignUpParams,
  ViewCartParams,
  ViewItemListParams,
  ViewItemParams,
  WellKnownCreate,
  WellKnownName,
} from './commerce.js';
export { isCommerceEvent, wellKnownEvents } from './commerce.js';
export type {
  ConsentAnswer,
  ConsentRecord,
  ConsentSource,
  DomainEvent,
  EventDefinition,
  EventMeta,
  DestinationName,
  RelayEvent,
  RelayParams,
  RelayDestinations,
  TrackInput,
} from './shared.js';
export { defineEvent } from './shared.js';

/** the integration is server-only; the browser build of the root entry never loads it */
export default function relayIntegration(): never {
  throw new Error('the @astroscope/relay integration is server-only');
}
