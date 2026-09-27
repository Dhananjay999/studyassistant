import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/common/BrandLogo";
import { useAuth, type SignInIssue } from "@/contexts/AuthContext";

function issueCopy(issue: SignInIssue): { title: string; body: string } {
  if (issue.kind === "abandoned" || issue.reason === "access_denied") {
    return {
      title: "Sign-in didn't finish",
      body: "The Google window closed before sign-in was complete, so you're not signed in yet.",
    };
  }
  return {
    title: "We couldn't sign you in",
    body: "Something went wrong while signing you in with Google. Please try again.",
  };
}

export function SigningInModal() {
  const {
    signingIn,
    signInIssue,
    signInWithGoogle,
    signInWithRedirect,
    dismissSignInIssue,
  } = useAuth();
  const copy = signInIssue ? issueCopy(signInIssue) : null;
  return (
    <>
      <Dialog open={signingIn}>
        <DialogContent
          className="max-w-xs border-0 bg-transparent p-0 shadow-none [&>button]:hidden"
          // Non-dismissable while the popup is open.
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Signing you in</DialogTitle>
          <div className="glass-strong flex flex-col items-center gap-4 rounded-2xl p-8 text-center shadow-glow-lg">
            <BrandLogo withWordmark={false} className="animate-float scale-125" />
            <div>
              <p className="font-display font-semibold">Signing you in…</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Complete the Google sign-in in the popup window.
              </p>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>

      {/* The attempt ended without a session: say so and offer a way on. */}
      <Dialog
        open={!!signInIssue && !signingIn}
        onOpenChange={(open) => {
          if (!open) dismissSignInIssue();
        }}
        analyticsName="Sign in issue"
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.body}</DialogDescription>
          <div className="flex flex-col gap-2">
            <Button
              variant="brand"
              data-analytics-name="Sign in try again"
              onClick={signInWithGoogle}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              data-analytics-name="Sign in in this tab"
              onClick={signInWithRedirect}
            >
              Sign in in this tab instead
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
