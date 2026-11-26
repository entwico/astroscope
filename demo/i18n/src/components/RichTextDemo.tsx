import { rich } from '@astroscope/i18n/translate';

/** rich() with MF2 markup */
export default function RichTextDemo() {
  return (
    <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 1rem', color: '#92400e' }}>Rich Text Demo</h3>

      <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.9rem' }}>
        {/* Basic link */}
        <div>
          <strong>Basic link</strong>
          <br />
          <code>{'Read our {#link}Terms{/link}'}</code>
          <br />→{' '}
          {rich('demo.rich.tos', 'Read our {#link}Terms of Service{/link}', {
            link: (children) => (
              <a href="/tos" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                {children}
              </a>
            ),
          })}
        </div>

        {/* Multiple tags */}
        <div>
          <strong>Multiple tags</strong>
          <br />
          <code>{'Read our {#tos}Terms{/tos} and {#privacy}Privacy Policy{/privacy}'}</code>
          <br />→{' '}
          {rich('demo.rich.legal', 'Read our {#tos}Terms{/tos} and {#privacy}Privacy Policy{/privacy}', {
            tos: (children) => (
              <a href="/tos" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                {children}
              </a>
            ),
            privacy: (children) => (
              <a href="/privacy" style={{ color: '#7c3aed', textDecoration: 'underline' }}>
                {children}
              </a>
            ),
          })}
        </div>

        {/* With variables */}
        <div>
          <strong>With MF2 variables</strong>
          <br />
          <code>{'Hello {$name}, check your {#inbox}messages{/inbox}'}</code>
          <br />→{' '}
          {rich(
            'demo.rich.greeting',
            'Hello {$name}, check your {#inbox}messages{/inbox}',
            {
              inbox: (children) => (
                <a href="/inbox" style={{ color: '#2563eb', textDecoration: 'underline' }}>
                  {children}
                </a>
              ),
            },
            { name: 'Alice' },
          )}
        </div>

        {/* Nested tags */}
        <div>
          <strong>Nested tags</strong>
          <br />
          <code>{'This is {#bold}very {#em}important{/em}{/bold}'}</code>
          <br />→{' '}
          {rich('demo.rich.nested', 'This is {#bold}very {#em}important{/em}{/bold}', {
            bold: (children) => <strong>{children}</strong>,
            em: (children) => <em style={{ color: '#dc2626' }}>{children}</em>,
          })}
        </div>

        {/* Standalone (self-closing) tags */}
        <div>
          <strong>Standalone tags</strong>
          <br />
          <code>{'Click {#icon/} to download'}</code>
          <br />→{' '}
          {rich('demo.rich.standalone', 'Click {#icon/} to download', {
            icon: () => <span style={{ fontSize: '1.2em' }}>⬇️</span>,
          })}
        </div>

        {/* Complex example with formatting */}
        <div>
          <strong>Combined with formatters</strong>
          <br />
          <code>{'You have {$count :number} items totaling {#bold}{$total}{/bold}'}</code>
          <br />→{' '}
          {rich(
            'demo.rich.complex',
            'You have {$count :number} items totaling {#bold}{$total}{/bold}',
            {
              bold: (children) => <strong style={{ color: '#059669' }}>{children}</strong>,
            },
            { count: 42, total: '$1,234.56' },
          )}
        </div>

        {/* Missing component fallback */}
        <div>
          <strong>Missing component (passthrough)</strong>
          <br />
          <code>{'Text with {#unknown}missing component{/unknown}'}</code>
          <br />→{' '}
          {/* eslint-disable-next-line @astroscope/i18n/rich-message-components -- shows how a tag without a component renders */}
          {rich('demo.rich.missing', 'Text with {#unknown}missing component{/unknown}', {
            // no 'unknown' component provided - children are rendered without wrapper
          })}
        </div>
      </div>

      <p style={{ margin: '1rem 0 0', fontSize: '0.85rem', color: '#92400e' }}>
        The <code>rich()</code> function works identically in Astro templates and React islands.
      </p>
    </div>
  );
}
