import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const typographyVariants = cva("font-sans antialiased", {
  variants: {
    variant: {
      h1: "text-[1.375rem] leading-tight font-semibold tracking-tight text-foreground",
      h2: "text-[1.125rem] leading-snug font-semibold tracking-tight text-foreground",
      h3: "text-base leading-snug font-semibold tracking-tight text-foreground",
      h4: "text-sm leading-normal font-semibold tracking-tight text-foreground",
      kicker: "text-xs font-semibold tracking-wider text-muted-foreground uppercase",
      body: "text-sm leading-relaxed text-foreground",
      "body-muted": "text-sm leading-relaxed text-muted-foreground",
      "body-sm": "text-[0.8125rem] leading-normal text-muted-foreground",
      caption: "text-xs leading-normal text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

type ElementType = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div" | "label";

export interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof typographyVariants> {
  as?: ElementType;
}

export const Typography = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, variant, as, children, ...props }, ref) => {
    let Component: ElementType = as || "p";

    if (!as) {
      if (variant === "h1") Component = "h1";
      else if (variant === "h2") Component = "h2";
      else if (variant === "h3") Component = "h3";
      else if (variant === "h4") Component = "h4";
      else if (variant === "kicker") Component = "span";
      else if (variant === "caption") Component = "span";
      else Component = "p";
    }

    return React.createElement(
      Component,
      {
        ref,
        className: cn(typographyVariants({ variant }), className),
        ...props,
      },
      children
    );
  }
);

Typography.displayName = "Typography";
