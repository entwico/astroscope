import type { User } from './server/users';

declare global {
  namespace App {
    interface Locals {
      // the honest shape: a visitor may be nobody. guards make it required where they passed
      user?: User | undefined;
    }
  }
}
