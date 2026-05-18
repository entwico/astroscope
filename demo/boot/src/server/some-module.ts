import { config } from './config';

let intervalId: ReturnType<typeof setInterval> | null = null;
let counter = 0;
let ready = false;

export async function initSomeModule() {
  await new Promise((resolve) => setTimeout(resolve, 500));

  intervalId = setInterval(() => {
    counter++;
    console.log(`[${config.moduleName}] heartbeat #${counter}`);
  }, config.heartbeatInterval);

  ready = true;

  console.log(`[${config.moduleName}] initialized with heartbeat interval (${config.heartbeatInterval}ms)`);
}

export function cleanupSomeModule() {
  ready = false;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log(`[${config.moduleName}] cleaned up (ran ${counter} heartbeats)`);
    counter = 0;
  }
}

export function getHeartbeatCount(): number {
  if (!ready) {
    throw new Error(`[${config.moduleName}] used before init or after dispose`);
  }

  return counter;
}
