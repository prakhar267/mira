import type { StoreItemRecord, WalletState, WalletTransactionRecord } from "@companion/shared";

type SpendableCurrency = "coins" | "gems";

export class WalletLedger {
  private wallet: WalletState;
  private readonly transactions: WalletTransactionRecord[] = [];

  constructor(private readonly userId: string, initial: WalletState) {
    this.wallet = { ...initial };
  }

  snapshot(): WalletState {
    return { ...this.wallet };
  }

  history(): WalletTransactionRecord[] {
    return this.transactions.map((transaction) => ({ ...transaction }));
  }

  earn(input: { currency: "coins" | "gems" | "xp"; amount: number; referenceId: string; idempotencyKey: string; now?: Date }): WalletState {
    if (input.amount <= 0) throw new Error("Amount must be positive");
    if (this.transactions.some((transaction) => transaction.idempotencyKey === input.idempotencyKey)) return this.snapshot();
    const nextBalance = this.balance(input.currency) + input.amount;
    this.setBalance(input.currency, nextBalance);
    this.record("earn", input.currency, input.amount, nextBalance, input.referenceId, input.idempotencyKey, input.now);
    return this.snapshot();
  }

  purchase(item: StoreItemRecord, idempotencyKey: string, now = new Date()): WalletState {
    if (this.transactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) return this.snapshot();
    if (item.currency === "free") return this.snapshot();
    const currency: SpendableCurrency = item.currency;
    const current = this.balance(currency);
    if (current < item.price) throw new Error("Insufficient balance");
    const nextBalance = current - item.price;
    this.setBalance(currency, nextBalance);
    this.record("purchase", currency, -item.price, nextBalance, item.id, idempotencyKey, now);
    return this.snapshot();
  }

  refund(transactionId: string, idempotencyKey: string, now = new Date()): WalletState {
    if (this.transactions.some((transaction) => transaction.idempotencyKey === idempotencyKey)) return this.snapshot();
    const purchase = this.transactions.find((transaction) => transaction.id === transactionId && transaction.type === "purchase");
    if (!purchase || purchase.currency === "xp") throw new Error("Purchase not found");
    if (this.transactions.some((transaction) => transaction.type === "refund" && transaction.referenceId === transactionId)) throw new Error("Already refunded");
    const amount = Math.abs(purchase.amount);
    const nextBalance = this.balance(purchase.currency) + amount;
    this.setBalance(purchase.currency, nextBalance);
    this.record("refund", purchase.currency, amount, nextBalance, transactionId, idempotencyKey, now);
    return this.snapshot();
  }

  private balance(currency: WalletTransactionRecord["currency"]): number {
    return this.wallet[currency];
  }

  private setBalance(currency: WalletTransactionRecord["currency"], value: number) {
    this.wallet = { ...this.wallet, [currency]: value };
    if (currency === "xp") this.wallet.level = Math.max(this.wallet.level, Math.floor(value / 100) + 1);
  }

  private record(type: WalletTransactionRecord["type"], currency: WalletTransactionRecord["currency"], amount: number, balanceAfter: number, referenceId: string, idempotencyKey: string, now = new Date()) {
    this.transactions.push({ id: crypto.randomUUID(), userId: this.userId, type, currency, amount, balanceAfter, referenceId, idempotencyKey, createdAt: now.toISOString() });
  }
}
