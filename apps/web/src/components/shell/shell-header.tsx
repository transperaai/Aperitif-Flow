import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/** The bar above every page inside the shell but the map (which has its own top bar): the sidebar toggle and the page's name. */
export function ShellHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
    </header>
  );
}
