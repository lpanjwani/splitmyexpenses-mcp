import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SME, EQUAL_SPLIT, EXACT_SPLIT, PAYMENT_SPLIT } from "./sme.js";
import { CATEGORIES } from "./categories.js";
import type { Env, Props, Scope } from "./types.js";

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v) }],
});
const id = () => z.number().int();
const scopeShape = {
  group_id: id().optional().describe("Expense group id. Omit for a non-group (friend) expense."),
  friend_id: id().optional().describe("Friend's user id, for non-group expenses."),
};
const owedSchema = z
  .array(z.object({ user_id: id(), amount: id().positive() }))
  .min(1)
  .describe("Unequal split: exact minor-unit amount each user owes; must sum to amount. Overrides participants.");
const scope = (a: Scope): Scope => {
  if (!a.group_id === !a.friend_id) throw new Error("pass exactly one of group_id or friend_id");
  return a;
};

// One Durable Object per MCP session; it holds that user's SME cookie jar and re-logs in on 401.
export class SplitMyExpensesMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "splitmyexpenses", version: "0.1.0" });
  private sme!: SME;

  /** Registers a tool whose handler's return value is wrapped as MCP text content. */
  private tool<S extends z.ZodRawShape>(
    name: string,
    desc: string,
    shape: S,
    fn: (a: z.infer<z.ZodObject<S>>) => unknown,
  ) {
    (this.server as any).tool(name, desc, shape, async (a: unknown) => text(await fn(a as z.infer<z.ZodObject<S>>)));
  }

  async init() {
    this.sme = new SME(this.props!.email, this.props!.password);
    this.registerReadTools();
    this.registerWriteTools();
  }

  private registerReadTools() {
    this.tool("list_groups", "List the user's expense groups (with members, keyedUsers = id->name).", {}, () =>
      this.sme.listGroups(),
    );
    this.tool("list_friends", "List friends with balances.", {}, () => this.sme.listFriends());
    this.tool("list_categories", "Category name -> id map for create/update.", {}, () => CATEGORIES);
    this.tool(
      "list_expenses",
      "All expenses in a group or in a friend's non-group balance. Amounts are minor units (fils/cents).",
      scopeShape,
      (a) => this.sme.listExpenses(scope(a)),
    );
  }

  private registerWriteTools() {
    this.tool(
      "create_expense",
      "Create a regular expense (type 1): equal split (split_type 1), or exact per-person amounts (split_type 2) when `owed` is given, or a solo one-person expense when participants is omitted. For settlements/payments use record_payment instead. Amount in minor units (AED 119.20 = 11920). Looks up nothing: use real user ids from list_groups/list_friends.",
      {
        ...scopeShape,
        description: z.string(),
        currency: z.string().default("AED"),
        amount: id().positive(),
        date: z.string().describe("YYYY-MM-DD"),
        category: id().optional(),
        note: z.string().optional(),
        participants: z
          .array(id())
          .min(1)
          .optional()
          .describe(
            "User ids who owe an equal share. The payer may be omitted (they paid, others owe); the payer is then added owing nothing. Omit for a solo expense.",
          ),
        owed: owedSchema.optional(),
        paid_by: id().describe("User id who paid (need not be a participant)"),
      },
      (a) => {
        scope(a);
        const participants = a.participants ?? [a.paid_by];
        return this.sme.createExpense({
          ...a,
          split_type: a.owed ? EXACT_SPLIT : EQUAL_SPLIT,
          shares: a.owed
            ? SME.exactShares(a.amount, a.owed, a.paid_by)
            : SME.equalShares(a.amount, participants, a.paid_by),
          group_id: a.group_id ?? null,
        });
      },
    );

    this.tool(
      "record_payment",
      "Record a settlement/payment (expense type 2, payment_service_type 1, split_type 7): `from` pays `to` an amount (minor units). Payload matches existing payments in the live API.",
      {
        ...scopeShape,
        from: id().describe("User id who paid"),
        to: id().describe("User id who received"),
        amount: id().positive(),
        currency: z.string().default("AED"),
        date: z.string().describe("YYYY-MM-DD"),
      },
      (a) => {
        scope(a);
        return this.sme.createExpense({
          description: "Payment",
          currency: a.currency,
          amount: a.amount,
          date: a.date,
          split_type: PAYMENT_SPLIT,
          type: 2,
          payment_service_type: 1,
          shares: SME.payment(a.amount, a.from, a.to),
          group_id: a.group_id ?? null,
        });
      },
    );

    this.tool(
      "update_expense",
      "Edit an expense. Changing amount/participants/payer recomputes an equal split; `owed` switches to an exact split (split_type 2). Payments (type 2, split_type 7) keep their type but their amount/payer cannot be changed: delete and re-record with record_payment.",
      {
        ...scopeShape,
        expense_id: id(),
        description: z.string().optional(),
        note: z.string().nullable().optional(),
        category: id().optional(),
        date: z.string().optional(),
        amount: id().positive().optional(),
        participants: z.array(id()).min(1).optional(),
        owed: owedSchema.optional(),
        paid_by: id().optional(),
      },
      ({ expense_id, group_id, friend_id, ...f }) =>
        this.sme.updateExpense(scope({ group_id, friend_id }), expense_id, f),
    );

    this.tool(
      "delete_expense",
      "PERMANENTLY delete an expense. Confirm id, description and amount with the user first.",
      {
        expense_id: id(),
        confirm: z.literal(true).describe("Must be true; only after the user confirmed this exact expense."),
      },
      async ({ expense_id }) => (await this.sme.deleteExpense(expense_id)) ?? "deleted",
    );

    this.tool(
      "add_attachment",
      "Attach a receipt image/PDF to an expense (base64 content; prefer JPEG/PNG).",
      {
        expense_id: id(),
        filename: z.string(),
        mime_type: z.string().default("image/jpeg"),
        file_base64: z.string(),
      },
      (a) =>
        this.sme.addAttachment(
          a.expense_id,
          Uint8Array.from(atob(a.file_base64), (c) => c.charCodeAt(0)),
          a.filename,
          a.mime_type,
        ),
    );

    this.tool(
      "delete_attachment",
      "PERMANENTLY delete an attachment from an expense. Get attachment_id from list_expenses; confirm with the user first.",
      {
        expense_id: id(),
        attachment_id: id(),
        confirm: z.literal(true).describe("Must be true; only after the user confirmed this exact attachment."),
      },
      async ({ expense_id, attachment_id }) =>
        (await this.sme.deleteAttachment(expense_id, attachment_id)) ?? "deleted",
    );
  }
}
