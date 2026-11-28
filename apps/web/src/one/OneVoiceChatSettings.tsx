import { getCloudSpeechVoices } from "@t3tools/client-runtime/voice-input";
import { AuthOrchestrationOperateScope, type CloudSpeechVoiceModel } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";

import { useCloudRead } from "~/components/settings/CloudVoiceConfiguration";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import { useSearchableSetting } from "~/components/settings/settingsSearch";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import {
  readAloud,
  stopReadingAloud,
  useIsReadingAloud,
  useSpeechEngines,
} from "~/speech/readAloud";
import {
  READ_ALOUD_RATES,
  setReadAloudRate,
  setReadAloudVoice,
  SYSTEM_READ_ALOUD_VOICE,
  useReadAloudRate,
  useReadAloudVoice,
} from "~/speech/readAloudVoice";
import { listedSystemVoices, useSystemVoices } from "~/speech/systemVoices";
import { useAudioChoice } from "~/speech/voiceConsent";
import { useEnvironments, type EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentScope, usePreparedConnection } from "~/state/session";
import { setVoiceChatStyle, useVoiceChatStyle } from "./voiceChatPreferences";

const PREVIEW_ID = "settings-read-aloud-preview";
const AUTOMATIC = "automatic";
const DEVICE = "device";

/** "george" reads as "George"; ids such as "af_bella" keep their form. */
function voiceLabel(voice: string): string {
  return /^[a-z]+$/.test(voice) ? voice[0]!.toUpperCase() + voice.slice(1) : voice;
}

/** "Eddy (English (United States))" reads as "Eddy"; the language code shows beside it. */
function deviceVoiceName(voice: SpeechSynthesisVoice): string {
  return voice.name.replace(/\s*\(.*\)\s*$/, "").trim() || voice.name;
}

type CloudVoiceEnvironment = Pick<EnvironmentPresentation, "environmentId" | "label">;

/** The OpenRouter voices one environment can read with, read when the picker is shown. */
function useCloudVoiceModels(
  environment: CloudVoiceEnvironment | null,
): ReadonlyArray<CloudSpeechVoiceModel> {
  const id = environment?.environmentId ?? null;
  const prepared = Option.getOrNull(usePreparedConnection(id));
  const canUse = useEnvironmentScope(id, AuthOrchestrationOperateScope);
  const [result] = useCloudRead(canUse ? prepared : null, getCloudSpeechVoices);
  return AsyncResult.isSuccess(result) ? (result.value?.models ?? []) : [];
}

/** Settings for how replies are read aloud, by the Read aloud button and in voice chat. */
export function OneVoiceChatSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const style = useVoiceChatStyle();
  const voice = useReadAloudVoice();
  const rate = useReadAloudRate();
  const systemVoices = useSystemVoices();
  const engines = useSpeechEngines();
  const previewing = useIsReadingAloud(PREVIEW_ID);
  const { environments } = useEnvironments();
  const audioChoice = useAudioChoice();
  const transcriptionDestination =
    audioChoice === null || audioChoice === "off" ? null : audioChoice.destination;
  // OpenRouter voices use the key saved for OpenRouter transcription, so that environment comes first.
  const keyEnvironmentId =
    transcriptionDestination?.kind === "cloud" && transcriptionDestination.provider === "openrouter"
      ? transcriptionDestination.environmentId
      : null;
  const canSpeak = (environment: (typeof environments)[number]) =>
    environment.serverConfig?.environment.capabilities.cloudSpeechSynthesis === true;
  const speaker =
    environments.find(
      (environment) => environment.environmentId === keyEnvironmentId && canSpeak(environment),
    ) ??
    environments.find(canSpeak) ??
    null;
  const cloudModels = useCloudVoiceModels(speaker);
  const language =
    typeof document === "undefined"
      ? "en"
      : document.documentElement.lang || navigator.language || "en";
  const deviceVoices = listedSystemVoices(systemVoices, language);

  const activeModel =
    voice.kind === "cloud" ? (cloudModels.find((model) => model.id === voice.model) ?? null) : null;
  const sourceKey = voice.kind === "cloud" ? voice.model : DEVICE;
  const sourceLabel =
    voice.kind === "cloud" ? (activeModel?.name ?? voice.model) : gt("This device");
  const chooseSource = (key: string | null) => {
    if (key === null) return;
    if (key === DEVICE) {
      setReadAloudVoice(SYSTEM_READ_ALOUD_VOICE);
      return;
    }
    const model = cloudModels.find((option) => option.id === key);
    const first = model?.voices[0];
    if (!model || first === undefined || speaker === null) return;
    // Keep the voice when the new model has one by the same name.
    const kept = voice.kind === "cloud" && model.voices.includes(voice.voice) ? voice.voice : first;
    setReadAloudVoice({
      kind: "cloud",
      environmentId: speaker.environmentId,
      model: model.id,
      voice: kept,
      format: model.format,
    });
  };
  const chosenDevice =
    voice.kind === "system"
      ? deviceVoices.find((device) => device.voiceURI === voice.voiceURI)
      : undefined;
  const voiceValue = voice.kind === "cloud" ? voice.voice : (voice.voiceURI ?? AUTOMATIC);
  const voiceText =
    voice.kind === "cloud"
      ? voiceLabel(voice.voice)
      : voice.voiceURI === null
        ? gt("Best on this device")
        : chosenDevice
          ? `${deviceVoiceName(chosenDevice)} (${chosenDevice.lang})`
          : gt("A voice this device no longer lists");
  const chooseVoice = (value: string | null) => {
    if (value === null) return;
    if (voice.kind === "cloud") setReadAloudVoice({ ...voice, voice: value });
    else setReadAloudVoice({ kind: "system", voiceURI: value === AUTOMATIC ? null : value });
  };

  return (
    <SettingsSection id="voice-chat" title={gt("Reading aloud")}>
      <SettingsRow
        {...searchableSetting("setting-read-aloud-voice")}
        devicePreference
        description={
          voice.kind === "cloud"
            ? gt(
                "Each reply’s text goes to OpenRouter through {environment}, with zero data retention. If it fails, this device’s voice reads instead.",
                { environment: speaker?.label ?? gt("the environment") },
              )
            : speaker !== null && cloudModels.length > 0
              ? gt("Used by Read aloud and voice chat. OpenRouter voices sound more natural.")
              : gt(
                  "Used by Read aloud and voice chat. OpenRouter voices sound more natural; save an OpenRouter key under Transcription to use them.",
                )
        }
        control={
          <Select value={sourceKey} onValueChange={chooseSource}>
            <SelectTrigger size="sm" aria-label={gt("Read-aloud voice")} className="max-w-72">
              <SelectValue>{sourceLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value={DEVICE}>{gt("This device")}</SelectItem>
              {cloudModels.length > 0 ? (
                <SelectGroup>
                  <SelectGroupLabel>OpenRouter</SelectGroupLabel>
                  {cloudModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {voice.kind === "cloud" && activeModel === null ? (
                <SelectItem value={voice.model} disabled>
                  {voice.model}
                </SelectItem>
              ) : null}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title={gt("Voice", { $context: "the speaker voice that reads replies aloud" })}
        devicePreference
        control={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={previewing}
              onClick={() => {
                if (previewing) stopReadingAloud();
                else
                  readAloud(
                    PREVIEW_ID,
                    gt("Hi. This is how your replies will sound when they are read aloud."),
                    engines(),
                  );
              }}
            >
              {previewing ? gt("Stop") : gt("Play sample")}
            </Button>
            <Select value={voiceValue} onValueChange={chooseVoice}>
              <SelectTrigger
                size="sm"
                aria-label={gt("Voice", { $context: "the speaker voice that reads replies aloud" })}
                className="max-w-72"
              >
                <SelectValue>{voiceText}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {voice.kind === "cloud" ? (
                  (activeModel?.voices ?? [voice.voice]).map((name) => (
                    <SelectItem key={name} value={name}>
                      {voiceLabel(name)}
                    </SelectItem>
                  ))
                ) : (
                  <>
                    <SelectItem value={AUTOMATIC}>{gt("Best on this device")}</SelectItem>
                    {deviceVoices.map((device) => (
                      <SelectItem key={device.voiceURI} value={device.voiceURI}>
                        <span className="flex items-baseline gap-2">
                          <span>{deviceVoiceName(device)}</span>
                          <span className="text-xs text-muted-foreground">{device.lang}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("setting-read-aloud-speed")}
        devicePreference
        description={gt("How fast replies are read.")}
        control={
          <Select
            value={String(rate)}
            onValueChange={(value) => {
              const next = READ_ALOUD_RATES.find((option) => String(option) === value);
              if (next !== undefined) setReadAloudRate(next);
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Reading speed")} className="max-w-72">
              <SelectValue>
                {rate === 1 ? gt("Normal") : gt("{rate}×", { rate: String(rate) })}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {READ_ALOUD_RATES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option === 1 ? gt("Normal") : gt("{rate}×", { rate: String(option) })}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("setting-voice-chat-conqueror")}
        devicePreference
        description={gt(
          "Reads replies in a deeper, slower voice. Applies to this device’s voices.",
        )}
        control={
          <Switch
            checked={style === "conqueror"}
            onCheckedChange={(checked) => setVoiceChatStyle(checked ? "conqueror" : "natural")}
            aria-label={gt("Conqueror voice")}
          />
        }
      />
    </SettingsSection>
  );
}
