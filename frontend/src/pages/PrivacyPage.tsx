import { Seo } from "@/components/common/Seo";
import { PublicPage } from "@/components/landing/PublicPage";
import { PAGES, breadcrumbSchema } from "@/lib/seo";

export default function PrivacyPage() {
  return (
    <>
      <Seo
        title={PAGES.privacy.title}
        description={PAGES.privacy.description}
        path={PAGES.privacy.path}
        jsonLd={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Privacy Policy", path: "/privacy" },
        ])}
      />
      <PublicPage
        title="Privacy Policy"
        intro="How StudyAssistant collects, uses, and protects your data."
      >
        <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display">
          <h2>Information we collect</h2>
          <p>
            When you sign in with Google we receive your name, email address, and
            profile picture to create your account. As you use StudyAssistant we
            store the content you create — sessions, messages, uploaded documents,
            quizzes, flashcards, and bookmarks — so you can return to it later.
          </p>

          <h2>How we use your information</h2>
          <p>
            We use your data to provide the service: answering your questions,
            processing your uploads, generating quizzes and flashcards, and
            personalizing explanations to your learning profile. We do not sell
            your personal data.
          </p>

          <h2>Your content is private</h2>
          <p>
            Your sessions, uploads, quizzes, and flashcards are tied to your
            account and only accessible to you. Access is enforced per-account on
            every request.
          </p>

          <h2>Third-party services</h2>
          <p>
            We rely on trusted providers to operate — including cloud hosting,
            authentication, and AI model providers that process your queries to
            generate responses. These providers process data only to deliver the
            service.
          </p>

          <h2>Data retention and deletion</h2>
          <p>
            Your content is retained while your account is active. Deleting an
            item removes it and its associated files; deleting your account
            removes your data.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about privacy? Reach us at{" "}
            <a href="mailto:privacy@studyassistant.app">
              privacy@studyassistant.app
            </a>
            .
          </p>
        </div>
      </PublicPage>
    </>
  );
}
