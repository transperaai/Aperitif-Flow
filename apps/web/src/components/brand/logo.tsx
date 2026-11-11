/* eslint-disable @next/next/no-img-element -- static SVGs from public/brand: nothing for the image optimiser to do. */
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The product logo: the client's wordmark from public/brand/logo.svg, then `BRAND.logoSuffix`. Every place that shows the
 * product's logo uses this (or `LogoMark`), so replacing the files in public/brand swaps it everywhere (docs/brand.md).
 * The logo's own colours are opaque, so it reads on light and dark themes; no accent or theme token recolours it.
 * With `collapsible`, the sidebar's icon-only state shows the square mark instead.
 */
export function Logo({ className, collapsible = false }: { className?: string; collapsible?: boolean }) {
  return (
    <span data-brand-logo="" className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <img
        src={BRAND.logo.src}
        width={BRAND.logo.width}
        height={BRAND.logo.height}
        alt={BRAND.logo.alt}
        className={cn("h-[22px] w-auto shrink-0", collapsible && "group-data-[collapsible=icon]:hidden")}
      />
      {collapsible && <LogoMark className="hidden group-data-[collapsible=icon]:block" alt={BRAND.name} />}
      {BRAND.logoSuffix && (
        <span className={cn("truncate font-display text-base font-bold tracking-tight", collapsible && "group-data-[collapsible=icon]:hidden")}>
          {BRAND.logoSuffix}
        </span>
      )}
    </span>
  );
}

/** The square mark (public/brand/mark.svg), for spots too small or too square for the wide logo. */
export function LogoMark({ className, alt = "" }: { className?: string; alt?: string }) {
  return (
    <img
      data-brand-mark=""
      src={BRAND.mark.src}
      width={BRAND.mark.width}
      height={BRAND.mark.height}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={cn("size-[22px] shrink-0 rounded-md", className)}
    />
  );
}
