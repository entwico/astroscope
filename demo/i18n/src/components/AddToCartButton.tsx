import { t } from '@astroscope/i18n/translate';
import { useState } from 'react';

export type AddToCartButtonProps = {
  readonly productName: string;
};

export default function AddToCartButton({ productName }: AddToCartButtonProps) {
  const [added, setAdded] = useState(false);

  return (
    <div>
      {added ? (
        <p style={{ color: '#0a7c42', fontSize: '0.9rem' }}>{t('addToCart.added', { fallback: 'Added to cart!' })}</p>
      ) : (
        <button
          onClick={() => setAdded(true)}
          aria-label={t('addToCart.ariaLabel', { fallback: 'Add {$product} to cart' }, { product: productName })}
          style={{
            padding: '0.5rem 1rem',
            background: '#333',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          {t('addToCart.button', { fallback: 'Add to Cart' })}
        </button>
      )}
    </div>
  );
}
