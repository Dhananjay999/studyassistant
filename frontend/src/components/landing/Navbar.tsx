import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/common/BrandLogo";
import { GoogleButton } from "@/components/landing/GoogleButton";

// Mix of real pages (crawlable internal links) and landing-section anchors.
const LINKS = [
  { href: "/features", label: "Features", page: true },
  { href: "/#how", label: "How it works", page: false },
  { href: "/#faq", label: "FAQ", page: false },
  { href: "/about", label: "About", page: true },
];

function NavLink({
  link,
  className,
  onClick,
}: {
  link: (typeof LINKS)[number];
  className: string;
  onClick?: () => void;
}) {
  return link.page ? (
    <Link to={link.href} className={className} onClick={onClick}>
      {link.label}
    </Link>
  ) : (
    <a href={link.href} className={className} onClick={onClick}>
      {link.label}
    </a>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="container mt-3">
        <nav
          aria-label="Primary"
          className="glass flex items-center justify-between rounded-2xl px-4 py-2.5"
        >
          <Link to="/" aria-label="StudyAssistant home">
            <BrandLogo />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <NavLink
                key={l.href}
                link={l}
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              />
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <GoogleButton label="Get started free" />
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader className="sr-only">
                  <SheetTitle>Menu</SheetTitle>
                  <SheetDescription>Site navigation links</SheetDescription>
                </SheetHeader>
                <nav aria-label="Mobile" className="mt-6 flex flex-col gap-2">
                  {LINKS.map((l) => (
                    <NavLink
                      key={l.href}
                      link={l}
                      onClick={() => setOpen(false)}
                      className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    />
                  ))}
                  <div className="mt-3">
                    <GoogleButton className="w-full" label="Get started free" />
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </nav>
      </div>
    </header>
  );
}
