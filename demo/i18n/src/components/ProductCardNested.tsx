import { t } from '@astroscope/i18n/translate';
import AddToCartButton from './AddToCartButton';

export type ProductCardNestedProps = {
  readonly name: string;
  readonly price: string;
  readonly image: string;
};

export default function ProductCardNested({ name, price, image }: ProductCardNestedProps) {
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
      <p style={{ margin: '0 0 0.5rem', fontWeight: 'bold', color: '#0070f3' }}>{price}</p>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#666' }}>
        {t('productCard.inStock', { fallback: 'In Stock' })}
      </p>
      <AddToCartButton productName={name} />
    </div>
  );
}
