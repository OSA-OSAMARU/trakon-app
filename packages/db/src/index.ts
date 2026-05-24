// =============================================================================
// TRAKON Prisma client
// -----------------------------------------------------------------------------
// Sub-Phase 0.0 ではモデル未定義 (`prisma generate` が走らない) のため、
// PrismaClient の実体は読み込まない。Sub-Phase 0.1 で users / audit_logs を
// 追加する際に下記のシングルトン実装を有効化する。
//
// 有効化例:
//   import { PrismaClient } from '@prisma/client';
//   declare global { var __trakonPrisma: PrismaClient | undefined }
//   export const prisma =
//     globalThis.__trakonPrisma ?? new PrismaClient({ log: ['warn', 'error'] });
//   if (process.env.NODE_ENV !== 'production') globalThis.__trakonPrisma = prisma;
// =============================================================================

export const DB_PACKAGE_PLACEHOLDER = '@trakon/db ready (Prisma client wired up in Sub-Phase 0.1)';
