import { motion } from "framer-motion";

export interface DeprecatedEventButtonProps {
  sourceUrl?: string | null;
  layoutIdPrefix?: string;
  eventId?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * @deprecated Preserved during UI refactoring.
 * Import this component if you need to restore or reuse the primary "Event Page" pill button styling.
 */
export function DeprecatedEventPageButton({
  sourceUrl,
  layoutIdPrefix = "discover",
  eventId,
  size = "sm",
  className = "",
}: DeprecatedEventButtonProps) {
  const layoutId = eventId ? `button-${layoutIdPrefix}-${eventId}` : undefined;
  const paddingClass = size === "md" ? "px-4 py-2.5" : "px-3.5 py-1.5";

  if (sourceUrl) {
    return (
      <motion.a
        layoutId={layoutId}
        href={sourceUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${paddingClass} text-xs rounded-full font-bold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 shrink-0 shadow-xs transition-colors ${className}`}
      >
        Event Page
      </motion.a>
    );
  }

  return (
    <motion.button
      layoutId={layoutId}
      className={`${paddingClass} text-xs rounded-full font-bold bg-secondary text-secondary-foreground shrink-0 transition-colors ${className}`}
    >
      Event
    </motion.button>
  );
}
