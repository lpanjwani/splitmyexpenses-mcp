import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export type Share = { user_id: number; paid: number; owed: number; input?: string | null; [k: string]: any };
export type Owed = { user_id: number; amount: number }; // exact amount owed, minor units
export type Expense = {
  id: number;
  description: string;
  note: string | null;
  currency: string;
  amount: number;
  date: string;
  category: number | null;
  split_type: number;
  is_recurring: boolean;
  shares: Share[];
  [k: string]: any;
};
// Where an expense lives: a group, or a friend's non-group balance.
export type Scope = { group_id?: number; friend_id?: number };
export type ExpenseInput = {
  description: string;
  note?: string | null;
  currency: string;
  amount: number;
  date: string;
  category?: number | null;
  split_type: number;
  shares: Share[];
  group_id?: number | null;
  type?: number; // 1 expense (default), 2 settlement payment
  payment_service_type?: number;
};
export type ExpenseEdit = {
  description?: string;
  note?: string | null;
  category?: number;
  date?: string;
  amount?: number;
  participants?: number[];
  paid_by?: number;
  owed?: Owed[];
};

export type Props = { email: string; password: string }; // encrypted at rest by workers-oauth-provider (keyed to the token)
export type Env = { MCP_OBJECT: DurableObjectNamespace; OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers };
