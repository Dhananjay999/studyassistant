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
    signingInMethod,
    popupSignIn,
    signInIssue,
    signInWithGoogle,
    signInWithRedirect,
    cancelSignIn,
    dismissSignInIssue,
  } = useAuth();
  const copy = signInIssue ? issueCopy(signInIssue) : null;
  // Leaving this tab for Google: nothing to cancel, and no popup to point at.
  const leaving = signingInMethod === "redirect";
  return (
    <>
      <Dialog open={signingIn}>
        <DialogContent
          className="max-w-xs border-0 bg-transparent p-0 shadow-none [&>button]:hidden"
          // Only the Cancel button dismisses it while the popup is open.
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Signing you in</DialogTitle>
          <div className="glass-strong flex flex-col items-center gap-4 rounded-2xl p-8 text-center shadow-glow-lg">
            <BrandLogo withWordmark={false} className="animate-float scale-125" />
            <div>
              <p className="font-display font-semibold">Signing you in…</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {leaving
                  ? "Taking you to Google to sign in…"
                  : "Complete the Google sign-in in the popup window."}
              </p>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {!leaving && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 px-6"
                data-analytics-name="Sign in cancel"
                onClick={cancelSignIn}
              >
                Cancel
              </Button>
            )}
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
          {/* The same-tab sign-in is the primary way on: it is the flow
              that works everywhere. The popup retry is only offered where
              the popup is in use. */}
          <div className="flex flex-col gap-2">
            <Button
              variant="brand"
              className="min-h-11"
              data-analytics-name="Sign in in this tab"
              onClick={signInWithRedirect}
            >
              {popupSignIn ? "Sign in in this tab" : "Try again"}
            </Button>
            {popupSignIn && (
              <Button
                variant="outline"
                className="min-h-11"
                data-analytics-name="Sign in try again"
                onClick={signInWithGoogle}
              >
                Try the popup again
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
