import { Link } from "react-router-dom";
import { BrandLogo } from "@/components/common/BrandLogo";

const LINKS = [
  { to: "/features", label: "Features" },
  { to: "/about", label: "About" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
        <BrandLogo />
        <nav
          aria-label="Footer"
          className="flex items-center gap-5 text-sm text-muted-foreground"
        >
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground">
          © {year} Aeva. Study smarter.
        </p>
      </div>
    </footer>
  );
}
