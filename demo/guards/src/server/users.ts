export type User = {
  name: string;
  roles: { admin: boolean };
};

// the demo's user directory: alice is a plain user, root an admin
const USERS: Record<string, User> = {
  alice: { name: 'alice', roles: { admin: false } },
  root: { name: 'root', roles: { admin: true } },
};

export function findUser(name: string): User | undefined {
  return USERS[name];
}

export const USER_NAMES = Object.keys(USERS);
