import { t } from '@astroscope/i18n/translate';
import { useState } from 'react';

export type ProductCardProps = {
  readonly name: string;
  readonly price: string;
  readonly image: string;
};

export default function ProductCard({ name, price, image }: ProductCardProps) {
  const [added, setAdded] = useState(false);

  return (
    <div
      style={{
        padding: '1rem',
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '120px',
          background: `linear-gradient(135deg, ${image} 0%, #eee 100%)`,
          borderRadius: '4px',
          marginBottom: '1rem',
        }}
      />
      <h4 style={{ margin: '0 0 0.5rem' }}>{name}</h4>
      <p style={{ margin: '0 0 1rem', fontWeight: 'bold', color: '#0070f3' }}>{price}</p>

      {added ? (
        <p style={{ color: '#0a7c42', fontSize: '0.9rem' }}>{t('product.added', 'Added to cart!')}</p>
      ) : (
        <button
          onClick={() => setAdded(true)}
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
          {t('product.addToCart', 'Add to Cart')}
        </button>
      )}
    </div>
  );
}
