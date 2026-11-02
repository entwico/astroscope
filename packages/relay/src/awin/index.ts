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

/** The awin builders: the sale an event definition puts under `awin`. */
export const awin = {
  sale: ({ amount, orderRef, currency, voucher, parts }: AwinSaleParams): AwinSale => ({
    amount: amount.toFixed(2),
    orderRef,
    parts: Object.entries(parts ?? { DEFAULT: amount })
      .map(([group, value]) => `${group}:${value.toFixed(2)}`)
      .join('|'),
    currency,
    voucher: voucher ?? '',
  }),
};

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
