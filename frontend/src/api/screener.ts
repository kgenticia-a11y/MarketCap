import client from "./client";

export interface SavedScreen {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export const getSavedScreens = (): Promise<SavedScreen[]> =>
  client.get("/screener/saved").then((r) => r.data);

export const saveScreen = (name: string, filters: Record<string, unknown>): Promise<SavedScreen> =>
  client.post("/screener/saved", { name, filters }).then((r) => r.data);

export const deleteSavedScreen = (id: number) =>
  client.delete(`/screener/saved/${id}`);
