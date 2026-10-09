/**
 * Circular dependency test: B imports A, A imports B
 */
import { t } from '@astroscope/i18n/translate';
import CircularA from './CircularA.js';

export default function CircularB({ showA = true }: { readonly showA?: boolean }) {
  return (
    <div style={{ padding: '1rem', border: '2px solid #ec4899', borderRadius: '8px', marginTop: '0.5rem' }}>
      <h4>{t('circular.b.title', 'Component B')}</h4>
      <p>{t('circular.b.description', 'This component imports A')}</p>
      {showA && <CircularA showB={false} />}
    </div>
  );
}
