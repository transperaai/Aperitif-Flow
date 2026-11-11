import * as React from "react"
import { cn } from "@/lib/utils"
import { inputClassName } from "./input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputClassName, "h-auto min-h-16 py-1.5", className)} {...props} />
}

export { Textarea }
