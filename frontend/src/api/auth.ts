import client from "./client";

export const register = (email: string, password: string, accepted_terms: boolean) =>
  client.post("/auth/register", { email, password, accepted_terms }).then((r) => r.data);

export const login = (email: string, password: string) =>
  client.post("/auth/login", { email, password }).then((r) => r.data);

export const getMe = () => client.get("/auth/me").then((r) => r.data);
