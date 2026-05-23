import cuid from "cuid";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export async function getDriverWallet(driverId: string) {
  const transactions = await prisma.walletTransaction.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const balance = transactions
    .filter((tx) => tx.status === "posted")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const pendingPayout = Math.abs(
    transactions
      .filter((tx) => tx.type === "debit" && tx.status === "pending")
      .reduce((sum, tx) => sum + tx.amount, 0),
  );
  return {
    balance,
    pendingPayout,
    currency: "KES",
    transactions: transactions.map(toWalletTransactionDto),
  };
}

export async function cashout(driverId: string, input: { amount: number; method: string; phone: string }) {
  const wallet = await getDriverWallet(driverId);
  if (input.amount > wallet.balance) throw new AppError("INSUFFICIENT_FUNDS", 409, "Insufficient wallet balance.");
  const transaction = await prisma.walletTransaction.create({
    data: {
      id: `tx_${cuid()}`,
      driverId,
      type: "debit",
      label: `Cashout · ${input.method}`,
      amount: -input.amount,
      status: "pending",
      metadata: { method: input.method, phone: input.phone },
    },
  });
  return { transaction: toWalletTransactionDto(transaction) };
}

export function toWalletTransactionDto(tx: {
  id: string;
  label: string;
  amount: number;
  createdAt: Date;
  type: string;
  status: string;
  currency: string;
}) {
  return {
    id: tx.id,
    label: tx.label,
    amount: tx.amount,
    time: tx.createdAt.toISOString(),
    type: tx.type,
    status: tx.status,
    currency: tx.currency,
  };
}

