import { t } from '@astroscope/i18n/translate';

/**
 * Demo component showcasing all MF2 formatters.
 *
 * Default functions (always available):
 * - :number - locale-aware number formatting
 * - :integer - integer formatting (no decimals)
 * - :string - string formatting
 *
 * Draft functions (enabled via DraftFunctions):
 * - :currency - currency formatting (requires currency option or wrapped value)
 * - :date - date formatting
 * - :time - time formatting
 * - :datetime - combined date+time formatting
 * - :percent - percentage formatting
 * - :unit - unit formatting (e.g., kilometers, kilograms)
 */
export default function FormattersDemo() {
  // use fixed date to avoid hydration mismatch between SSR and client
  const now = new Date('2026-01-15T14:30:00Z');
  const amount = 1234.56;
  const count = 42;
  const ratio = 0.856;

  return (
    <div style={{ padding: '1rem', background: '#f0f9ff', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 1rem', color: '#0369a1' }}>MF2 Formatters Demo</h3>

      <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.9rem' }}>
        {/* Number formatting */}
        <div>
          <strong>:number</strong> (locale-aware)
          <br />
          <code>{amount}</code> → {t('demo.number', '{$value :number}', { value: amount })}
        </div>

        <div>
          <strong>:number</strong> with options
          <br />
          <code>{amount}</code> →{' '}
          {t('demo.number_options', '{$value :number minimumFractionDigits=2 maximumFractionDigits=2}', {
            value: amount,
          })}
        </div>

        {/* Integer formatting */}
        <div>
          <strong>:integer</strong> (no decimals)
          <br />
          <code>{amount}</code> → {t('demo.integer', '{$value :integer}', { value: amount })}
        </div>

        {/* Percent formatting */}
        <div>
          <strong>:percent</strong>
          <br />
          <code>{ratio}</code> → {t('demo.percent', '{$value :percent}', { value: ratio })}
        </div>

        {/* Currency formatting - value with options object */}
        <div>
          <strong>:currency</strong> (via wrapped value)
          <br />
          <code>{amount}</code> →{' '}
          {t('demo.currency', '{$price :currency}', {
            price: { valueOf: () => amount, options: { currency: 'EUR' } },
          })}
        </div>

        <div>
          <strong>:currency</strong> (USD)
          <br />
          <code>{amount}</code> →{' '}
          {t('demo.currency_usd', '{$price :currency}', {
            price: { valueOf: () => amount, options: { currency: 'USD' } },
          })}
        </div>

        {/* Unit formatting */}
        <div>
          <strong>:unit</strong> (kilometers)
          <br />
          <code>{count}</code> → {t('demo.unit_km', '{$value :unit unit=kilometer}', { value: count })}
        </div>

        <div>
          <strong>:unit</strong> (kilograms)
          <br />
          <code>{count}</code> → {t('demo.unit_kg', '{$value :unit unit=kilogram}', { value: count })}
        </div>

        {/* Date formatting */}
        <div>
          <strong>:date</strong> (short)
          <br />
          <code>{now.toISOString()}</code>
          <br />→ {t('demo.date_short', '{$d :date style=short}', { d: now })}
        </div>

        <div>
          <strong>:date</strong> (long)
          <br />→ {t('demo.date_long', '{$d :date style=long}', { d: now })}
        </div>

        {/* Time formatting */}
        <div>
          <strong>:time</strong> (short)
          <br />→ {t('demo.time_short', '{$d :time style=short}', { d: now })}
        </div>

        <div>
          <strong>:time</strong> (medium)
          <br />→ {t('demo.time_medium', '{$d :time style=medium}', { d: now })}
        </div>

        {/* DateTime formatting */}
        <div>
          <strong>:datetime</strong> (combined)
          <br />→ {t('demo.datetime', '{$d :datetime dateStyle=medium timeStyle=short}', { d: now })}
        </div>

        {/* String formatting */}
        <div>
          <strong>:string</strong> (explicit string coercion)
          <br />
          <code>123</code> → {t('demo.string', 'Value is {$value :string}', { value: 123 })}
        </div>

        {/* Local variables */}
        <div>
          <strong>.local</strong> (computed local variable)
          <br />
          <code>{ratio}</code> →{' '}
          {t('demo.local_var', '.local $pct = {$value :percent}\n{{Percentage: {$pct}}}', { value: ratio })}
        </div>

        <div>
          <strong>.local</strong> with chaining
          <br />
          <code>{amount}</code> →{' '}
          {t(
            'demo.local_chain',
            '.local $rounded = {$value :integer}\n.local $formatted = {$rounded :number}\n{{Rounded then formatted: {$formatted}}}',
            { value: amount },
          )}
        </div>

        {/* Escaping */}
        <div>
          <strong>
            {'{{'}...{'}}'}
          </strong>{' '}
          (escaping literal braces)
          <br />
          {/* eslint-disable-next-line unicorn/prefer-string-raw -- the i18n extractor reads only plain string literals */}
          {t('demo.escape_braces', 'Code example: \\{\\{$name\\}\\} outputs {$name}', { name: 'value' })}
        </div>

        <div>
          <strong>Escaped in pattern</strong>
          <br />
          {/* eslint-disable-next-line unicorn/prefer-string-raw -- the i18n extractor reads only plain string literals */}
          {t('demo.escape_pattern', 'Use \\| for OR in regex: a\\|b')}
        </div>
      </div>

      <p style={{ margin: '1rem 0 0', fontSize: '0.85rem', color: '#0369a1' }}>
        Note: Currency uses a wrapped value with <code>valueOf()</code> and <code>options.currency</code> because MF2
        options must be literals.
      </p>
    </div>
  );
}
