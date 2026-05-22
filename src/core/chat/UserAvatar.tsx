import { cn } from "@/lib/utils";

type Props = {
  name?: string | null;
  email?: string | null;
  url?: string | null;
  size?: number;
  className?: string;
};

export function UserAvatar({ name, email, url, size = 32, className }: Props) {
  const initial = ((name ?? email ?? "?")[0] || "?").toUpperCase();
  const px = `${size}px`;
  return (
    <div
      className={cn(
        "rounded-full bg-primary/15 grid place-items-center overflow-hidden shrink-0",
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.max(10, Math.floor(size / 2.6)) }}
      title={name ?? email ?? ""}
    >
      {url ? (
        <img src={url} alt={name ?? email ?? "avatar"} className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold">{initial}</span>
      )}
    </div>
  );
}
