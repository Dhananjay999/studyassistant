import { motion } from "framer-motion";
import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const { signInWithGoogle, loading } = useAuth();

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-violet-50 via-sky-50 to-emerald-50 px-4 dark:from-violet-950 dark:via-slate-950 dark:to-emerald-950">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex w-full max-w-md flex-col items-center gap-8 rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80"
      >
        <motion.div
          animate={{ rotate: [0, 5, -5, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-white shadow-lg"
        >
          <BookOpen className="h-10 w-10" />
        </motion.div>

        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Aeva
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your AI study buddy — ask from your notes or the web
          </p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <Button
            size="lg"
            className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-sky-600 text-base font-semibold shadow-md hover:from-violet-700 hover:to-sky-700"
            onClick={signInWithGoogle}
            disabled={loading}
          >
            <Sparkles className="h-5 w-5" />
            Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Sign in to save your chats and study materials
          </p>
        </div>
      </motion.div>

      <div className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-violet-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-20 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
    </div>
  );
}
