// the astro entry re-exports `.astro` files, which plain tsc cannot resolve; astro compiles them in the site's build
declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;

  export default component;
}
