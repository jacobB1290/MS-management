import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 select-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        cta: "btn-cta",
        secondary: "btn-cta btn-cta--secondary",
        danger: "btn-cta btn-cta--danger",
        ghost:
          "text-ink hover:bg-surface rounded-md font-medium tracking-wide",
        link:
          "text-gold hover:underline underline-offset-4 font-medium bg-transparent",
      },
      size: {
        sm: "min-h-8 px-3 text-[var(--text-label)]",
        md: "min-h-11 px-5 text-[var(--text-small)]",
        icon: "h-11 w-11 p-0",
      },
    },
    compoundVariants: [
      {
        variant: "cta",
        size: "sm",
        className: "min-h-8 px-4 py-1.5",
      },
      {
        variant: "secondary",
        size: "sm",
        className: "min-h-8 px-4 py-1.5",
      },
      {
        variant: "danger",
        size: "sm",
        className: "min-h-8 px-4 py-1.5",
      },
      {
        variant: "cta",
        size: "icon",
        className: "p-0",
      },
      {
        variant: "secondary",
        size: "icon",
        className: "p-0",
      },
    ],
    defaultVariants: {
      variant: "cta",
      size: "md",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

type SlottableChild = React.ReactElement<{
  className?: string
  children?: React.ReactNode
}>

function isSlottableChild(node: React.ReactNode): node is SlottableChild {
  return React.isValidElement(node)
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, asChild = false, children, ...props },
    ref,
  ) {
    const classes = cn(buttonVariants({ variant, size }), className)

    if (asChild && isSlottableChild(children)) {
      const child = children
      return React.cloneElement(child, {
        className: cn(classes, child.props.className),
        ...props,
      } as Partial<typeof child.props>)
    }

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    )
  },
)

export { buttonVariants }
