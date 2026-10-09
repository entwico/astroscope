// the component tests import `.astro` files, which plain tsc cannot resolve;
// the astro vite plugin compiles them at test time
declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;

  export default component;
}
