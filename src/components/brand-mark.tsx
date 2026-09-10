import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-primary text-primary",
        className,
      )}
      aria-hidden
    >
      <BookOpen className="h-5 w-5" strokeWidth={1.75} />
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 border-r border-t border-primary" />
      <span className="absolute -bottom-0.5 -left-0.5 h-2 w-2 border-b border-l border-primary" />
    </span>
  );
}