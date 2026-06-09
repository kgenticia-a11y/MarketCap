interface Props { title: string }
export default function Placeholder({ title }: Props) {
  return (
    <div className="flex items-center justify-center h-full text-muted text-sm">
      {title} — coming soon
    </div>
  );
}
