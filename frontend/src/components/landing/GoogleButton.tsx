import { Loader2 } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

/** Primary CTA with an animated gradient border that runs continuously. */
export function GoogleButton({
  label = "Continue with Google",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { signInWithGoogle, signingIn } = useAuth();
  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      disabled={signingIn}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-full p-[1.5px]",
        "bg-[length:200%_200%] bg-brand-gradient motion-loop animate-gradient-pan shadow-glow",
        "transition-transform hover:scale-[1.02] active:scale-95",
        "disabled:cursor-not-allowed disabled:opacity-80",
        className,
      )}
    >
      <span className="inline-flex items-center gap-2.5 rounded-full bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors group-hover:bg-background/85">
        {signingIn ? (
          <Loader2 className="h-5 w-5 animate-spin text-brand-1" />
        ) : (
          <FcGoogle className="h-5 w-5" />
        )}
        {signingIn ? "Signing you in…" : label}
      </span>
    </button>
  );
}
