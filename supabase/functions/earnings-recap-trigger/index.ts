/**
 * earnings-recap-trigger
 *
 * Daily Supabase edge function that finds all published investment memos whose
 * ticker reported earnings yesterday, then calls the FastAPI internal batch
 * endpoint to generate AI recaps for each one.
 *
 * Schedule: daily at 06:00 UTC (after US market close earnings are processed).
 * Deploy: supabase functions deploy earnings-recap-trigger --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FASTAPI_URL = Deno.env.get("FASTAPI_URL") ?? "";
const INTERNAL_API_KEY = Deno.env.get("INTERNAL_API_KEY") ?? "";

Deno.serve(async (_req: Request): Promise<Response> => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FASTAPI_URL || !INTERNAL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Yesterday in YYYY-MM-DD format
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // Find all published memos with pagination (PostgREST caps unpaginated queries at max-rows)
    const memos: {
      id: string; user_id: string; ticker: string;
      thesis_summary: string; moat_notes: string;
      financial_health_notes: string; risks: string;
    }[] = [];
    const MEMO_PAGE_SIZE = 1000;
    let memoPageFrom = 0;
    while (true) {
      const { data: page, error: pageErr } = await supabase
        .from("investment_memos")
        .select("id, user_id, ticker, thesis_summary, moat_notes, financial_health_notes, risks")
        .eq("status", "published")
        .range(memoPageFrom, memoPageFrom + MEMO_PAGE_SIZE - 1);
      if (pageErr) {
        return new Response(
          JSON.stringify({ error: "Failed to query memos", detail: pageErr.message }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      if (!page || page.length === 0) break;
      memos.push(...page);
      if (page.length < MEMO_PAGE_SIZE) break;
      memoPageFrom += MEMO_PAGE_SIZE;
    }

    if (memos.length === 0) {
      return new Response(
        JSON.stringify({ message: "No published memos found", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Filter to memos whose tickers had earnings yesterday.
    // We check the ai_earnings_recaps table to skip already-generated recaps
    // (the FastAPI batch endpoint also checks, but skipping here saves AI calls).
    const { data: existingRecaps } = await supabase
      .from("ai_earnings_recaps")
      .select("memo_id, earnings_date")
      .eq("earnings_date", yesterdayStr);

    const alreadyDone = new Set(
      (existingRecaps ?? []).map((r: { memo_id: number }) => r.memo_id),
    );

    // Build batch items — only memos not already recapped for yesterday.
    // The FastAPI endpoint will additionally verify earnings date via yfinance.
    const items = memos
      .filter((m: { id: number }) => !alreadyDone.has(m.id))
      .map((m: {
        id: number;
        user_id: number;
        ticker: string;
        thesis_summary: string | null;
        moat_notes: string | null;
        financial_health_notes: string | null;
        risks: string | null;
      }) => ({
        ticker: m.ticker,
        memo_id: m.id,
        user_id: m.user_id,
        earnings_date: yesterdayStr,
        thesis_summary: m.thesis_summary,
        moat_notes: m.moat_notes,
        financial_health_notes: m.financial_health_notes,
        risks: m.risks,
      }));

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ message: "All recaps already generated", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Call FastAPI internal batch endpoint
    const batchRes = await fetch(`${FASTAPI_URL}/internal/earnings-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ items }),
    });

    if (!batchRes.ok) {
      const text = await batchRes.text();
      return new Response(
        JSON.stringify({ error: "FastAPI batch call failed", status: batchRes.status, detail: text }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const batchResult = await batchRes.json();
    return new Response(
      JSON.stringify({
        message: "Batch complete",
        earnings_date: yesterdayStr,
        memos_checked: memos.length,
        items_sent: items.length,
        results: batchResult.results,
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
