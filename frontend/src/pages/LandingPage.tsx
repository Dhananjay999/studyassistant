import { Seo } from "@/components/common/Seo";
import { IntroLoader } from "@/components/common/IntroLoader";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
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
      <IntroLoader onDone={() => undefined} />
      <div className="relative min-h-dvh bg-background">
        <Navbar />
        <main>
          <Hero />
          <Features />
          <HowItWorks />
          <Faq />
          <CtaBand />
        </main>
        <Footer />
      </div>
    </>
  );
}
