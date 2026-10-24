import { cn } from "@/lib/utils";

/**
 * Wordmark em texto até a IJ fornecer o logo vetorial (design doc §4.5.1).
 */
export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <span
        className={cn(
          "font-mono text-base font-semibold tracking-tight text-foreground",
          className,
        )}
      >
        I<span className="text-primary">J</span>
      </span>
    );
  }
  return (
    <span className={cn("font-sans text-lg font-semibold tracking-tight text-foreground", className)}>
      Inteli<span className="text-primary">Júnior</span>
      <span className="ml-2 eyebrow">CRM</span>
    </span>
  );
}
