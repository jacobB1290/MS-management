import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "./label"

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  htmlFor: string
  error?: React.ReactNode
  hint?: React.ReactNode
  required?: boolean
  /** "quiet" pairs with the quiet Input/Textarea variant: a refined small-caps
   *  label that warms to gold while the field inside has focus. */
  variant?: "default" | "quiet"
}

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  function FormField(
    { className, label, htmlFor, error, hint, required, variant = "default", children, ...props },
    ref,
  ) {
    const hintId = hint ? `${htmlFor}-hint` : undefined
    const errorId = error ? `${htmlFor}-error` : undefined

    const enhancedChildren = React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child
      const element = child as React.ReactElement<{
        id?: string
        "aria-invalid"?: boolean
        "aria-describedby"?: string
      }>
      const describedBy =
        [errorId, hintId, element.props["aria-describedby"]]
          .filter(Boolean)
          .join(" ") || undefined
      return React.cloneElement(element, {
        id: element.props.id ?? htmlFor,
        "aria-invalid": error ? true : element.props["aria-invalid"],
        "aria-describedby": describedBy,
      } as Partial<typeof element.props>)
    })

    return (
      <div
        ref={ref}
        className={cn(
          "flex min-w-0 flex-col gap-[var(--space-xs)]",
          variant === "quiet" && "group/field gap-1.5",
          className,
        )}
        {...props}
      >
        <Label
          htmlFor={htmlFor}
          className={cn(
            variant === "quiet" &&
              cn(
                "text-micro font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-muted",
                "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                "group-focus-within/field:text-gold-dark",
              ),
          )}
        >
          {label}
          {required && (
            <span aria-hidden="true" className="text-danger ml-0.5">
              *
            </span>
          )}
        </Label>
        {enhancedChildren}
        {hint && !error && (
          <p
            id={hintId}
            className="text-small text-ink-muted leading-[var(--leading-prose)]"
          >
            {hint}
          </p>
        )}
        {error && (
          <p
            id={errorId}
            role="alert"
            className={cn(
              "text-small text-danger leading-[var(--leading-prose)]",
              // Errors appear mid-interaction — settle them in rather than snap.
              "animate-[settings-pane-in_var(--motion-fast)_var(--ease-out-soft)_backwards]",
            )}
          >
            {error}
          </p>
        )}
      </div>
    )
  },
)
