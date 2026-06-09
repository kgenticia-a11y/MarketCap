import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";

interface NewsItem {
  id: string;
  title: string;
  description?: string;
  article_url: string;
  image_url?: string;
  published_utc: string;
  publisher: { name: string };
  tickers?: string[];
}

interface Props {
  item: NewsItem;
  compact?: boolean;
}

function safeUrl(url: string | undefined): string {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch { /* ignore */ }
  return "#";
}

export default function NewsCard({ item, compact }: Props) {
  const age = item.published_utc
    ? formatDistanceToNow(new Date(item.published_utc), { addSuffix: true })
    : "Recently";
  const articleUrl = safeUrl(item.article_url);

  if (compact) {
    return (
      <a
        href={articleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-3 rounded-xl bg-surface border border-border hover:border-border-strong transition-colors group"
      >
        <p className="text-xs text-white leading-snug line-clamp-2 group-hover:text-accent-light transition-colors mb-1.5">
          {item.title}
        </p>
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span>{item.publisher.name}</span>
          <span>{age}</span>
        </div>
      </a>
    );
  }

  return (
    <a
      href={articleUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 p-4 rounded-xl bg-surface hover:bg-surface-hover border border-border hover:border-border-strong transition-all group"
    >
      {safeUrl(item.image_url) !== "#" && (
        <img
          src={safeUrl(item.image_url)}
          alt=""
          className="w-20 h-16 object-cover rounded-lg shrink-0 bg-surface-raised"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-white leading-snug line-clamp-2 group-hover:text-accent-light transition-colors">
            {item.title}
          </h4>
          <ExternalLink size={13} className="text-muted shrink-0 mt-0.5" />
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted">
          <span>{item.publisher.name}</span>
          <span>·</span>
          <span>{age}</span>
        </div>
      </div>
    </a>
  );
}
