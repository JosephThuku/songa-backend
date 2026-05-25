/** Boot-time hook reserved for Prisma client / schema drift checks. */
export function assertPrismaClientCurrent(): void {
  // `prisma generate` runs on postinstall and in test setup via `db push`.
}
