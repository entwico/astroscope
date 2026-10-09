import type { CapWidget as CapWidgetElement } from 'cap-widget';
import React, { type CSSProperties, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAP_API_ENDPOINT, type CapSession, createCapSession, registerCapWidget } from '../client/index.js';
import { CAP_FIELD_NAME } from '../shared.js';

export { CAP_FIELD_NAME } from '../shared.js';
export type { CapSession } from '../client/index.js';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the react JSX augmentation point is a namespace
  namespace JSX {
    interface IntrinsicElements {
      'cap-widget': React.DetailedHTMLProps<React.HTMLAttributes<CapWidgetElement>, CapWidgetElement>;
    }
  }
}

export type UseCapOptions = {
  /** solve on the first interaction (`prepare` on a field's focus) instead of only on submit; default true */
  eager?: boolean | undefined;
};

/**
 * The invisible captcha of one form: put `onFocus={cap.prepare}` on the first field so solving
 * starts while the visitor types, and send `await cap.ensure()` as `_cap` with the protected
 * request — `null` means solving failed and the request would be rejected.
 */
export function useCap(options: UseCapOptions = {}): CapSession {
  const eager = options.eager ?? true;

  const [session] = useState(() => {
    const created = createCapSession();

    return eager ? created : { ...created, prepare: () => {} };
  });

  return session;
}

export type CapWidgetHandle = {
  /** the solved token for the `_cap` field, `null` until the visitor verified or after a reset */
  token: string | null;
  /** back to unsolved: call it after a submit, a verified token is consumed server-side */
  reset: () => void;
  /** @internal */
  ref: RefObject<CapWidgetElement | null>;
  /** @internal */
  setToken: (token: string | null) => void;
};

/** the state of one visible `<CapWidget>`: render the component with the handle, submit `handle.token` */
export function useCapWidget(): CapWidgetHandle {
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<CapWidgetElement>(null);
  const reset = useCallback(() => ref.current?.reset(), []);

  return useMemo(() => ({ token, reset, ref, setToken }), [token, reset]);
}

/** the widget's texts, by the `data-cap-i18n-*` attribute they fill (camelCase) */
export type CapWidgetLabels = Partial<
  Record<
    | 'initialState'
    | 'verifyingLabel'
    | 'solvedLabel'
    | 'errorLabel'
    | 'verifyAriaLabel'
    | 'verifyingAriaLabel'
    | 'verifiedAriaLabel'
    | 'errorAriaLabel'
    | 'wasmDisabled'
    | 'requiredLabel',
    string
  >
>;

export type CapWidgetProps = {
  cap: CapWidgetHandle;
  labels?: CapWidgetLabels | undefined;
  /** widget language, else the browser's */
  lang?: string | undefined;
  /** take part in the form's native validation: unsolved blocks the submit */
  required?: boolean | undefined;
  workers?: number | undefined;
  troubleshootingUrl?: string | undefined;
  className?: string | undefined;
  /** `--cap-*` custom properties theme the widget through its shadow root */
  style?: CSSProperties | undefined;
};

/**
 * The visible checkbox widget. It writes the solved token into the handle and into a hidden `_cap`
 * field, so a plain form post carries it too; the element renders empty until the cap client has
 * loaded, so reserve its height (58px) in the layout.
 */
export function CapWidget({
  cap,
  labels,
  lang,
  required,
  workers,
  troubleshootingUrl,
  className,
  style,
}: CapWidgetProps) {
  const { ref, setToken } = cap;

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    // the vendor credits link ships without rel; the widget's tamper watchdog enforces href, text
    // and visibility but leaves rel alone, so no referrer leaves the page on a click
    void registerCapWidget().then(() => {
      element.shadowRoot?.querySelector('.credits')?.setAttribute('rel', 'nofollow noopener noreferrer');
    });

    const solved = (event: Event) => setToken((event as CustomEvent<{ token: string }>).detail.token);
    const cleared = () => setToken(null);

    element.addEventListener('solve', solved);
    element.addEventListener('reset', cleared);
    element.addEventListener('error', cleared);

    return () => {
      element.removeEventListener('solve', solved);
      element.removeEventListener('reset', cleared);
      element.removeEventListener('error', cleared);
    };
  }, [ref, setToken]);

  return (
    <cap-widget
      ref={ref}
      className={className}
      style={style}
      data-cap-api-endpoint={CAP_API_ENDPOINT}
      data-cap-hidden-field-name={CAP_FIELD_NAME}
      data-cap-lang={lang}
      data-cap-worker-count={workers}
      data-cap-troubleshooting-url={troubleshootingUrl}
      {...(required ? { required: true } : {})}
      {...labelAttributes(labels)}
    />
  );
}

function labelAttributes(labels: CapWidgetLabels | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const [key, value] of Object.entries(labels ?? {})) {
    if (value !== undefined) {
      attributes[`data-cap-i18n-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`] = value;
    }
  }

  return attributes;
}
