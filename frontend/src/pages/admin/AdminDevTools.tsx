// Device-local developer toggles. Everything here writes ONLY to this
// browser's localStorage — flipping a switch affects the admin's own device
// and never any other user. Used to validate the native-app (WebView)
// experience before the real app exists to set the flag itself.

import { useState } from "react";
import { toast } from "sonner";
import { LogIn, RotateCcw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  hasSeenAppOnboarding,
  isAppMode,
  resetAppOnboarding,
  setAppModeFlag,
} from "@/lib/appMode";
import { hasDismissedAuthPrompt, resetAuthPrompt } from "@/lib/authPrompt";

export function AdminDevTools() {
  const [appMode, setAppMode] = useState(isAppMode);
  const [onboardingSeen, setOnboardingSeen] = useState(hasSeenAppOnboarding);

  const toggleAppMode = (enabled: boolean) => {
    setAppModeFlag(enabled);
    setAppMode(enabled);
    toast.success(
      enabled
        ? "App-mode flag added on this device. Open the home page (/) while logged out to see the app entry flow."
        : "App-mode flag removed on this device.",
    );
  };

  const resetOnboarding = () => {
    resetAppOnboarding();
    setOnboardingSeen(false);
    toast.success("App onboarding will show again on this device.");
  };

  const [promptDismissed, setPromptDismissed] = useState(
    hasDismissedAuthPrompt,
  );
  const resetPrompt = () => {
    resetAuthPrompt();
    setPromptDismissed(false);
    toast.success(
      "Sign-in prompt reset. Open the home page (/) while logged out to see it again.",
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Dev Tools</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Device-local testing switches. These write to THIS browser's
          localStorage only — no other user is affected.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 h-5 w-5 text-brand-1" />
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Native app mode
                  <Badge variant={appMode ? "secondary" : "outline"}>
                    {appMode ? "Flag set" : "Not set"}
                  </Badge>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sets <code>is_open_from_app=true</code> — the flag the mobile
                  app's WebView will set. Enables the app entry screen,
                  onboarding, and app-mode UI polish on this device.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {appMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAppMode(false)}
              >
                Remove flag
              </Button>
            ) : (
              <Button size="sm" onClick={() => toggleAppMode(true)}>
                Add flag on this device
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={resetOnboarding}
              disabled={!onboardingSeen}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {onboardingSeen
                ? "Re-show app onboarding"
                : "Onboarding not seen yet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <LogIn className="mt-0.5 h-5 w-5 text-brand-1" />
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                Sign-in prompt
                <Badge variant={promptDismissed ? "secondary" : "outline"}>
                  {promptDismissed ? "Dismissed" : "Not dismissed"}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The login / sign-up popup on the public pages shows once and
                never again after a dismissal (or a login) on this device.
                Reset it to test the triggers again.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetPrompt}
              disabled={!promptDismissed}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {promptDismissed
                ? "Re-show sign-in prompt"
                : "Prompt not dismissed yet"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
