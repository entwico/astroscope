import type { DocumentEmitter, IslandEmitter } from './types.js';

/**
 * Emitters registered by other packages (e.g. `@astroscope/i18n`). Keyed on
 * `globalThis` via `Symbol.for` so the vite-runner and native module instances share
 * one registry — same pattern as the log store.
 */
const ISLAND_REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

type Scope = { [ISLAND_REGISTRY]?: IslandEmitter[]; [DOCUMENT_REGISTRY]?: DocumentEmitter[] };

function islandRegistry(): IslandEmitter[] {
  const scope = globalThis as Scope;

  return (scope[ISLAND_REGISTRY] ??= []);
}

function documentRegistry(): DocumentEmitter[] {
  const scope = globalThis as Scope;

  return (scope[DOCUMENT_REGISTRY] ??= []);
}

/**
 * Register an emitter that contributes preload links and/or attributes for every
 * island the islands middleware sees. Registration is process-wide — call it once
 * during boot or module initialization, not per request.
 */
export function registerIslandEmitter(emitter: IslandEmitter): void {
  islandRegistry().push(emitter);
}

export function getIslandEmitters(): readonly IslandEmitter[] {
  return islandRegistry();
}

/**
 * Register an emitter that contributes document-level content (a head bootstrap
 * script, a stream-end script) for every html page response the islands middleware
 * streams. Registration is process-wide — call it once during boot or module
 * initialization, not per request.
 */
export function registerDocumentEmitter(emitter: DocumentEmitter): void {
  documentRegistry().push(emitter);
}

export function getDocumentEmitters(): readonly DocumentEmitter[] {
  return documentRegistry();
}
