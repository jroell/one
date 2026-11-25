import { useGT } from "gt-react";
import { cva, type VariantProps } from "class-variance-authority";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva("motion-safe:visible-animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
    tone: {
      current: "",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: { tone: "current" },
});

function Spinner({
  className,
  size,
  tone,
  ...props
}: React.ComponentPropsWithoutRef<"svg"> & VariantProps<typeof spinnerVariants>) {
  const gt = useGT();
  return (
    <svg
      aria-label={gt("Loading")}
      ref={observeVisibleAnimation}
      className={cn(spinnerVariants({ size, tone }), className)}
      fill="none"
      role="status"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.25"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* A ring with a lit head and a fading tail, the geometry of the One mark. */}
      <circle cx="12" cy="12" opacity="0.2" r="9" />
      <circle cx="12" cy="12" opacity="0.4" r="9" strokeDasharray="20 36.55" />
      <circle cx="12" cy="12" r="9" strokeDasharray="9 47.55" strokeDashoffset="-11" />
    </svg>
  );
}

export { Spinner };
