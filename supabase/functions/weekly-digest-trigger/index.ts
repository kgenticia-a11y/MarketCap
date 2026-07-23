/**
 * weekly-digest-trigger
 *
 * Weekly Supabase edge function that builds a digest for each user directly
 * from Supabase data, inserts a 'digest' in-app notification, and sends an
 * email summary via Resend (when RESEND_API_KEY is set).
 *
 * Schedule: every Monday at 09:00 UTC
 * Deploy: supabase functions deploy weekly-digest-trigger --no-verify-jwt
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY (optional — email only sent when set)
 *   DIGEST_FROM_EMAIL (optional — defaults to digest@marketcap.ksystems.live)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("DIGEST_FROM_EMAIL") ?? "digest@marketcap.ksystems.live";

interface PortfolioSnapshot {
  date: string;
  total_value: number;
}

interface NewsImpact {
  ticker: string;
  headline: string;
  impact: string;
  created_at: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function buildEmailHtml(
  email: string,
  currentValue: number | null,
  weekAgoValue: number | null,
  impacts: NewsImpact[],
): string {
  const changeNum = currentValue !== null && weekAgoValue !== null ? currentValue - weekAgoValue : null;
  const changePct = changeNum !== null && weekAgoValue && weekAgoValue > 0
    ? (changeNum / weekAgoValue) * 100
    : null;

  const changeStr = changeNum !== null
    ? `${changeNum >= 0 ? "+" : ""}${formatCurrency(changeNum)}${changePct !== null ? ` (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%)` : ""}`
    : "";

  const impactRows = impacts
    .map((i) => {
      const color = i.impact === "strengthens" ? "#22c55e" : i.impact === "weakens" ? "#ef4444" : "#6b7280";
      return `<tr><td style="padding:4px 8px">${i.ticker}</td><td style="padding:4px 8px;color:${color};font-weight:600">${i.impact}</td><td style="padding:4px 8px">${i.headline.slice(0, 80)}</td></tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your Weekly MarketCap Digest</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f0f14;color:#e5e5e5;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto">
    <h1 style="color:#a78bfa;font-size:1.4rem;margin-bottom:4px">Your Weekly MarketCap Digest</h1>
    <p style="color:#9ca3af;font-size:0.85rem;margin-top:0">${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>

    ${currentValue !== null ? `
    <div style="background:#1a1a2e;border:1px solid #2d2d44;border-radius:12px;padding:16px;margin-bottom:16px">
      <h2 style="color:#e5e5e5;font-size:1rem;margin:0 0 8px">Portfolio</h2>
      <p style="margin:4px 0;font-size:1.5rem;font-weight:700;color:#e5e5e5">${formatCurrency(currentValue)}</p>
      ${changeStr ? `<p style="margin:4px 0;font-size:0.9rem;color:${(changeNum ?? 0) >= 0 ? "#22c55e" : "#ef4444"}">${changeStr} vs last week</p>` : ""}
    </div>` : ""}

    ${impacts.length > 0 ? `
    <div style="background:#1a1a2e;border:1px solid #2d2d44;border-radius:12px;padding:16px;margin-bottom:16px">
      <h2 style="color:#e5e5e5;font-size:1rem;margin:0 0 8px">News Impacts on Your Theses (last 7 days)</h2>
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead><tr style="color:#9ca3af"><th style="text-align:left;padding:4px 8px">Ticker</th><th style="text-align:left;padding:4px 8px">Impact</th><th style="text-align:left;padding:4px 8px">Headline</th></tr></thead>
        <tbody>${impactRows}</tbody>
      </table>
    </div>` : ""}

    <p style="text-align:center;margin-top:24px">
      <a href="https://marketcap.ksystems.live" style="background:#a78bfa;color:#000;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem">Open MarketCap</a>
    </p>
    <p style="text-align:center;color:#6b7280;font-size:0.75rem;margin-top:16px">You received this because you have an account at marketcap.ksystems.live</p>
  </div>
</body>
</html>`;
}

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all users
    const { data: users, error: usersErr } = await supabase
      .from("users")
      .select("id, email, name");

    if (usersErr) {
      return new Response(
        JSON.stringify({ error: "Failed to query users", detail: usersErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!users || users.length === 0) {
      return new Response(
        JSON.stringify({ message: "No users found", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const weekAgoDt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results: Array<{ user_id: number; email: string; status: string; reason?: string }> = [];

    for (const user of users as Array<{ id: number; email: string; name: string | null }>) {
      try {
        // Portfolio: find the user's portfolio
        const { data: portfolios } = await supabase
          .from("portfolios")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

        let currentValue: number | null = null;
        let weekAgoValue: number | null = null;

        if (portfolios && portfolios.length > 0) {
          const portfolioId = portfolios[0].id;

          const { data: snapshots } = await supabase
            .from("portfolio_snapshots")
            .select("date, total_value")
            .eq("portfolio_id", portfolioId)
            .lte("date", today)
            .order("date", { ascending: false })
            .limit(2);

          if (snapshots && snapshots.length > 0) {
            currentValue = (snapshots[0] as PortfolioSnapshot).total_value;
          }

          const { data: weekSnaps } = await supabase
            .from("portfolio_snapshots")
            .select("date, total_value")
            .eq("portfolio_id", portfolioId)
            .lte("date", weekAgo)
            .order("date", { ascending: false })
            .limit(1);

          if (weekSnaps && weekSnaps.length > 0) {
            weekAgoValue = (weekSnaps[0] as PortfolioSnapshot).total_value;
          }
        }

        // Recent news impacts from user's memos
        const { data: memos } = await supabase
          .from("investment_memos")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "published");

        let impacts: NewsImpact[] = [];
        if (memos && memos.length > 0) {
          const memoIds = memos.map((m: { id: number }) => m.id);
          const { data: impactRows } = await supabase
            .from("memo_news_impacts")
            .select("ticker, headline, impact, created_at")
            .in("memo_id", memoIds)
            .gte("created_at", weekAgoDt)
            .order("created_at", { ascending: false })
            .limit(5);

          impacts = (impactRows ?? []) as NewsImpact[];
        }

        // Insert digest notification
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "digest",
          message: "Your weekly MarketCap digest is ready",
          link: "/",
        });

        // Send email only if Resend is configured
        if (RESEND_API_KEY) {
          const html = buildEmailHtml(user.email, currentValue, weekAgoValue, impacts);
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: FROM_EMAIL,
              to: user.email,
              subject: "Your Weekly MarketCap Digest",
              html,
            }),
          });

          if (!emailRes.ok) {
            const errText = await emailRes.text();
            results.push({ user_id: user.id, email: user.email, status: "email_error", reason: errText.slice(0, 200) });
          } else {
            results.push({ user_id: user.id, email: user.email, status: "sent" });
          }
        } else {
          results.push({ user_id: user.id, email: user.email, status: "notification_only" });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ user_id: user.id, email: user.email, status: "error", reason: message });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const notifOnly = results.filter((r) => r.status === "notification_only").length;
    return new Response(
      JSON.stringify({
        message: "Digest run complete",
        users_processed: users.length,
        emails_sent: sent,
        notifications_only: notifOnly,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Unhandled error", detail: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
