import * as React from "react"
import { cn } from "@/lib/utils"

/** A browser `<select>` in the shadcn input style: it posts in plain forms and Server Actions, unlike the Radix Select. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 dark:[&>option]:bg-popover",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
