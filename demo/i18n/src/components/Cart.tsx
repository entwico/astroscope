import { t } from '@astroscope/i18n/translate';

export type CartProps = {
  itemCount: number;
  total: string;
};

export default function Cart({ itemCount, total }: CartProps) {
  return (
    <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
      <h3>{t('cart.title', 'Shopping Cart')}</h3>

      {itemCount === 0 ? (
        <p>{t('cart.empty', 'Your cart is empty')}</p>
      ) : (
        <>
          <p>
            {t(
              'cart.items',
              {
                fallback: '.input {$count :number}\n.match $count\none {{{$count} item in cart}}\n* {{{$count} items in cart}}',
                description: 'Item count with pluralization',
                variables: {
                  count: { fallback: '3', description: 'Number of items in cart' },
                },
              },
              { count: itemCount },
            )}
          </p>
          <p>
            {t(
              'cart.total',
              {
                fallback: 'Total: {$amount}',
                description: 'Cart total price',
                variables: {
                  amount: { fallback: '$49.99', description: 'Formatted price' },
                },
              },
              { amount: total },
            )}
          </p>
          <button
            style={{
              padding: '0.5rem 1rem',
              background: '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {t('checkout.button', 'Proceed to Checkout')}
          </button>
        </>
      )}
    </div>
  );
}
