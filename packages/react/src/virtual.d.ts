declare module 'astro:react:opts' {
  import type { FilterPattern } from 'vite';

  // written by @astrojs/react's options plugin; the shape is its `VirtualModuleOptions`
  const opts: {
    include?: FilterPattern;
    exclude?: FilterPattern;
    experimentalReactChildren?: boolean;
    experimentalDisableStreaming?: boolean;
  };
  export default opts;
}
