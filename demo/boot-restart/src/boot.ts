import { disposeSingleton, initSingleton } from './server/singleton';

export function onStartup(): void {
  initSingleton();
}

export function onShutdown(): void {
  disposeSingleton();
}
