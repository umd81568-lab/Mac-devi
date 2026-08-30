import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Box, ChevronRight, Clapperboard, FolderKanban, Gauge, Image, Menu, Mic2, MonitorPlay, PhoneCall, Settings2, Sparkles, X } from "lucide-react";

const navItems = [
  { href: "/", label: "Command center", icon: Gauge },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/models", label: "Models", icon: Box },
  { href: "/voice", label: "Voice", icon: Mic2 },
  { href: "/live", label: "Live call", icon: PhoneCall },
  { href: "/images", label: "Images", icon: Image },
  { href: "/avatar", label: "Avatar", icon: Clapperboard },
  { href: "/render", label: "Render", icon: MonitorPlay },
];

export function StudioShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => href === "/" ? location === "/" : location.startsWith(href);
  return (
    <div className="studio-noise min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 transition-transform duration-300 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-10 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="grid h-9 w-9 place-items-center rounded-sm bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/.18)]"><Sparkles size={17} /></span>
            <span><span className="block font-serif text-[15px] font-bold tracking-tight">LOCAL AI</span><span className="mono-label text-muted-foreground">STUDIO / 01</span></span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent lg:hidden" aria-label="Close navigation" data-testid="button-close-navigation"><X size={18} /></button>
        </div>
        <p className="mono-label mb-3 px-3 text-muted-foreground/60">Workspace</p>
        <nav className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(" ", "-")}`} className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors ${isActive(href) ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`}>
              <Icon size={17} className={isActive(href) ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} />
              <span>{label}</span>
              {isActive(href) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1">
          <Link href="/settings" data-testid="link-nav-settings" className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors ${isActive("/settings") ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"}`}><Settings2 size={17} /><span>Settings</span></Link>
          <div className="mt-4 border-t border-sidebar-border pt-4">
            <div className="flex items-center gap-3 rounded-md px-3 py-2">
              <div className="grid h-8 w-8 place-items-center rounded-full border border-accent/40 bg-accent/10 font-mono text-[11px] text-accent">AS</div>
              <div className="min-w-0"><p className="truncate text-[12px] font-semibold">Apple Silicon</p><p className="mono-label text-muted-foreground">Local runtime</p></div>
              <span className="ml-auto h-2 w-2 rounded-full bg-accent" />
            </div>
          </div>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu" data-testid="button-dismiss-navigation" />}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/70 bg-background/85 px-5 backdrop-blur-xl lg:px-8">
          <button onClick={() => setOpen(true)} className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Apple Silicon workspace <span className="text-border">/</span> <span className="font-mono text-[10px]">METAL · MLX · 64 GB PROFILE</span></div>
          <div className="ml-auto flex items-center gap-2"><Link href="/settings" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="link-header-settings"><Activity size={16} /></Link><span className="rounded-sm border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">⌘ K</span></div>
        </header>
        <main className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-5 py-7 lg:px-8 lg:py-9">
          <div className="studio-grid pointer-events-none absolute inset-x-0 top-0 h-[340px] opacity-30" />
          <div className="relative mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border/80 pb-7 md:flex-row md:items-end"><div><p className="mono-label mb-2 text-primary">{eyebrow}</p><h1 className="font-serif text-3xl font-bold tracking-[-.04em] text-foreground md:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</div>;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><h2 className="mono-label text-muted-foreground">{children}</h2>{right}</div>;
}

export function StatusPill({ status }: { status: string }) {
  const tone = status === "ready" || status === "installed" || status === "complete" || status === "connected" || status === "pass" ? "text-accent bg-accent/10 border-accent/20" : status === "attention" || status === "warning" || status === "needs-review" || status === "failed" || status === "error" ? "text-amber-300 bg-amber-400/10 border-amber-300/20" : status === "offline" || status === "cancelled" ? "text-red-300 bg-red-400/10 border-red-300/20" : "text-primary bg-primary/10 border-primary/20";
  return <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[.1em] ${tone}`} data-testid={`status-${status}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status.replaceAll("-", " ")}</span>;
}

export function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = { primary: "bg-primary text-primary-foreground hover:brightness-110", secondary: "border border-border bg-secondary text-foreground hover:bg-muted", ghost: "text-muted-foreground hover:bg-muted hover:text-foreground", danger: "border border-destructive/30 bg-destructive/10 text-red-200 hover:bg-destructive/20" };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2.5 text-xs font-semibold transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${props.className ?? ""}`} />;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-14 text-center"><div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary"><Sparkles size={16} /></div><h3 className="font-serif text-lg font-bold">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3" aria-label="Loading"><div className="h-5 w-40 animate-pulse rounded bg-muted" />{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted/70" />)}</div>;
}

export function ErrorState({ message = "The local service did not return a response.", retry }: { message?: string; retry?: () => void }) {
  return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-6 py-10 text-center"><p className="font-semibold text-red-200">Workspace connection interrupted</p><p className="mt-1 text-sm text-red-200/70">{message}</p>{retry && <Button variant="danger" onClick={retry} className="mt-5">Retry connection</Button>}</div>;
}

export function Metric({ label, value, detail, accent = false }: { label: string; value: string | number; detail?: string; accent?: boolean }) {
  return <div className={`panel-cut border p-5 ${accent ? "border-primary/35 bg-primary/[.07]" : "border-border bg-card"}`}><p className="mono-label text-muted-foreground">{label}</p><p className={`metric-number mt-3 text-4xl font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>{detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}</div>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back"><ChevronRight size={14} className="rotate-180" />{children}</Link>;
}