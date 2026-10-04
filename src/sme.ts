import { SmeSession } from "./session.js";
import type { Expense, ExpenseEdit, ExpenseInput, Owed, Scope, Share } from "./types.js";

export type { Expense, Scope, Share } from "./types.js";

const EQUAL_SPLIT = 1;
const EXACT_SPLIT = 2;
const PAYMENT_SPLIT = 7;

/** SplitMyExpenses domain API on top of an authenticated session. */
export class SME {
  private session: SmeSession;
  constructor(email: string, password: string) {
    this.session = new SmeSession(email, password);
  }

  login() {
    return this.session.login();
  }

  /**
   * Equal split among `owers`; remainder cents to the first entries (API validates by array position).
   * The payer need not owe anything: if absent from `owers` they are appended with owed 0 (they must be in the expense).
   */
  static equalShares(amount: number, owers: number[], payer: number): Share[] {
    const ids = [...new Set(owers)];
    const base = Math.floor(amount / ids.length),
      rem = amount % ids.length;
    const shares = ids.map((uid, i) => {
      const owed = base + (i < rem ? 1 : 0);
      return { user_id: uid, paid: uid === payer ? amount : 0, owed, calculated_amount: owed };
    });
    if (!ids.includes(payer)) shares.push({ user_id: payer, paid: amount, owed: 0, calculated_amount: 0 });
    return shares;
  }

  /** Exact amounts owed per user (must sum to `amount`); input is the decimal string the API expects. Payer is added owing 0 if absent. */
  static exactShares(amount: number, owed: Owed[], payer: number): Share[] {
    if (owed.reduce((t, o) => t + o.amount, 0) !== amount)
      throw new Error("owed amounts must sum to the expense amount");
    const shares = owed.map((o) => ({
      user_id: o.user_id,
      input: (o.amount / 100).toFixed(2),
      paid: o.user_id === payer ? amount : 0,
      owed: o.amount,
      calculated_amount: o.amount,
    }));
    if (!owed.some((o) => o.user_id === payer))
      shares.push({ user_id: payer, input: "0.00", paid: amount, owed: 0, calculated_amount: 0 });
    return shares;
  }

  /** Settlement: `from` pays `to` (type 2, split 7: payer paid, receiver owed). */
  static payment(amount: number, from: number, to: number): Share[] {
    return [
      { user_id: to, paid: 0, owed: amount, calculated_amount: amount },
      { user_id: from, paid: amount, owed: 0, calculated_amount: 0 },
    ];
  }

  private static scopePath(s: Scope) {
    return s.group_id ? `/groups/${s.group_id}` : `/friends/${s.friend_id}`;
  }

  private static payload(e: ExpenseInput, id?: number) {
    return {
      ...(id ? { id } : {}),
      description: e.description,
      note: e.note ?? null,
      currency: e.currency,
      amount: e.amount,
      date: e.date,
      category: e.category ?? null,
      shares: e.shares.map((s) => ({
        user_id: s.user_id,
        input: s.input ?? null,
        paid: s.paid,
        owed: s.owed,
        calculated_amount: s.owed,
      })),
      splitType: e.split_type,
      ...(e.type ? { type: e.type, paymentServiceType: e.payment_service_type ?? null } : {}),
      isRecurring: false,
      expenseGroupId: e.group_id ?? null,
    };
  }

  listGroups() {
    return this.session.request("GET", "/groups");
  }
  listFriends() {
    return this.session.request("GET", "/friends");
  }

  /** Every expense in a group or friend balance, walking all pages (20/page). */
  async listExpenses(s: Scope): Promise<Expense[]> {
    const path = SME.scopePath(s);
    const page = async (p: number) =>
      (await this.session.request("GET", p === 1 ? path : `${path}?page=${p}`)).paginatedExpenses;
    const first = await page(1);
    const out: Expense[] = [...first.data];
    for (let p = 2; p <= first.meta.last_page; p++) out.push(...(await page(p)).data);
    return out;
  }

  async getExpense(s: Scope, id: number): Promise<Expense> {
    const e = (await this.listExpenses(s)).find((x) => x.id === id);
    if (!e) throw new Error(`expense ${id} not found in that group/friend`);
    return e;
  }

  createExpense(e: ExpenseInput) {
    return this.session.request("POST", "/expenses", SME.payload(e));
  }

  /** Edit fields; split is recomputed (equal) only when amount/participants/payer change. */
  async updateExpense(s: Scope, id: number, f: ExpenseEdit) {
    const cur = await this.getExpense(s, id);
    const amount = f.amount ?? cur.amount;
    const shares = this.resplit(cur, amount, f);
    const split_type = f.owed ? EXACT_SPLIT : cur.split_type;
    return this.session.request(
      "PUT",
      `/expenses/${id}`,
      SME.payload({ ...cur, ...f, amount, shares, split_type, group_id: s.group_id ?? null }, id),
    );
  }

  private resplit(cur: Expense, amount: number, f: ExpenseEdit): Share[] {
    if (f.amount === undefined && !f.participants && f.paid_by === undefined && !f.owed) return cur.shares;
    if (f.owed) return SME.exactShares(amount, f.owed, f.paid_by ?? cur.shares.find((x) => x.paid > 0)!.user_id);
    if (cur.split_type !== EQUAL_SPLIT)
      throw new Error("only equal-split expenses can change amount/participants/payer via this tool");
    const owers = f.participants ?? cur.shares.filter((x) => x.owed > 0).map((x) => x.user_id);
    const payer = f.paid_by ?? cur.shares.find((x) => x.paid > 0)?.user_id ?? owers[0];
    return SME.equalShares(amount, owers, payer);
  }

  deleteExpense(id: number) {
    return this.session.request("DELETE", `/expenses/${id}`);
  }

  addAttachment(id: number, bytes: Uint8Array, filename: string, mime: string) {
    const fd = new FormData();
    fd.append("files[0][file]", new Blob([bytes as BlobPart], { type: mime }), filename);
    return this.session.request("POST", `/expenses/${id}/attachments`, undefined, fd);
  }

  // ponytail: route follows the Laravel resource convention; unverified against the live API.
  deleteAttachment(expenseId: number, attachmentId: number) {
    return this.session.request("DELETE", `/expenses/${expenseId}/attachments/${attachmentId}`);
  }
}
export { EQUAL_SPLIT, EXACT_SPLIT, PAYMENT_SPLIT };
