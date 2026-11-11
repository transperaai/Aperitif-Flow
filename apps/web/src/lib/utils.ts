import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Extended so product tokens (`rounded-token`, `shadow-token`, `text-2xs`) dedupe against shadcn's utilities.
const twMerge = extendTailwindMerge({ extend: { theme: { radius: ["token"], shadow: ["token"], text: ["2xs"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
