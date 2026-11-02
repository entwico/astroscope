import fs from 'node:fs';
import type { AstroIntegration, AstroIntegrationLogger } from 'astro';
import type { Plugin } from 'vite';

/** the browser half: the bus configuration as its default export, loaded on every page when the file exists */
const CLIENT_MODULE = 'src/relay/client.ts';
/** the server half: the registry of server destinations, resolved when the file exists */
const SERVER_MODULE = 'src/relay/server.ts';

const CLIENT_VIRTUAL_MODULE_ID = 'virtual:@astroscope/relay/client';
const RESOLVED_CLIENT_VIRTUAL_MODULE_ID = `\0${CLIENT_VIRTUAL_MODULE_ID}`;
/** the package's empty registry, which the site's module replaces when it exists */
const REGISTRY_MODULE_ID = '@astroscope/relay/registry';

/**
 * Resolves the halves through vite: the injected page script loads the client module when it
 * exists, and the package's empty registry gives way to the site's module when that exists, so the
 * reporter and the site share one instance. The registry carries the destinations' secrets, so the
 * client build must never pull it in.
 */
function relayVitePlugin(logger: AstroIntegrationLogger): Plugin {
  let reported = false;

  return {
    name: '@astroscope/relay',
    // before vite's own resolver, which would otherwise settle the registry import on the package's empty one
    enforce: 'pre',

    async resolveId(id, importer) {
      if (id === CLIENT_VIRTUAL_MODULE_ID) return RESOLVED_CLIENT_VIRTUAL_MODULE_ID;

      if (id !== REGISTRY_MODULE_ID) return;

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      const server = await this.resolve(`/${SERVER_MODULE}`, importer);

      return server?.id;
    },

    async load(id) {
      if (id === RESOLVED_CLIENT_VIRTUAL_MODULE_ID) {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
        const client = await this.resolve(`/${CLIENT_MODULE}`);

        if (!client) return '';

        return [
          'import { configureRelay } from \'@astroscope/relay/client\';',
          `import config from ${JSON.stringify(`/${CLIENT_MODULE}`)};`,
          'configureRelay(await config);',
        ].join('\n');
      }

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      if (id.endsWith(`/${SERVER_MODULE}`) && this.environment?.name === 'client') {
        throw new Error(`[@astroscope/relay] ${SERVER_MODULE} is server-only — the browser configures the bus in ${CLIENT_MODULE}`);
      }
    },

    async buildStart() {
      if (reported) return;

      reported = true;

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      const [client, server] = await Promise.all([this.resolve(`/${CLIENT_MODULE}`), this.resolve(`/${SERVER_MODULE}`)]);

      logger.info(
        `${client ? `browser bus from ${CLIENT_MODULE}` : 'no browser bus'}, ${server ? `server destinations from ${SERVER_MODULE}` : 'no server destinations'}`,
      );
    },
  };
}

/**
 * Astro integration for the relay. The site's `src/relay/` folder holds the halves: `client.ts`
 * configures the bus and is loaded on every page, `server.ts` registers the server destinations and is
 * what the server-side `track()` reports to. A half without its file is off. The middleware that
 * reads the consent header off every request is always added, so `relayConsent()` works regardless.
 */
export default function relayIntegration(): AstroIntegration {
  return {
    name: '@astroscope/relay',
    hooks: {
      'astro:config:setup': ({ addMiddleware, config, injectScript, logger, updateConfig }) => {
        addMiddleware({ order: 'pre', entrypoint: '@astroscope/relay/middleware' });
        // bundled into the server build, so the registry import passes through the plugin instead
        // of node's resolution of an externalized package
        updateConfig({ vite: { plugins: [relayVitePlugin(logger)], ssr: { noExternal: ['@astroscope/relay'] } } });

        // a site without a browser half ships no script for it
        if (fs.existsSync(new URL(CLIENT_MODULE, config.root))) {
          injectScript('page', `import ${JSON.stringify(CLIENT_VIRTUAL_MODULE_ID)};`);
        }
      },
    },
  };
}
