import {
  CloudSpeechApiKey,
  CloudSpeechError,
  CloudSpeechModel,
  CloudSpeechModelId,
  CloudSpeechVoiceId,
  SettingsSecretValue,
  isSecretReference,
  type SecretReference,
  type ServerSettingsError,
  type CloudSpeechKeys,
  type CloudSpeechAudioFormat,
  type CloudSpeechProvider,
  type CloudSpeechSynthesisRequest,
  type CloudSpeechVoiceModel,
  EnvironmentSpeechTranscriptionResult,
  type SpeechTranscriptionOptions,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import { cloudSpeechLanguages, effectiveSpeechLanguage } from "@t3tools/shared/speech";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as ServerSettings from "../serverSettings.ts";
import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import { applySpeechAliases, speechRecognitionWords } from "./customWords.ts";
import { removeSpeechFillerWords } from "./fillerWords.ts";
import { decodeSpeechPcm, SpeechInvalidAudioError } from "./SpeechService.ts";

const endpoints = {
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-transcribe" },
  xai: { url: "https://api.x.ai/v1/stt", model: "grok-voice-transcribe-2.0" },
  openrouter: { url: "https://openrouter.ai/api/v1/audio/transcriptions" },
};
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const OPENROUTER_VOICE_CATALOG_URL = "https://openrouter.ai/api/v1/audio/speech/models?zdr=true";
const OPENROUTER_CATALOG_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=transcription&zdr=true";
const isApiKey = Schema.is(CloudSpeechApiKey);
const isModelId = Schema.is(CloudSpeechModelId);
const isVoiceId = Schema.is(CloudSpeechVoiceId);
const sameCredential = Schema.toEquivalence(SettingsSecretValue);
const OpenRouterCatalog = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) })),
});

const OpenRouterParameter = Schema.Struct({
  type: Schema.String,
  values: Schema.optionalKey(Schema.Array(Schema.String)),
});
const OpenRouterSpeechModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  output_modalities: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      supported_parameters: Schema.optionalKey(
        Schema.Struct({
          voice: Schema.optionalKey(OpenRouterParameter),
          response_format: Schema.optionalKey(OpenRouterParameter),
        }),
      ),
    }),
  ),
});
// One malformed entry must not hide the rest of the catalog.
const OpenRouterSpeechCatalog = Schema.Struct({ data: Schema.Array(Schema.Unknown) });
const decodeSpeechModel = Schema.decodeUnknownOption(OpenRouterSpeechModel);

/** A model OpenRouter lists with named voices and a format the client can play, else undefined. */
function playableSpeechModel(entry: unknown): CloudSpeechVoiceModel | undefined {
  const model = Option.getOrUndefined(decodeSpeechModel(entry));
  const parameters = model?.output_modalities.find(
    ({ type }) => type === "speech",
  )?.supported_parameters;
  if (!model || !isModelId(model.id) || parameters?.voice?.type !== "enum") return undefined;
  const formats = parameters.response_format?.values ?? [];
  const format: CloudSpeechAudioFormat | undefined = formats.includes("mp3")
    ? "mp3"
    : formats.includes("wav")
      ? "wav"
      : undefined;
  const voices = (parameters.voice.values ?? []).filter(isVoiceId);
  return format && voices.length > 0
    ? { id: model.id, name: model.name?.trim() || model.id, format, voices }
    : undefined;
}

function wave(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (at: number, value: string) =>
    new Uint8Array(buffer, at, 4).set(new TextEncoder().encode(value));
  tag(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, buffer.byteLength - 44, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

function audioBody(
  provider: "openai" | "xai",
  audio: ArrayBuffer,
  language: string,
  options: SpeechTranscriptionOptions,
) {
  const form = new FormData();
  form.set("model", endpoints[provider].model);
  if (language !== "auto") form.set(provider === "openai" ? "languages[]" : "language", language);
  for (const term of speechRecognitionWords(
    options.speechHints,
    options.speechCustomWords.map(({ term }) => term),
  )) {
    if (provider === "openai" && /[<>\r\n]/.test(term)) continue;
    form.append(provider === "openai" ? "keywords[]" : "keyterm", term);
  }
  if (provider === "xai") {
    if (language !== "auto") form.set("format", "true");
    form.set(
      "filler_words",
      String(!options.speechRemoveFillerWords || Boolean(options.speechCorrectionWord)),
    );
    if (!options.speechSilenceFiltering) form.set("vad_threshold", "0");
  }
  // xAI ignores options that follow the file part.
  form.set("file", new Blob([audio], { type: "audio/wav" }), "dictation.wav");
  return HttpClientRequest.bodyFormData(form);
}

function openRouterBody(model: string, audio: ArrayBuffer, language: string) {
  return HttpClientRequest.bodyJsonUnsafe({
    model,
    input_audio: { data: Buffer.from(audio).toString("base64"), format: "wav" },
    ...(language !== "auto" ? { language } : {}),
    provider: { zdr: true },
  });
}

export class CloudSpeech extends Context.Service<
  CloudSpeech,
  {
    readonly configured: Effect.Effect<CloudSpeechKeys, ServerSettingsError>;
    /** OpenRouter's public transcription catalog, cached briefly on this server. */
    readonly models: Effect.Effect<ReadonlyArray<CloudSpeechModel>, CloudSpeechError>;
    /** OpenRouter's public speech catalog, reduced to models that name their voices and play back. */
    readonly voices: Effect.Effect<ReadonlyArray<CloudSpeechVoiceModel>, CloudSpeechError>;
    readonly setKey: (
      provider: CloudSpeechProvider,
      key: Redacted.Redacted<string> | SecretReference | null,
    ) => Effect.Effect<void, ServerSettingsError>;
    readonly transcribe: (
      provider: CloudSpeechProvider,
      pcm: Uint8Array,
      options: SpeechTranscriptionOptions,
      model?: string | undefined,
    ) => Effect.Effect<string, CloudSpeechError | SpeechInvalidAudioError | ServerSettingsError>;
    readonly speak: (
      request: CloudSpeechSynthesisRequest,
    ) => Effect.Effect<
      { readonly audio: Uint8Array; readonly format: CloudSpeechAudioFormat },
      CloudSpeechError | ServerSettingsError
    >;
  }
>()("t3/speech/CloudSpeech") {}

export const layer = Layer.effect(
  CloudSpeech,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const resolver = yield* SecretResolver.SecretResolver;
    const http = yield* HttpClient.HttpClient;
    const credentials = settings.getSettings.pipe(
      Effect.map((value) => value.cloudSpeechCredentials),
    );
    const configured = credentials.pipe(
      Effect.map(({ openai, xai, openrouter }) => ({
        openai: Boolean(openai),
        xai: Boolean(xai),
        openrouter: Boolean(openrouter),
      })),
    );
    const execute = (request: HttpClientRequest.HttpClientRequest) =>
      http
        .execute(request)
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        );
    const fetchCatalog = Effect.fn("CloudSpeech.catalog")(function* () {
      const unavailable = () =>
        new CloudSpeechError({ provider: "openrouter", reason: "unavailable" });
      const response = yield* execute(HttpClientRequest.get(OPENROUTER_CATALOG_URL)).pipe(
        Effect.mapError(unavailable),
      );
      if (response.status < 200 || response.status >= 300) return yield* unavailable();
      const { data } = yield* HttpClientResponse.schemaBodyJson(OpenRouterCatalog)(response).pipe(
        Effect.mapError(unavailable),
      );
      return data.flatMap(({ id, name }) =>
        isModelId(id) ? [{ id, name: name?.trim() || id }] : [],
      );
    });
    // The catalog is public, so the cache holds no credential or consent state.
    const models = yield* Effect.cachedWithTTL(
      fetchCatalog().pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(new CloudSpeechError({ provider: "openrouter", reason: "unavailable" })),
        }),
      ),
      (exit) => (Exit.isSuccess(exit) ? "10 minutes" : 0),
    );
    const fetchVoices = Effect.fn("CloudSpeech.voices")(function* () {
      const unavailable = () =>
        new CloudSpeechError({ provider: "openrouter", operation: "speak", reason: "unavailable" });
      const response = yield* execute(HttpClientRequest.get(OPENROUTER_VOICE_CATALOG_URL)).pipe(
        Effect.mapError(unavailable),
      );
      if (response.status < 200 || response.status >= 300) return yield* unavailable();
      const { data } = yield* HttpClientResponse.schemaBodyJson(OpenRouterSpeechCatalog)(
        response,
      ).pipe(Effect.mapError(unavailable));
      return data.flatMap((entry) => playableSpeechModel(entry) ?? []);
    });
    const voices = yield* Effect.cachedWithTTL(
      fetchVoices().pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () =>
            Effect.fail(
              new CloudSpeechError({
                provider: "openrouter",
                operation: "speak",
                reason: "unavailable",
              }),
            ),
        }),
      ),
      (exit) => (Exit.isSuccess(exit) ? "10 minutes" : 0),
    );
    const setKey = Effect.fn("CloudSpeech.setKey")(function* (
      provider: CloudSpeechProvider,
      key: Redacted.Redacted<string> | SecretReference | null,
    ) {
      yield* settings.updateSettings({
        cloudSpeechCredentials: {
          [provider]: Redacted.isRedacted(key) ? Redacted.value(key) : (key ?? ""),
        },
      });
    });
    // `prepare` may await slow work such as a catalog read, so the key is read and the saved
    // credential rechecked only after it, right before anything is sent.
    const withKey = Effect.fnUntraced(function* <Prepared, A, PrepareError, SendError>(
      provider: CloudSpeechProvider,
      operation: "transcribe" | "speak",
      prepare: Effect.Effect<Prepared, PrepareError>,
      send: (key: string, prepared: Prepared) => Effect.Effect<A, SendError>,
    ) {
      const fail = (reason: CloudSpeechError["reason"]) =>
        new CloudSpeechError({ provider, operation, reason });
      const source = (yield* credentials)[provider];
      if (!source) return yield* fail("missing-key");
      const prepared = yield* prepare;
      // A vault that locked since the last request must not authorize a new upload.
      if (isSecretReference(source)) yield* resolver.invalidate([source]);
      const key = yield* requireSettingsSecret(resolver, source).pipe(
        Effect.mapError(() => fail("unreadable-key")),
      );
      if (!isApiKey(key)) return yield* fail("unreadable-key");
      // A catalog fetch or vault lookup may have outlived the credential it started with.
      const current = (yield* credentials)[provider];
      if (!current || !sameCredential(source, current))
        return yield* fail(current ? "key-changed" : "missing-key");
      return yield* send(key, prepared);
    });
    const transcribe = Effect.fn("CloudSpeech.transcribe")(
      function* (
        provider: CloudSpeechProvider,
        pcm: Uint8Array,
        options: SpeechTranscriptionOptions,
        model?: string,
      ) {
        const fail = (reason: CloudSpeechError["reason"]) =>
          new CloudSpeechError({ provider, operation: "transcribe", reason });
        return yield* withKey(
          provider,
          "transcribe",
          Effect.gen(function* () {
            if (provider === "openrouter" && (!model || !isModelId(model)))
              return yield* fail("model-unavailable");
            const samples = yield* Effect.try({
              try: () => decodeSpeechPcm(pcm),
              catch: () =>
                new SpeechInvalidAudioError({
                  byteLength: pcm.byteLength,
                  message: "Invalid PCM audio.",
                }),
            });
            const language = effectiveSpeechLanguage(cloudSpeechLanguages, options.speechLanguage);
            if (provider === "openrouter" && !(yield* models).some((entry) => entry.id === model))
              return yield* fail("model-unavailable");
            return { samples, language };
          }),
          Effect.fnUntraced(function* (key, { samples, language }) {
            const audio = wave(samples);
            const request = HttpClientRequest.post(endpoints[provider].url).pipe(
              HttpClientRequest.bearerToken(Redacted.make(key)),
              provider === "openrouter"
                ? openRouterBody(model!, audio, language)
                : audioBody(provider, audio, language, options),
            );
            const response = yield* execute(request).pipe(
              Effect.mapError(() => fail("unavailable")),
            );
            if (response.status < 200 || response.status >= 300)
              return yield* fail(
                response.status === 429
                  ? "rate-limit"
                  : [401, 402, 403].includes(response.status)
                    ? "rejected-key"
                    : response.status === 404 && provider === "openrouter"
                      ? "model-unavailable"
                      : "unavailable",
              );
            const { text } = yield* HttpClientResponse.schemaBodyJson(
              EnvironmentSpeechTranscriptionResult,
            )(response).pipe(Effect.mapError(() => fail("unavailable")));
            const corrected = applySpeechAliases(text, options.speechCustomWords);
            return (
              options.speechRemoveFillerWords
                ? removeSpeechFillerWords(corrected, language, options.speechCorrectionWord)
                : corrected
            ).trim();
          }),
        );
      },
      (effect, provider) =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: "2 minutes",
            orElse: () =>
              Effect.fail(
                new CloudSpeechError({ provider, operation: "transcribe", reason: "unavailable" }),
              ),
          }),
        ),
    );
    const speak = Effect.fn("CloudSpeech.speak")(
      function* (input: CloudSpeechSynthesisRequest) {
        const fail = (reason: CloudSpeechError["reason"]) =>
          new CloudSpeechError({ provider: "openrouter", operation: "speak", reason });
        return yield* withKey(
          "openrouter",
          "speak",
          Effect.gen(function* () {
            const model = (yield* voices).find(({ id }) => id === input.model);
            if (!model || !model.voices.includes(input.voice))
              return yield* fail("model-unavailable");
            return model;
          }),
          Effect.fnUntraced(function* (key, model) {
            const request = HttpClientRequest.post(OPENROUTER_SPEECH_URL).pipe(
              HttpClientRequest.bearerToken(Redacted.make(key)),
              HttpClientRequest.bodyJsonUnsafe({
                model: model.id,
                input: input.text,
                voice: input.voice,
                response_format: model.format,
                provider: { zdr: true },
              }),
            );
            const response = yield* execute(request).pipe(
              Effect.mapError(() => fail("unavailable")),
            );
            if (response.status < 200 || response.status >= 300)
              return yield* fail(
                response.status === 429
                  ? "rate-limit"
                  : [401, 402, 403].includes(response.status)
                    ? "rejected-key"
                    : response.status === 404
                      ? "model-unavailable"
                      : "unavailable",
              );
            const audio = yield* response.arrayBuffer.pipe(
              Effect.mapError(() => fail("unavailable")),
            );
            if (audio.byteLength === 0) return yield* fail("unavailable");
            return { audio: new Uint8Array(audio), format: model.format };
          }),
        );
      },
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () =>
          Effect.fail(
            new CloudSpeechError({
              provider: "openrouter",
              operation: "speak",
              reason: "unavailable",
            }),
          ),
      }),
    );
    return CloudSpeech.of({ configured, models, voices, setKey, transcribe, speak });
  }),
);
