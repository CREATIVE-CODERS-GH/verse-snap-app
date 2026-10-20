import { cn } from "@/lib/utils";

/** The official Verse Snap logo (cross over an open Bible), used wherever the app shows its mark. */
export const LOGO_SRC = "/icons/logo-96.png";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt=""
      aria-hidden
      width={40}
      height={40}
      decoding="async"
      className={cn("inline-block h-10 w-10 shrink-0 rounded-[22%] object-cover", className)}
    />
  );
}
