/**
 * The session cookie's name, and nothing else.
 *
 * It lives alone because two very different places need it: `session.ts`,
 * which is server-only and reaches the database, and `src/proxy.ts`, which
 * runs on the edge runtime where Prisma cannot go. Importing the constant
 * from `session.ts` would drag the whole data layer into the edge bundle, and
 * writing the string twice means a rename silently disables the route guard.
 * A module with no imports of its own is the only thing both can share.
 */
export const SESSION_COOKIE = 'endurance_session';
