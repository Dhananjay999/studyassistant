import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AuroraBackground } from "@/components/common/AuroraBackground";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Seo } from "@/components/common/Seo";

export default function NotFound() {
  return (
    <>
      <Seo title="Page not found — Aeva" noindex path="/404" />
      <div className="relative grid h-dvh place-items-center overflow-hidden bg-background">
        <AuroraBackground />
        <div className="text-center">
          <BrandLogo className="mb-6 justify-center" />
          <h1 className="font-display text-7xl font-extrabold">
            <span className="text-gradient">404</span>
          </h1>
          <p className="mt-3 text-muted-foreground">
            This page wandered off to study somewhere else.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/">Back home</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
