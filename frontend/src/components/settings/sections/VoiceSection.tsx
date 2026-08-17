import {
  SegmentedControl,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/primitives";
import {
  usePreferences,
  type VoiceLang,
} from "@/contexts/PreferencesContext";

const VOICE_LANG_OPTIONS: ReadonlyArray<{ value: VoiceLang; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "en-IN", label: "English" },
  { value: "hi-IN", label: "हिंदी" },
];

/** Voice input (microphone dictation) preferences. */
export function VoiceSection() {
  const { voiceLang, setVoiceLang } = usePreferences();

  return (
    <div className="space-y-6">
      <SettingsGroup title="Voice language">
        <div className="divide-y divide-border/50 px-4">
          <SettingRow
            title="Recognition language"
            description="Language Aeva listens for when you use the microphone. Auto follows your device language; English also understands Hinglish."
          >
            <SegmentedControl
              ariaLabel="Voice language"
              options={VOICE_LANG_OPTIONS}
              value={voiceLang}
              onChange={setVoiceLang}
            />
          </SettingRow>
        </div>
      </SettingsGroup>
      <p className="px-1 text-xs text-muted-foreground">
        Voice input turns speech into text in the message box — nothing is
        sent until you press Send. Speech recognition runs in your browser
        and needs an internet connection.
      </p>
    </div>
  );
}
