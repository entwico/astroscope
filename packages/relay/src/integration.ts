import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration, AstroIntegrationLogger } from 'astro';
import type { Plugin } from 'vite';
import { RELAY_QUEUE_SCRIPT } from './inline.js';

// both halves live under the site's `srcDir`
/** the browser half: the bus configuration as its default export, loaded on every page when the file exists */
const CLIENT_MODULE = 'relay/client.ts';
/** the server half: the registry of server destinations, resolved when the file exists */
const SERVER_MODULE = 'relay/server.ts';

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
function relayVitePlugin(logger: AstroIntegrationLogger, modules: RelayModules): Plugin {
  let reported = false;

  return {
    name: '@astroscope/relay',
    // before vite's own resolver, which would otherwise settle the registry import on the package's empty one
    enforce: 'pre',

    async resolveId(id, importer) {
      if (id === CLIENT_VIRTUAL_MODULE_ID) return RESOLVED_CLIENT_VIRTUAL_MODULE_ID;

      if (id !== REGISTRY_MODULE_ID) return;

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      const server = await this.resolve(modules.server, importer);

      return server?.id;
    },

    async load(id) {
      if (id === RESOLVED_CLIENT_VIRTUAL_MODULE_ID) {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
        const client = await this.resolve(modules.client);

        if (!client) return '';

        return [
          'import { configureRelay } from \'@astroscope/relay/client\';',
          `import config from ${JSON.stringify(modules.client)};`,
          'configureRelay(await config);',
        ].join('\n');
      }

      // the query (`?raw`, `?url`, dev's `?t=`) is not part of the file
      const [path = ''] = id.split('?', 2);

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      if (path.endsWith(modules.server) && this.environment?.name === 'client') {
        throw new Error(`[@astroscope/relay] ${modules.server} is server-only — the browser configures the bus in ${modules.client}`);
      }
    },

    async buildStart() {
      if (reported) return;

      reported = true;

      // eslint-disable-next-line unicorn/no-this-outside-of-class -- `this` is the vite plugin context api
      const [client, server] = await Promise.all([this.resolve(modules.client), this.resolve(modules.server)]);

      logger.info(
        `${client ? `browser bus from ${modules.client}` : 'no browser bus'}, ${server ? `server destinations from ${modules.server}` : 'no server destinations'}`,
      );
    },
  };
}

/** the halves as root-relative vite ids: `/src/relay/client.ts` for the default `srcDir` */
type RelayModules = { client: string; server: string };

function relayModules(root: URL, srcDir: URL): RelayModules {
  const srcPath = path.relative(fileURLToPath(root), fileURLToPath(srcDir)).split(path.sep).join('/');
  const prefix = srcPath ? `/${srcPath}/` : '/';

  return { client: `${prefix}${CLIENT_MODULE}`, server: `${prefix}${SERVER_MODULE}` };
}

/**
 * Astro integration for the relay. The site's `relay/` folder under `srcDir` holds the halves: `client.ts`
 * configures the bus and is loaded on every page, `server.ts` registers the server destinations and is
 * what the server-side `track()` reports to. A half without its file is off. The middleware that
 * reads the consent header off every request is always added, so `relayConsent()` works regardless.
 */
export default function relayIntegration(): AstroIntegration {
  return {
    name: '@astroscope/relay',
    hooks: {
      'astro:config:setup': ({ addMiddleware, config, injectScript, logger, updateConfig }) => {
        const modules = relayModules(config.root, config.srcDir);

        addMiddleware({ order: 'pre', entrypoint: '@astroscope/relay/middleware' });
        // bundled into the server build, so the registry import passes through the plugin instead
        // of node's resolution of an externalized package
        updateConfig({ vite: { plugins: [relayVitePlugin(logger, modules)], ssr: { noExternal: ['@astroscope/relay'] } } });

        // a site without a browser half ships no script for it; the queue goes ahead of everything
        // in the head, so an `onclick` or a `<Track>` works before the module loaded
        if (!fs.existsSync(new URL(CLIENT_MODULE, config.srcDir))) {
          return;
        }

        injectScript('head-inline', RELAY_QUEUE_SCRIPT);
        injectScript('page', `import ${JSON.stringify(CLIENT_VIRTUAL_MODULE_ID)};`);
      },
    },
  };
}
