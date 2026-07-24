import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle, Clock, XCircle,
} from "lucide-react";

import { findModule, type QuizQuestion } from "../data/learnModules";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function MarkdownBody({ text }: { text: string }) {
  // Split on double newline to create paragraphs
  return (
    <div className="space-y-3">
      {text.split(/\n\n+/).map((para, i) => (
        <p key={i} className="text-sm text-muted/90 leading-relaxed">
          {para.trim()}
        </p>
      ))}
    </div>
  );
}

/* ── Quiz component ─────────────────────────────────────────────────────── */

type QuizState = "idle" | "answered";

function QuizCard({
  question,
  index,
  total,
  onAnswered,
}: {
  question: QuizQuestion;
  index: number;
  total: number;
  onAnswered: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<QuizState>("idle");

  const handleSelect = (idx: number) => {
    if (state === "answered") return;
    setSelected(idx);
    setState("answered");
    onAnswered(idx === question.correctIndex);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted uppercase tracking-widest">
        Question {index + 1} of {total}
      </p>
      <p className="text-sm font-medium text-white leading-snug">{question.question}</p>

      <div className="space-y-2">
        {question.choices.map((choice, idx) => {
          const isCorrect = idx === question.correctIndex;
          const isSelected = idx === selected;

          let style = "border-border text-muted hover:border-accent/50 hover:text-white cursor-pointer";
          if (state === "answered") {
            if (isCorrect) style = "border-positive/60 bg-positive/10 text-positive cursor-default";
            else if (isSelected) style = "border-negative/60 bg-negative/10 text-negative cursor-default";
            else style = "border-border text-muted/50 cursor-default";
          }

          return (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              className={clsx(
                "w-full text-left px-4 py-3 rounded-xl border text-sm transition-all",
                style,
              )}
            >
              <span className="flex items-center gap-2.5">
                {state === "answered" && isCorrect && <CheckCircle size={14} className="text-positive shrink-0" />}
                {state === "answered" && isSelected && !isCorrect && <XCircle size={14} className="text-negative shrink-0" />}
                {!(state === "answered" && (isCorrect || (isSelected && !isCorrect))) && (
                  <span className="w-[14px] shrink-0" />
                )}
                {choice}
              </span>
            </button>
          );
        })}
      </div>

      {state === "answered" && (
        <div className="bg-surface-raised rounded-xl border border-border p-3">
          <p className="text-xs text-muted/90 leading-relaxed">
            <span className="font-semibold text-white">Explanation: </span>
            {question.explanation}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function LearnModule() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const mod = findModule(slug);

  const [phase, setPhase] = useState<"read" | "quiz">("read");
  const [quizIndex, setQuizIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [currentAnswered, setCurrentAnswered] = useState(false);

  if (!mod) {
    return (
      <div className="p-6 max-w-2xl">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted hover:text-white mb-4 transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted">Module not found.</p>
        </div>
      </div>
    );
  }

  const handleQuizAnswered = (correct: boolean) => {
    setCurrentAnswered(true);
    if (correct) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (!currentAnswered) return;
    setAnswers((prev) => [...prev, currentAnswered]);
    setCurrentAnswered(false);
    setQuizIndex((i) => i + 1);
  };

  const isQuizComplete = phase === "quiz" && quizIndex >= mod.quiz.length;
  const perfectScore = score === mod.quiz.length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl space-y-5">
      {/* Back */}
      <Link
        to="/learn"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors"
      >
        <ArrowLeft size={15} /> All modules
      </Link>

      {/* Header */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-white">{mod.title}</h1>
            <p className="text-sm text-muted mt-1">{mod.subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted shrink-0 mt-1">
            <Clock size={13} />
            {mod.readMinutes} min read
          </div>
        </div>

        {/* Phase tabs */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setPhase("read")}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              phase === "read"
                ? "bg-accent text-white"
                : "bg-surface-raised text-muted hover:text-white",
            )}
          >
            <BookOpen size={12} className="inline mr-1" />
            Read
          </button>
          <button
            onClick={() => { setPhase("quiz"); setQuizIndex(0); setScore(0); setCurrentAnswered(false); setAnswers([]); }}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              phase === "quiz"
                ? "bg-accent text-white"
                : "bg-surface-raised text-muted hover:text-white",
            )}
          >
            Quiz ({mod.quiz.length}q)
          </button>
        </div>
      </div>

      {/* Content */}
      {phase === "read" && (
        <div className="space-y-5">
          {mod.sections.map((sec, i) => (
            <div key={i} className="space-y-2">
              {sec.heading && (
                <h2 className="text-sm font-semibold text-white">{sec.heading}</h2>
              )}
              <MarkdownBody text={sec.body} />
            </div>
          ))}

          {/* CTA to quiz */}
          <div className="bg-surface rounded-xl border border-accent/20 p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted">
              Ready to test your understanding?
            </p>
            <button
              onClick={() => setPhase("quiz")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-all shrink-0"
            >
              Take quiz <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {phase === "quiz" && (
        <div className="space-y-5">
          {isQuizComplete ? (
            /* Results */
            <div className="bg-surface rounded-xl border border-border p-6 space-y-4 text-center">
              {perfectScore ? (
                <CheckCircle size={40} className="text-positive mx-auto" />
              ) : (
                <BookOpen size={40} className="text-accent mx-auto" />
              )}
              <div>
                <p className="text-xl font-bold text-white">
                  {score}/{mod.quiz.length} correct
                </p>
                <p className="text-sm text-muted mt-1">
                  {perfectScore
                    ? "Perfect score! You've mastered this module."
                    : score >= Math.ceil(mod.quiz.length / 2)
                    ? "Good work — review the explanations to lock in the concepts."
                    : "Review the lesson and try again."}
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => { setQuizIndex(0); setScore(0); setCurrentAnswered(false); setAnswers([]); }}
                  className="px-4 py-2 rounded-xl bg-surface-raised border border-border text-sm text-muted hover:text-white transition-all"
                >
                  Retake quiz
                </button>
                <Link
                  to="/learn"
                  className="px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-all"
                >
                  More modules
                </Link>
              </div>
            </div>
          ) : (
            /* Active quiz */
            <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
              <QuizCard
                key={quizIndex}
                question={mod.quiz[quizIndex]}
                index={quizIndex}
                total={mod.quiz.length}
                onAnswered={handleQuizAnswered}
              />

              {currentAnswered && (
                <div className="flex justify-end">
                  {quizIndex < mod.quiz.length - 1 ? (
                    <button
                      onClick={handleNext}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-accent/90 text-white text-sm font-medium transition-all"
                    >
                      Next <ArrowRight size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setAnswers((prev) => [...prev, currentAnswered]);
                        setQuizIndex(mod.quiz.length);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-positive hover:bg-positive/90 text-black text-sm font-medium transition-all"
                    >
                      <CheckCircle size={14} /> See results
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
