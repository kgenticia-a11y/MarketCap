import client from "./client";

/** Autonomous document-driven company analysis (no AI) — reads the
 *  company's entire SEC filing history and returns a computed report. */
export const getCompanyLifeAnalysis = (ticker: string) =>
  client.get(`/analysis/company/${ticker}`).then((r) => r.data);
