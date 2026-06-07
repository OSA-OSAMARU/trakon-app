import { PrismaClient } from './generated/client/index.js';

declare global {
  // eslint-disable-next-line no-var
  var __trakonPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__trakonPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__trakonPrisma = prisma;
}

export type { Prisma } from './generated/client/index.js';
export { PrismaClient } from './generated/client/index.js';
