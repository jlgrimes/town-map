import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A filter rendered as one pill split into four segments — subject, operator,
 * value, remove — divided by hairlines. Every segment is always present, so the
 * chip reads as a sentence and edits in place without a trip through a settings
 * panel.
 */
function FilterChip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="filter-chip"
      className={cn(
        "flex h-7 shrink-0 items-center divide-x divide-border overflow-hidden rounded-2xl border border-border bg-background text-xs shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

const segmentClasses =
  "flex h-full items-center gap-1 px-2 whitespace-nowrap outline-none transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

const interactiveClasses =
  "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset aria-expanded:bg-muted";

/** What is being filtered. Never interactive. */
function FilterChipSubject({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="filter-chip-subject"
      className={cn(segmentClasses, "select-none font-medium", className)}
      {...props}
    />
  );
}

/** How subject relates to value — "is", "within", "is any of", "under". */
function FilterChipOperator({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="filter-chip-operator"
      className={cn(segmentClasses, interactiveClasses, "text-muted-foreground font-normal", className)}
      {...props}
    />
  );
}

/** The current selection. Opens the chip's popover. */
function FilterChipValue({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="filter-chip-value"
      className={cn(segmentClasses, interactiveClasses, className)}
      {...props}
    />
  );
}

function FilterChipRemove({
  className,
  label,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      data-slot="filter-chip-remove"
      aria-label={label}
      className={cn(
        "flex h-full w-7 items-center justify-center text-muted-foreground outline-none transition-colors",
        interactiveClasses,
        "hover:text-foreground",
        className,
      )}
      {...props}
    >
      <X className="size-3.5" />
    </button>
  );
}

export { FilterChip, FilterChipOperator, FilterChipRemove, FilterChipSubject, FilterChipValue };
