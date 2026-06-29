// Prisma client singleton
// Prevents multiple instances during hot reload in dev (Bun --watch)
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Re-export all Prisma types/enums
export * from '@prisma/client';

// Re-export commonly used enums for type safety
export {
  UserRole,
  AddressType,
  ProductStatus,
  QuotationStatus,
  DealStatus,
  ActivityType,
} from '@prisma/client';

// P2 multi-currency (2026-06-29): single source of truth for currency
// config reads + HKD rate computation. See ./currency.ts for rationale.
// 2026-06-30: also re-export `mopRateFor` for the MOP-equivalent
// snapshot pattern (mirror of `hkdRateFor`).
export {
  getCurrencyConfig,
  hkdRateFor,
  mopRateFor,
  resolveCurrencySnapshot,
  type CurrencyCode,
  type CurrencyConfig,
} from './currency';
