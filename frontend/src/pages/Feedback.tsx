import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Star, Send, CheckCircle } from "lucide-react";
import client from "../api/client";

const CATEGORIES = ["Bug", "Feature", "General"] as const;
type Category = typeof CATEGORIES[number];

const submitFeedback = (body: { rating: number; category: Category; message: string }) =>
  client.post("/feedback", body).then((r) => r.data);

export default function FeedbackPage() {
  const [rating,   setRating]   = useState(0);
  const [hovered,  setHovered]  = useState(0);
  const [category, setCategory] = useState<Category>("General");
  const [message,  setMessage]  = useState("");

  const mut = useMutation({
    mutationFn: submitFeedback,
  });

  const canSubmit = rating > 0 && message.trim().length >= 5 && message.length <= 1000;

  if (mut.isSuccess) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center p-6">
        <CheckCircle size={48} className="text-positive" />
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Thanks for the feedback!</h2>
          <p className="text-sm text-muted">Your input helps improve MarketCap.</p>
        </div>
        <button
          onClick={() => { mut.reset(); setRating(0); setMessage(""); setCategory("General"); }}
          className="mt-2 px-5 py-2 rounded-xl bg-surface border border-border text-sm text-muted hover:text-white hover:border-border-strong transition-colors"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 w-full">
      <div className="bg-surface rounded-xl border border-border p-6 space-y-6">

        {/* Heading */}
        <div>
          <h2 className="text-base font-semibold text-white mb-1">Share your feedback</h2>
          <p className="text-xs text-muted">Bugs, feature requests, or anything on your mind.</p>
        </div>

        {/* Star rating */}
        <div>
          <label className="text-xs text-muted uppercase tracking-widest mb-2 block">Overall Rating</label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  size={28}
                  className={clsx(
                    "transition-colors",
                    n <= (hovered || rating)
                      ? "text-amber-400 fill-amber-400"
                      : "text-muted"
                  )}
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-xs text-muted mt-1">
              {["", "Poor", "Fair", "Good", "Great", "Excellent"][rating]}
            </p>
          )}
        </div>

        {/* Category */}
        <div>
          <label className="text-xs text-muted uppercase tracking-widest mb-2 block">Category</label>
          <div className="flex gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={clsx(
                  "px-4 py-1.5 rounded-xl text-xs font-medium border transition-colors",
                  category === c
                    ? "bg-accent border-accent text-white"
                    : "bg-transparent border-border text-muted hover:text-white hover:border-border-strong"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        <div>
          <label className="text-xs text-muted uppercase tracking-widest mb-2 block">Message</label>
          <textarea
            value={message}
            maxLength={1000}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              category === "Bug"     ? "Describe what happened and how to reproduce it..." :
              category === "Feature" ? "What would you like to see added or improved?" :
              "Anything you'd like to share..."
            }
            rows={5}
            className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted outline-none focus:border-accent transition-colors resize-none"
          />
          <div className="flex justify-between mt-1">
            <span className={clsx("text-[10px]", message.length < 5 && message.length > 0 ? "text-negative" : "text-muted")}>
              {message.length < 5 ? `${5 - message.length} more characters required` : ""}
            </span>
            <span className={`text-[10px] ${message.length >= 1000 ? "text-negative" : "text-muted"}`}>{message.length}/1000</span>
          </div>
        </div>

        {/* Error */}
        {mut.isError && (
          <p className="text-xs text-negative">Something went wrong — please try again.</p>
        )}

        {/* Submit */}
        <button
          onClick={() => mut.mutate({ rating, category, message })}
          disabled={!canSubmit || mut.isPending}
          className={clsx(
            "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all",
            canSubmit && !mut.isPending
              ? "bg-accent hover:bg-accent/90 text-white shadow-lg shadow-accent/20"
              : "bg-surface-hover text-muted cursor-not-allowed"
          )}
        >
          <Send size={14} />
          {mut.isPending ? "Sending…" : "Submit Feedback"}
        </button>
      </div>
    </div>
  );
}
