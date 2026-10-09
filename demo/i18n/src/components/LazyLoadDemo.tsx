import { t } from '@astroscope/i18n/translate';
import { Suspense, lazy, useState } from 'react';

const StatsModal = lazy(() => import('./StatsModal'));

export default function LazyLoadDemo() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
      <h3>{t('lazy.title', 'Lazy Loading Demo')}</h3>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
        {t(
          'lazy.description',
          'Click the button to lazy-load a modal component. Both the JS bundle and translations load in parallel.',
        )}
      </p>

      <button
        onClick={() => setShowModal(true)}
        style={{
          padding: '0.75rem 1.5rem',
          background: '#8b5cf6',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '1rem',
        }}
      >
        {t('lazy.open_stats', 'View My Stats')}
      </button>

      {showModal && (
        <Suspense
          fallback={(
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ color: 'white', fontSize: '1.5rem' }}>{t('lazy.loading', 'Loading...')}</div>
            </div>
          )}
        >
          <StatsModal onClose={() => setShowModal(false)} />
        </Suspense>
      )}
    </div>
  );
}
