import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BrandLogo } from "@/components/common/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";

export function SigningInModal() {
  const { signingIn } = useAuth();
  return (
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
  );
}
