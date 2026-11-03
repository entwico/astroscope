import type { Destination } from '../client/bus.js';

/** the sale as the mastertag declares it under `AWIN.Tracking.Sale` */
export type AwinSale = {
  /** the order total with two decimals */
  amount: string;
  orderRef: string;
  /** the commission groups and their amounts: `GROUP:amount|GROUP:amount` */
  parts: string;
  currency: string;
  /** the voucher code used, or empty */
  voucher: string;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    awin: AwinSale;
  }
}

export type AwinSaleParams = {
  /** the order total */
  amount: number;
  orderRef: string;
  currency: string;
  voucher?: string | undefined;
  /** the amount per commission group; default: the whole amount under `DEFAULT` */
  parts?: Readonly<Record<string, number>> | undefined;
};

/** a commission group code as awin defines them; `:` and `|` would reshape the parts string */
const GROUP_CODE = /^[A-Za-z0-9_-]+$/;

/**
 * The awin builders: the sale an event definition puts under `awin`. Throws for a commission group
 * code outside awin's format or an amount that is not a finite number, since both would corrupt
 * the sale instead of failing it.
 */
export const awin = {
  sale: ({ amount, orderRef, currency, voucher, parts }: AwinSaleParams): AwinSale => ({
    amount: formatAmount(amount, 'amount'),
    orderRef,
    parts: Object.entries(parts ?? { DEFAULT: amount })
      .map(([group, value]) => `${validGroup(group)}:${formatAmount(value, `parts.${group}`)}`)
      .join('|'),
    currency,
    voucher: voucher ?? '',
  }),
};

function validGroup(group: string): string {
  if (!GROUP_CODE.test(group)) {
    throw new TypeError(`relay: awin commission group ${JSON.stringify(group)} is not a group code (letters, digits, _ and -)`);
  }

  return group;
}

function formatAmount(value: number, what: string): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`relay: awin ${what} must be a finite number, got ${String(value)}`);
  }

  return value.toFixed(2);
}

type DeclaredSale = AwinSale & {
  channel: 'aw';
  test: '0' | '1';
};

declare global {
  interface Window {
    AWIN?: {
      Tracking?: {
        Sale?: DeclaredSale;
        run?: () => void;
      };
    };
  }
}

export type AwinMastertagOptions = {
  advertiserId: string;
  /** declare and fire the sales as test sales; default false */
  testMode?: boolean | undefined;
};

/**
 * The awin mastertag as a destination: the sale is declared under `AWIN.Tracking.Sale` for the
 * mastertag (loaded by the cmp after consent, it parses the declaration when it loads, or is told
 * to run when it is there already) and the fall-back pixel is fired right away.
 */
export function awinMastertag(options: AwinMastertagOptions): Destination<'awin'> {
  const { advertiserId, testMode = false } = options;

  return {
    name: 'awin',
    send: (sale) => {
      const declared: DeclaredSale = { ...sale, channel: 'aw', test: testMode ? '1' : '0' };

      declareSale(declared);
      fireFallbackPixel(advertiserId, declared);
    },
  };
}

function declareSale(sale: DeclaredSale): void {
  globalThis.window.AWIN ??= {};
  globalThis.window.AWIN.Tracking ??= {};
  globalThis.window.AWIN.Tracking.Sale = sale;

  globalThis.window.AWIN.Tracking.run?.();
}

function fireFallbackPixel(advertiserId: string, sale: DeclaredSale): void {
  const params = new URLSearchParams({
    tt: 'ns',
    tv: '2',
    merchant: advertiserId,
    amount: sale.amount,
    ch: sale.channel,
    parts: sale.parts,
    ref: sale.orderRef,
    cr: sale.currency,
    vc: sale.voucher,
    testmode: sale.test,
  });

  const pixel = new Image(0, 0);

  pixel.src = `https://www.awin1.com/sread.img?${params.toString()}`;
}
