import client from "./client";

export type AccountType = "brokerage" | "retirement" | "crypto" | "other";

export interface UserAccount {
  id: number;
  name: string;
  type: AccountType;
  created_at: string;
}

export const listAccounts = () =>
  client.get<UserAccount[]>("/accounts").then((r) => r.data);

export const createAccount = (name: string, type: AccountType) =>
  client.post<UserAccount>("/accounts", { name, type }).then((r) => r.data);

export const updateAccount = (id: number, patch: { name?: string; type?: AccountType }) =>
  client.patch<UserAccount>(`/accounts/${id}`, patch).then((r) => r.data);

export const deleteAccount = (id: number) =>
  client.delete(`/accounts/${id}`);
