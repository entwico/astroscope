export interface BootContext {
  /** Whether running in development mode (vite dev server) */
  dev: boolean;
  /** Server host from Astro config */
  host: string;
  /** Server port from Astro config */
  port: number;
}
