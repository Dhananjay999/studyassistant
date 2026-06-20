import { BrandLogo } from "@/components/common/BrandLogo";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
        <BrandLogo />
        <nav className="flex items-center gap-5 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
        </nav>
        <p className="text-xs text-muted-foreground">
          © {year} Aeva. Study smarter.
        </p>
      </div>
    </footer>
  );
}
