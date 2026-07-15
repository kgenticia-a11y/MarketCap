import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X, Send } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "../context/AuthContext";
import { sendChatMessage, type ChatMessage } from "../api/ai";

export default function AIChatWidget() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const mutation = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      sendChatMessage({ message: history[history.length - 1].content, history: history.slice(0, -1), current_page: pathname }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (e: unknown) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const content = status === 503
        ? "AI chat is not configured on this server."
        : status === 429
        ? "I'm getting a lot of requests right now — give me a moment and try again."
        : "Sorry, something went wrong. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    },
  });

  if (!user) return null;

  const send = () => {
    const text = input.trim();
    if (!text || mutation.isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    mutation.mutate(next);
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-12 h-12 rounded-full bg-accent hover:bg-accent/90 shadow-lg shadow-accent/30 flex items-center justify-center text-white transition-all"
        aria-label="Open AI assistant"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {/* Panel sizing:
          - phones (<sm): pinned to all four edges with safe insets so the
            sheet always fits the viewport regardless of the keyboard or
            address bar. No fixed width that could push the close button
            off-screen.
          - sm and up: floats above the FAB with a fixed comfortable
            width, the original desktop behaviour.
          The height also drops the fixed 560px on mobile — on a 640px
          phone with a keyboard open that overflows. dvh + max-h keeps
          the input visible. */}
      {open && (
        <div className="fixed z-50 bg-surface-raised border border-border shadow-2xl flex flex-col overflow-hidden
                        inset-x-3 bottom-20 top-16 rounded-2xl
                        sm:inset-x-auto sm:top-auto sm:bottom-24 sm:right-6 sm:w-[400px] sm:h-[560px] sm:max-h-[70vh]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Sparkles size={14} className="text-accent-light" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">MarketCap Assistant</p>
              <p className="text-[10px] text-muted">Powered by Meta Llama</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-muted text-center py-6">
                Ask me anything about your portfolio, a ticker, or the market — e.g. "Should I be worried about my NVDA position?"
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={clsx(
                  "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                  m.role === "user" ? "bg-accent text-white" : "bg-surface-hover text-white"
                )}>
                  {m.content}
                </div>
              </div>
            ))}
            {mutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-surface-hover rounded-xl px-3 py-2 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border shrink-0 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask the assistant…"
              className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-xs text-white placeholder-muted outline-none focus:border-accent transition-colors"
            />
            <button
              onClick={send}
              disabled={!input.trim() || mutation.isPending}
              className="w-9 h-9 rounded-xl bg-accent hover:bg-accent/90 disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-colors"
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
