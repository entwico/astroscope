import { cap } from '@astroscope/cap';

// the stub service from `pnpm stub` by default; point CAP_BASE_URL at a real cap standalone
// (with its own site key and secret) to see the proof of work verified for real
export function onStartup(): void {
  cap.configure({
    baseUrl: process.env['CAP_BASE_URL'] ?? 'http://localhost:14363',
    siteKey: process.env['CAP_SITE_KEY'] ?? 'demo',
    secretKey: process.env['CAP_SECRET_KEY'] ?? 'demo-secret',
  });
}
