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
        <div className="flex flex-col items-center gap-1 sm:items-start">
          <BrandLogo />
          <p className="text-xs text-muted-foreground">
            The free AI study assistant for students.
          </p>
        </div>
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
          © {year} StudyAssistant. Study smarter.
        </p>
      </div>
    </footer>
  );
}
