import { it } from "@effect/vitest";
import { DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS, SecretProviderId } from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { expect, vi } from "vite-plus/test";
import * as ServerSettings from "../serverSettings.ts";
import * as CloudSpeech from "./CloudSpeech.ts";

it.effect.each(["openai", "xai"] as const)("sends only to %s using its own saved key", (provider) =>
  Effect.gen(function* () {
    const reference = {
      provider: SecretProviderId.make("work"),
      reference: "op://Work/Voice/key",
    };
    let resolved: string | undefined;
    let cached: string | undefined;
    const read = vi.fn(() => Effect.sync(() => [(cached ??= resolved)]));
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ text: "hello" }));
    const service = yield* CloudSpeech.CloudSpeech.pipe(
      Effect.provide(
        CloudSpeech.layer.pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
          Layer.provide(
            Layer.mock(SecretResolver.SecretResolver)({
              read,
              label: () => Effect.succeed("Work"),
              invalidate: () =>
                Effect.sync(() => {
                  cached = undefined;
                }),
            }),
          ),
        ),
      ),
    );
    // A full dictionary plus a hint still stays within xAI's 100-term limit.
    const words = Array.from({ length: 99 }, (_, index) => `word${index}`);
    const transcribe = (pcm = new Uint8Array(new Float32Array([0, 0.5]).buffer)) =>
      service
        .transcribe(provider, pcm, {
          ...DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
          speechLanguage: "en",
          speechCustomWords: ["T3 Code", ...words].map((term) => ({ term, aliases: [] })),
          speechHints: ["Server"],
        })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, upstream));
    yield* service.setKey(provider === "openai" ? "xai" : "openai", Redacted.make("other"));
    expect((yield* Effect.flip(transcribe()))._tag).toBe("CloudSpeechError");
    yield* service.setKey(provider, Redacted.make("chosen"));
    expect(yield* service.configured).toEqual({ openai: true, xai: true, openrouter: false });
    yield* Effect.flip(transcribe(new Uint8Array(3)));
    expect(upstream).not.toHaveBeenCalled();
    expect(yield* transcribe()).toBe("hello");
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe(
      {
        openai: "https://api.openai.com/v1/audio/transcriptions",
        xai: "https://api.x.ai/v1/stt",
      }[provider],
    );
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer chosen");
    const form = init?.body as FormData;
    expect(form.get("model")).toBe(
      provider === "openai" ? "gpt-transcribe" : "grok-voice-transcribe-2.0",
    );
    expect(form.getAll(provider === "openai" ? "keywords[]" : "keyterm")).toEqual([
      "Server",
      "T3 Code",
      ...words.slice(0, 98),
    ]);
    expect(form.get(provider === "openai" ? "languages[]" : "language")).toBe("en");
    expect([...form.keys()].at(-1)).toBe("file");
    const wav = new DataView(yield* Effect.promise(() => (form.get("file") as Blob).arrayBuffer()));
    expect(wav.getUint32(24, true)).toBe(16_000);
    expect(wav.getInt16(46, true)).toBe(16384);
    upstream.mockResolvedValueOnce(new Response("sensitive upstream diagnostic", { status: 401 }));
    expect(yield* Effect.flip(transcribe())).toMatchObject({ provider, reason: "rejected-key" });
    yield* service.setKey(provider, null);
    expect((yield* service.configured)[provider]).toBe(false);
    yield* Effect.flip(transcribe());
    expect(upstream).toHaveBeenCalledTimes(2);
    yield* service.setKey(provider, reference);
    expect((yield* service.configured)[provider]).toBe(true);
    expect(read).not.toHaveBeenCalled();
    resolved = "resolved-fixture";
    expect(yield* transcribe()).toBe("hello");
    expect(read).toHaveBeenCalledWith([reference]);
    expect(new Headers(upstream.mock.calls[2]?.[1]?.headers).get("authorization")).toBe(
      "Bearer resolved-fixture",
    );
    resolved = undefined;
    expect(yield* Effect.flip(transcribe())).toMatchObject({
      provider,
      reason: "unreadable-key",
    });
    expect(upstream).toHaveBeenCalledTimes(3);
  }),
);

it.effect("uploads to OpenRouter only for a listed exact model, as zero-retention JSON WAV", () =>
  Effect.gen(function* () {
    const upstream = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith("/models")
        ? Response.json({ data: [{ id: "acme/transcribe-1" }, { id: "acme/transcribe-2" }] })
        : Response.json({ text: "hello" }),
    );
    const service = yield* CloudSpeech.CloudSpeech.pipe(
      Effect.provide(
        CloudSpeech.layer.pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
          Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
        ),
      ),
    );
    const uploads = () =>
      upstream.mock.calls.filter(([url]) => String(url).endsWith("/audio/transcriptions"));
    const transcribe = (model: string | undefined) =>
      service
        .transcribe(
          "openrouter",
          new Uint8Array(new Float32Array([0, 0.5]).buffer),
          { ...DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS, speechLanguage: "en" },
          model,
        )
        .pipe(Effect.provideService(FetchHttpClient.Fetch, upstream));
    yield* service.setKey("openrouter", Redacted.make("router-key"));
    expect(yield* Effect.flip(transcribe(undefined))).toMatchObject({ provider: "openrouter" });
    upstream.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(yield* Effect.flip(transcribe("acme/transcribe-2"))).toMatchObject({
      reason: "unavailable",
    });
    expect(yield* Effect.flip(transcribe("acme/delisted"))).toMatchObject({
      provider: "openrouter",
    });
    expect(uploads()).toEqual([]);
    expect(yield* transcribe("acme/transcribe-2")).toBe("hello");
    const [[url, init]] = uploads() as [[URL, RequestInit]];
    expect(new URL(String(upstream.mock.calls[0]![0])).searchParams.get("zdr")).toBe("true");
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer router-key");
    expect(headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(yield* Effect.promise(() => new Response(init.body).text())) as {
      model: string;
      models?: unknown;
      provider: { zdr: boolean };
      input_audio: { format: string; data: string };
    };
    expect(body).toMatchObject({
      model: "acme/transcribe-2",
      provider: { zdr: true },
      input_audio: { format: "wav" },
    });
    expect(body.models).toBeUndefined();
    const wav = Buffer.from(body.input_audio.data, "base64");
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readInt16LE(46)).toBe(16384);
  }),
);

it.effect("removing a key while a catalog read is pending prevents the upload", () =>
  Effect.gen(function* () {
    const service = yield* CloudSpeech.CloudSpeech.pipe(
      Effect.provide(
        CloudSpeech.layer.pipe(
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
          Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
        ),
      ),
    );
    const catalogStarted = Promise.withResolvers<void>();
    const catalog = Promise.withResolvers<Response>();
    const uploads: string[] = [];
    const upstream: typeof fetch = async (input) => {
      if (new URL(String(input)).pathname.endsWith("/models")) {
        catalogStarted.resolve();
        return catalog.promise;
      }
      uploads.push(String(input));
      return Response.json({ text: "unexpected" });
    };
    yield* service.setKey("openrouter", Redacted.make("old-key"));
    const job = yield* service
      .transcribe(
        "openrouter",
        new Uint8Array(4),
        DEFAULT_SPEECH_TRANSCRIPTION_OPTIONS,
        "acme/voice",
      )
      .pipe(Effect.provideService(FetchHttpClient.Fetch, upstream), Effect.forkChild);
    yield* Effect.promise(() => catalogStarted.promise);
    yield* service.setKey("openrouter", null);
    catalog.resolve(Response.json({ data: [{ id: "acme/voice" }] }));
    const exit = yield* Fiber.await(job);
    expect(uploads).toEqual([]);
    expect(exit._tag).toBe("Failure");
  }),
);

const speechEntry = (
  id: string,
  voices: unknown,
  formats: ReadonlyArray<string>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name: `Name of ${id}`,
  created: 1,
  output_modalities: [
    {
      type: "speech",
      supported_parameters: {
        voice: voices,
        response_format: { type: "enum", values: formats },
      },
    },
  ],
  ...extra,
});

const speechCatalog = {
  data: [
    speechEntry("acme/both", { type: "enum", values: ["ava", "ben"] }, ["pcm", "wav", "mp3"]),
    speechEntry("acme/wav-only", { type: "enum", values: ["zoe"] }, ["pcm", "wav"], {
      unexpected: { nested: true },
    }),
    speechEntry("acme/pcm-only", { type: "enum", values: ["ava"] }, ["pcm"]),
    speechEntry("acme/free-voice", { type: "unknown" }, ["mp3"]),
    speechEntry("acme/bad-voices", { type: "enum", values: ["has space", ""] }, ["mp3"]),
    speechEntry("openrouter/auto", { type: "enum", values: ["ava"] }, ["mp3"]),
    { id: "acme/no-modalities", name: "Broken" },
    "not an entry",
    null,
  ],
};

const makeSpeech = (upstream: typeof fetch) =>
  CloudSpeech.CloudSpeech.pipe(
    Effect.provide(
      CloudSpeech.layer.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
        Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
      ),
    ),
    Effect.map((service) => ({
      service,
      voices: service.voices.pipe(Effect.provideService(FetchHttpClient.Fetch, upstream)),
      speak: (request: { model: string; voice: string; text: string }) =>
        service
          .speak(request as never)
          .pipe(Effect.provideService(FetchHttpClient.Fetch, upstream)),
    })),
  );

const isSpeechCatalogRequest = (input: Parameters<typeof fetch>[0]) =>
  new URL(String(input)).pathname.endsWith("/audio/speech/models");

it.effect(
  "lists only speech models with named voices and a playable format, preferring mp3 over wav",
  () =>
    Effect.gen(function* () {
      const upstream = vi.fn<typeof fetch>(async () => Response.json(speechCatalog));
      const { voices } = yield* makeSpeech(upstream);
      expect(yield* voices).toEqual([
        {
          id: "acme/both",
          name: "Name of acme/both",
          format: "mp3",
          voices: ["ava", "ben"],
        },
        { id: "acme/wav-only", name: "Name of acme/wav-only", format: "wav", voices: ["zoe"] },
      ]);
      expect(new URL(String(upstream.mock.calls[0]![0])).searchParams.get("zdr")).toBe("true");
      yield* voices;
      expect(upstream).toHaveBeenCalledTimes(1);
    }),
);

it.effect("reports an unavailable speech catalog with the read-aloud wording", () =>
  Effect.gen(function* () {
    const { voices } = yield* makeSpeech(async () => new Response(null, { status: 503 }));
    expect(yield* Effect.flip(voices)).toMatchObject({
      provider: "openrouter",
      operation: "speak",
      reason: "unavailable",
    });
  }),
);

it.effect("sends the chosen text to OpenRouter as zero-retention JSON and returns the audio", () =>
  Effect.gen(function* () {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 4, 5]);
    const upstream = vi.fn<typeof fetch>(async (input) =>
      isSpeechCatalogRequest(input)
        ? Response.json(speechCatalog)
        : new Response(audio, { headers: { "content-type": "audio/mpeg" } }),
    );
    const { service, speak } = yield* makeSpeech(upstream);
    yield* service.setKey("openrouter", Redacted.make("router-key"));
    const result = yield* speak({ model: "acme/both", voice: "ben", text: "  Hello there.\n" });
    expect(result.format).toBe("mp3");
    expect([...result.audio]).toEqual([...audio]);
    const [url, init] = upstream.mock.calls.find(([target]) => !isSpeechCatalogRequest(target))!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer router-key");
    expect(JSON.parse(yield* Effect.promise(() => new Response(init?.body).text()))).toEqual({
      model: "acme/both",
      input: "  Hello there.\n",
      voice: "ben",
      response_format: "mp3",
      provider: { zdr: true },
    });
    const wav = yield* speak({ model: "acme/wav-only", voice: "zoe", text: "Hi." });
    expect(wav.format).toBe("wav");
    const lastBody = upstream.mock.calls.at(-1)![1]!.body;
    expect(
      JSON.parse(yield* Effect.promise(() => new Response(lastBody).text())).response_format,
    ).toBe("wav");
  }),
);

it.effect("fails reading aloud without a saved OpenRouter key before any network call", () =>
  Effect.gen(function* () {
    const upstream = vi.fn<typeof fetch>(async () => Response.json(speechCatalog));
    const { speak } = yield* makeSpeech(upstream);
    expect(
      yield* Effect.flip(speak({ model: "acme/both", voice: "ava", text: "Hi." })),
    ).toMatchObject({
      provider: "openrouter",
      operation: "speak",
      reason: "missing-key",
    });
    expect(upstream).not.toHaveBeenCalled();
  }),
);

it.effect.each([
  { name: "a model missing from the catalog", model: "acme/delisted", voice: "ava" },
  { name: "a model without a playable format", model: "acme/pcm-only", voice: "ava" },
  { name: "a voice the model does not list", model: "acme/both", voice: "zoe" },
])("refuses to read aloud with $name and sends no text", ({ model, voice }) =>
  Effect.gen(function* () {
    const upstream = vi.fn<typeof fetch>(async () => Response.json(speechCatalog));
    const { service, speak } = yield* makeSpeech(upstream);
    yield* service.setKey("openrouter", Redacted.make("router-key"));
    expect(yield* Effect.flip(speak({ model, voice, text: "Secret reply." }))).toMatchObject({
      operation: "speak",
      reason: "model-unavailable",
    });
    expect(upstream.mock.calls.filter(([input]) => !isSpeechCatalogRequest(input))).toEqual([]);
  }),
);

it.effect.each([
  { status: 429, reason: "rate-limit" },
  { status: 401, reason: "rejected-key" },
  { status: 402, reason: "rejected-key" },
  { status: 404, reason: "model-unavailable" },
  { status: 500, reason: "unavailable" },
])("maps an OpenRouter $status reply to $reason for reading aloud", ({ status, reason }) =>
  Effect.gen(function* () {
    const { service, speak } = yield* makeSpeech(async (input) =>
      isSpeechCatalogRequest(input)
        ? Response.json(speechCatalog)
        : new Response("upstream diagnostic", { status }),
    );
    yield* service.setKey("openrouter", Redacted.make("router-key"));
    expect(
      yield* Effect.flip(speak({ model: "acme/both", voice: "ava", text: "Hi." })),
    ).toMatchObject({ provider: "openrouter", operation: "speak", reason });
  }),
);

it.effect("treats an empty audio reply as unavailable", () =>
  Effect.gen(function* () {
    const { service, speak } = yield* makeSpeech(async (input) =>
      isSpeechCatalogRequest(input) ? Response.json(speechCatalog) : new Response(new Uint8Array()),
    );
    yield* service.setKey("openrouter", Redacted.make("router-key"));
    expect(
      yield* Effect.flip(speak({ model: "acme/both", voice: "ava", text: "Hi." })),
    ).toMatchObject({ operation: "speak", reason: "unavailable" });
  }),
);

it.effect("sends no text when the key changes while the speech catalog is loading", () =>
  Effect.gen(function* () {
    const catalogStarted = Promise.withResolvers<void>();
    const catalog = Promise.withResolvers<Response>();
    const sent: string[] = [];
    const { service, speak } = yield* makeSpeech(async (input) => {
      if (isSpeechCatalogRequest(input)) {
        catalogStarted.resolve();
        return catalog.promise;
      }
      sent.push(String(input));
      return new Response(new Uint8Array([1]));
    });
    yield* service.setKey("openrouter", Redacted.make("old-key"));
    const job = yield* speak({ model: "acme/both", voice: "ava", text: "Hi." }).pipe(
      Effect.forkChild,
    );
    yield* Effect.promise(() => catalogStarted.promise);
    yield* service.setKey("openrouter", Redacted.make("new-key"));
    catalog.resolve(Response.json(speechCatalog));
    expect(yield* Effect.flip(Fiber.join(job))).toMatchObject({
      operation: "speak",
      reason: "key-changed",
    });
    expect(sent).toEqual([]);
  }),
);
