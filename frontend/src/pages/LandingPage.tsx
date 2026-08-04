import { Seo } from "@/components/common/Seo";
import { SkipToContent } from "@/components/common/SkipToContent";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { RevisionShowcase } from "@/components/landing/RevisionShowcase";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { WhatIs } from "@/components/landing/WhatIs";
import { Faq, FAQS } from "@/components/landing/Faq";
import { CtaBand } from "@/components/landing/CtaBand";
import { Footer } from "@/components/landing/Footer";
import {
  PAGES,
  faqSchema,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/seo";

export default function LandingPage() {
  return (
    <>
      <Seo
        title={PAGES.home.title}
        description={PAGES.home.description}
        keywords={PAGES.home.keywords}
        path={PAGES.home.path}
        jsonLd={[
          organizationSchema(),
          websiteSchema(),
          softwareApplicationSchema(),
          faqSchema(FAQS),
        ]}
      />
      <div className="relative min-h-dvh bg-background">
        <SkipToContent />
        <Navbar />
        <main id="main">
          <Hero />
          <Features />
          <RevisionShowcase />
          <HowItWorks />
          <WhatIs />
          <Faq />
          <CtaBand />
        </main>
        <Footer />
      </div>
    </>
  );
}
