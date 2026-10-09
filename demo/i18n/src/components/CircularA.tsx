/**
 * Circular dependency test: A imports B, B imports A (static circular)
 * With hidden <CircularB client:visible /> in index.astro, Vite creates separate chunks
 * that statically import each other, testing circular detection in flattenImports
 */
import { t } from '@astroscope/i18n/translate';
import CircularB from './CircularB.js';

export default function CircularA({ showB = true }: { readonly showB?: boolean }) {
  return (
    <div style={{ padding: '1rem', border: '2px solid #6366f1', borderRadius: '8px' }}>
      <h4>{t('circular.a.title', 'Component A')}</h4>
      <p>{t('circular.a.description', 'This component imports B')}</p>
      {showB && <CircularB showA={false} />}
    </div>
  );
}
