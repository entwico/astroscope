import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { preferSsrGuard } from './prefer-ssr-guard.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});

const filename = 'test.tsx';

const err = (global: string, replacement: string) => ({
  messageId: 'preferSsrGuard' as const,
  data: { global, replacement },
});

tester.run('prefer-ssr-guard', preferSsrGuard, {
  valid: [
    // already using import.meta.env.SSR — nothing to do
    {
      filename,
      code: `if (import.meta.env.SSR) { /* server */ }`,
    },
    {
      filename,
      code: `if (!import.meta.env.SSR) { window.scrollTo(0, 0); }`,
    },
    // typeof on a non-browser identifier — leave alone
    {
      filename,
      code: `const x = typeof foo !== 'undefined' ? foo : null;`,
    },
    // typeof window compared to something other than 'undefined' — not the SSR-guard idiom
    {
      filename,
      code: `if (typeof window === 'object') { /* whatever */ }`,
    },
    // typeof of a member expression — not the simple Identifier shape we target
    {
      filename,
      code: `if (typeof globalThis.window !== 'undefined') { /* ok */ }`,
    },
    // typeof <Global> without a comparison — boolean coerced via !! or used as value
    {
      filename,
      code: `const t = typeof window;`,
    },
    // not an equality operator (>= / etc.) — sanity check
    {
      filename,
      code: `if (typeof window >= 'undefined') { /* nonsense, but not our rule */ }`,
    },
  ],

  invalid: [
    // canonical case — strict inequality means "we're in the browser"
    {
      filename,
      code: `if (typeof window !== 'undefined') { window.scrollTo(0, 0); }`,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { window.scrollTo(0, 0); }`,
    },
    // strict equality means "we're on the server"
    {
      filename,
      code: `if (typeof window === 'undefined') { /* server-only */ }`,
      errors: [err('window', 'import.meta.env.SSR')],
      output: `if (import.meta.env.SSR) { /* server-only */ }`,
    },
    // loose operators — same intent, different operator
    {
      filename,
      code: `const isBrowser = typeof window != 'undefined';`,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `const isBrowser = !import.meta.env.SSR;`,
    },
    {
      filename,
      code: `const isServer = typeof window == 'undefined';`,
      errors: [err('window', 'import.meta.env.SSR')],
      output: `const isServer = import.meta.env.SSR;`,
    },
    // yoda — literal on the left
    {
      filename,
      code: `if ('undefined' !== typeof window) { /* browser */ }`,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { /* browser */ }`,
    },
    // double-quoted literal
    {
      filename,
      code: `if (typeof window !== "undefined") { /* browser */ }`,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { /* browser */ }`,
    },
    // document — same idiom, different global
    {
      filename,
      code: `if (typeof document !== 'undefined') { document.title = 'x'; }`,
      errors: [err('document', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { document.title = 'x'; }`,
    },
    // localStorage — common SSR-unsafe API
    {
      filename,
      code: `const v = typeof localStorage !== 'undefined' ? localStorage.getItem('k') : null;`,
      errors: [err('localStorage', '!import.meta.env.SSR')],
      output: `const v = !import.meta.env.SSR ? localStorage.getItem('k') : null;`,
    },
    // navigator
    {
      filename,
      code: `const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';`,
      errors: [err('navigator', '!import.meta.env.SSR')],
      output: `const lang = !import.meta.env.SSR ? navigator.language : 'en';`,
    },
    // sessionStorage
    {
      filename,
      code: `if (typeof sessionStorage === 'undefined') { return null; }`,
      errors: [err('sessionStorage', 'import.meta.env.SSR')],
      output: `if (import.meta.env.SSR) { return null; }`,
    },
    // self
    {
      filename,
      code: `if (typeof self !== 'undefined') { /* worker or browser */ }`,
      errors: [err('self', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { /* worker or browser */ }`,
    },
    // inside a hook body — the original motivating case
    {
      filename,
      code: `
        function useViewportWidth() {
          const initial = typeof window !== 'undefined' ? window.innerWidth : 0;
          return initial;
        }
      `,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `
        function useViewportWidth() {
          const initial = !import.meta.env.SSR ? window.innerWidth : 0;
          return initial;
        }
      `,
    },
    // multiple occurrences in one file — each reported & fixed
    {
      filename,
      code: `
        const a = typeof window !== 'undefined';
        const b = typeof document === 'undefined';
      `,
      errors: [err('window', '!import.meta.env.SSR'), err('document', 'import.meta.env.SSR')],
      output: `
        const a = !import.meta.env.SSR;
        const b = import.meta.env.SSR;
      `,
    },
    // combined with && — replacement preserves precedence (unary ! binds tighter than &&)
    {
      filename,
      code: `if (typeof window !== 'undefined' && someFlag) { /* … */ }`,
      errors: [err('window', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR && someFlag) { /* … */ }`,
    },
    // custom globals option — extends (replaces) the default list
    {
      filename,
      code: `if (typeof crypto !== 'undefined') { /* … */ }`,
      options: [{ globals: ['crypto'] }],
      errors: [err('crypto', '!import.meta.env.SSR')],
      output: `if (!import.meta.env.SSR) { /* … */ }`,
    },
    // custom globals option — the default list is replaced, so 'window' is no longer flagged
    {
      filename,
      code: `
        if (typeof window !== 'undefined') { /* not flagged */ }
        if (typeof crypto !== 'undefined') { /* flagged */ }
      `,
      options: [{ globals: ['crypto'] }],
      errors: [err('crypto', '!import.meta.env.SSR')],
      output: `
        if (typeof window !== 'undefined') { /* not flagged */ }
        if (!import.meta.env.SSR) { /* flagged */ }
      `,
    },
  ],
});
