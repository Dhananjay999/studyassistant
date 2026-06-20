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
  const { signInWithGoogle } = useAuth();
  return (
    <button
      type="button"
      onClick={signInWithGoogle}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-full p-[1.5px]",
        "bg-[length:200%_200%] bg-brand-gradient motion-loop animate-gradient-pan shadow-glow",
        "transition-transform hover:scale-[1.02] active:scale-95",
        className,
      )}
    >
      <span className="inline-flex items-center gap-2.5 rounded-full bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors group-hover:bg-background/85">
        <FcGoogle className="h-5 w-5" />
        {label}
      </span>
    </button>
  );
}
