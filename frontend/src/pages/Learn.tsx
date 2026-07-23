import { Link } from "react-router-dom";
import { BookOpen, Clock } from "lucide-react";
import { LEARN_MODULES } from "../data/learnModules";

export default function Learn() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <BookOpen size={20} className="text-accent" />
        <h1 className="text-xl font-bold text-white">Learn</h1>
      </div>
      <p className="text-sm text-muted">
        Short, practical modules on fundamental investing concepts — each ends with a quiz.
      </p>

      {/* Module list */}
      <div className="grid gap-3 sm:grid-cols-2">
        {LEARN_MODULES.map((mod) => (
          <Link
            key={mod.slug}
            to={`/learn/${mod.slug}`}
            className="group bg-surface rounded-xl border border-border p-4 hover:border-accent/40 hover:bg-surface-hover transition-all space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-white group-hover:text-accent transition-colors leading-snug">
                {mod.title}
              </h2>
              <span className="shrink-0 flex items-center gap-1 text-[11px] text-muted">
                <Clock size={11} />
                {mod.readMinutes}m
              </span>
            </div>
            <p className="text-xs text-muted leading-relaxed">{mod.subtitle}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] text-muted bg-surface-raised rounded-full px-2 py-0.5">
                {mod.quiz.length} questions
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
