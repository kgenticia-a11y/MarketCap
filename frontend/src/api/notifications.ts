import client from "./client";

export interface Notification {
  id: number;
  type: "earnings_recap" | "news_impact" | "digest";
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string | null;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export async function getNotifications(): Promise<NotificationsResponse> {
  const res = await client.get<NotificationsResponse>("/notifications");
  return res.data;
}

export async function markNotificationRead(id: number): Promise<void> {
  await client.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await client.post("/notifications/read-all");
}
