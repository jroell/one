import { bytesToBase64 } from "./pcmAudio";
import type {
  ApiKeyProvider,
  CarPlayNativeAdapter,
  VoiceProfile,
  VoiceProvider,
  VoiceVibe,
} from "./types";

export const DEFAULT_VOICE_ID = "openai:marin";

export const VOICE_CATALOG: ReadonlyArray<VoiceProfile> = [
  // OpenAI Realtime (10 native voices)
  {
    id: "openai:marin",
    provider: "openai-realtime",
    providerVoiceId: "marin",
    displayName: "Marin",
    tagline: "Natural, grounded co-pilot with warm conversational cadence.",
    vibe: "warm",
    accentColor: "#E5A93B",
    sampleLine:
      "Hey, eyes on the road. I have your threads and ideas ready whenever you want to talk.",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "openai:cedar",
    provider: "openai-realtime",
    providerVoiceId: "cedar",
    displayName: "Cedar",
    tagline: "Steady, low-register voice that stays clear over highway noise.",
    vibe: "deep",
    accentColor: "#C9892E",
    sampleLine: "Cedar here. Keep driving, and tell me what problem we are untangling today.",
    defaultSpeed: 0.98,
    supportsRealtime: true,
  },
  {
    id: "openai:coral",
    provider: "openai-realtime",
    providerVoiceId: "coral",
    displayName: "Coral",
    tagline: "Bright and upbeat for quick morning brainstorming on the commute.",
    vibe: "energetic",
    accentColor: "#F29D52",
    sampleLine:
      "Morning! Throw your wildest product idea at me and let us sharpen it before the exit.",
    defaultSpeed: 1.04,
    supportsRealtime: true,
  },
  {
    id: "openai:ash",
    provider: "openai-realtime",
    providerVoiceId: "ash",
    displayName: "Ash",
    tagline: "Direct, focused timbre built for fast engineering trade-offs.",
    vibe: "crisp",
    accentColor: "#D8B36A",
    sampleLine:
      "Ash online. Give me the constraint and the goal, and we will cut straight to the answer.",
    defaultSpeed: 1.02,
    supportsRealtime: true,
  },
  {
    id: "openai:ballad",
    provider: "openai-realtime",
    providerVoiceId: "ballad",
    displayName: "Ballad",
    tagline: "Expressive storyteller suited for deep dives and late-night drives.",
    vibe: "narrative",
    accentColor: "#B783E8",
    sampleLine:
      "The road is quiet and the console is yours. Where shall we take this thought tonight?",
    defaultSpeed: 0.96,
    supportsRealtime: true,
  },
  {
    id: "openai:sage",
    provider: "openai-realtime",
    providerVoiceId: "sage",
    displayName: "Sage",
    tagline: "Measured, calm analyst for clear status briefings and decisions.",
    vibe: "calm",
    accentColor: "#78B89A",
    sampleLine:
      "Sage ready. Two threads finished cleanly and one needs your sign-off whenever you are set.",
    defaultSpeed: 0.98,
    supportsRealtime: true,
  },
  {
    id: "openai:shimmer",
    provider: "openai-realtime",
    providerVoiceId: "shimmer",
    displayName: "Shimmer",
    tagline: "Clear, approachable tone that cuts smoothly through cabin audio.",
    vibe: "warm",
    accentColor: "#F2C572",
    sampleLine:
      "All set in Drive Mode. Interrupt me anytime if you want to jump straight to the next topic.",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "openai:verse",
    provider: "openai-realtime",
    providerVoiceId: "verse",
    displayName: "Verse",
    tagline: "Agile, witty pacing that keeps back-and-forth riffing lively.",
    vibe: "energetic",
    accentColor: "#E88B5A",
    sampleLine:
      "Verse locked in. Pitch me the rough version and we will knock off the sharp edges together.",
    defaultSpeed: 1.05,
    supportsRealtime: true,
  },
  {
    id: "openai:alloy",
    provider: "openai-realtime",
    providerVoiceId: "alloy",
    displayName: "Alloy",
    tagline: "Balanced, neutral studio voice for crisp technical summaries.",
    vibe: "crisp",
    accentColor: "#A6B4C8",
    sampleLine: "Alloy connected. Everything is queued up cleanly so you can stay hands-free.",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "openai:echo",
    provider: "openai-realtime",
    providerVoiceId: "echo",
    displayName: "Echo",
    tagline: "Resonant baritone with relaxed pacing for long stretches of highway.",
    vibe: "deep",
    accentColor: "#9388D9",
    sampleLine: "Echo here. No rush at all. Talk me through what is on your mind.",
    defaultSpeed: 0.96,
    supportsRealtime: true,
  },

  // Gemini Live (10 native voices)
  {
    id: "gemini:Puck",
    provider: "gemini-live",
    providerVoiceId: "Puck",
    displayName: "Puck",
    tagline: "Quick-witted and playful for energetic road-trip ideation.",
    vibe: "energetic",
    accentColor: "#F5B041",
    sampleLine:
      "Puck checking in. Give me a messy idea and ten miles, and we will turn it into a plan.",
    defaultSpeed: 1.04,
    supportsRealtime: true,
  },
  {
    id: "gemini:Charon",
    provider: "gemini-live",
    providerVoiceId: "Charon",
    displayName: "Charon",
    tagline: "Deep, unhurried voice for architecture debates and night drives.",
    vibe: "deep",
    accentColor: "#7F8FA6",
    sampleLine:
      "Charon listening. Walk me through the failure modes and we will pressure-test each one.",
    defaultSpeed: 0.95,
    supportsRealtime: true,
  },
  {
    id: "gemini:Kore",
    provider: "gemini-live",
    providerVoiceId: "Kore",
    displayName: "Kore",
    tagline: "Clean, articulate delivery built for crisp executive updates.",
    vibe: "crisp",
    accentColor: "#5DADE2",
    sampleLine: "Kore ready. Short answers, clear trade-offs, and zero filler while you drive.",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "gemini:Fenrir",
    provider: "gemini-live",
    providerVoiceId: "Fenrir",
    displayName: "Fenrir",
    tagline: "Bold, punchy energy when you want a decisive sparring partner.",
    vibe: "energetic",
    accentColor: "#EB7350",
    sampleLine: "Fenrir here. Tell me what is blocking the release and we will cut through it.",
    defaultSpeed: 1.03,
    supportsRealtime: true,
  },
  {
    id: "gemini:Aoede",
    provider: "gemini-live",
    providerVoiceId: "Aoede",
    displayName: "Aoede",
    tagline: "Warm, lyrical delivery that feels natural in long conversations.",
    vibe: "warm",
    accentColor: "#F0B27A",
    sampleLine:
      "Aoede on the line. Take your time, and we can think through anything on your list.",
    defaultSpeed: 0.99,
    supportsRealtime: true,
  },
  {
    id: "gemini:Leda",
    provider: "gemini-live",
    providerVoiceId: "Leda",
    displayName: "Leda",
    tagline: "Soft, composed tone that keeps busy traffic feeling unhurried.",
    vibe: "calm",
    accentColor: "#76D7C4",
    sampleLine: "Leda connected. Stay focused on traffic and I will keep the summary brief.",
    defaultSpeed: 0.97,
    supportsRealtime: true,
  },
  {
    id: "gemini:Orus",
    provider: "gemini-live",
    providerVoiceId: "Orus",
    displayName: "Orus",
    tagline: "Confident, structured voice for systems design and code strategy.",
    vibe: "crisp",
    accentColor: "#D4AC0D",
    sampleLine: "Orus online. Name the service boundary and I will challenge the assumptions.",
    defaultSpeed: 1.0,
    supportsRealtime: true,
  },
  {
    id: "gemini:Zephyr",
    provider: "gemini-live",
    providerVoiceId: "Zephyr",
    displayName: "Zephyr",
    tagline: "Light, breezy conversational style for effortless everyday chat.",
    vibe: "warm",
    accentColor: "#85C1E9",
    sampleLine: "Zephyr ready to roll. Ask me anything, from deployment status to dinner ideas.",
    defaultSpeed: 1.02,
    supportsRealtime: true,
  },
  {
    id: "gemini:Enceladus",
    provider: "gemini-live",
    providerVoiceId: "Enceladus",
    displayName: "Enceladus",
    tagline: "Gentle, low-key narrator tone for quiet evening commutes.",
    vibe: "calm",
    accentColor: "#8E9AAF",
    sampleLine: "Enceladus here. Quiet cabin, clear signal. What should we talk through?",
    defaultSpeed: 0.95,
    supportsRealtime: true,
  },
  {
    id: "gemini:Umbriel",
    provider: "gemini-live",
    providerVoiceId: "Umbriel",
    displayName: "Umbriel",
    tagline: "Dry, atmospheric voice made for storytelling and Ring-Bearer mode.",
    vibe: "narrative",
    accentColor: "#A569BD",
    sampleLine:
      "Umbriel at your side. The highway stretches ahead, and the agents await your word.",
    defaultSpeed: 0.94,
    supportsRealtime: true,
  },

  // ElevenLabs Expressive (6 curated presets + custom voice ID override support)
  {
    id: "elevenlabs:rachel",
    provider: "elevenlabs",
    providerVoiceId: "21m00Tcm4TlvDq8ikWAM",
    displayName: "Rachel",
    tagline: "Polished, calm studio warmth with expressive inflection.",
    vibe: "warm",
    accentColor: "#E59866",
    sampleLine:
      "Hi, I am Rachel. Whenever you finish a thought, I will answer in plain, spoken English.",
    defaultSpeed: 1.0,
    supportsRealtime: false,
  },
  {
    id: "elevenlabs:adam",
    provider: "elevenlabs",
    providerVoiceId: "pNInz6obpgDQGcFmaJgB",
    displayName: "Adam",
    tagline: "Rich, authoritative baritone with broadcast clarity.",
    vibe: "deep",
    accentColor: "#CA6F1E",
    sampleLine: "Adam here. Clear audio, short sentences, and ready for your briefing.",
    defaultSpeed: 0.98,
    supportsRealtime: false,
  },
  {
    id: "elevenlabs:bella",
    provider: "elevenlabs",
    providerVoiceId: "EXAVITQu4vr4xnSDxMaL",
    displayName: "Bella",
    tagline: "Friendly, engaging storyteller with subtle expressive nuance.",
    vibe: "narrative",
    accentColor: "#D98880",
    sampleLine: "Bella on audio. Tell me the story behind what you are building next.",
    defaultSpeed: 1.0,
    supportsRealtime: false,
  },
  {
    id: "elevenlabs:antoni",
    provider: "elevenlabs",
    providerVoiceId: "ErXwobaYiN019PkySvjV",
    displayName: "Antoni",
    tagline: "Crisp, modern conversational cadence for rapid Q and A.",
    vibe: "crisp",
    accentColor: "#F4D03F",
    sampleLine: "Antoni ready. Keep both hands on the wheel and ask away.",
    defaultSpeed: 1.02,
    supportsRealtime: false,
  },
  {
    id: "elevenlabs:elli",
    provider: "elevenlabs",
    providerVoiceId: "MF3mGyEYCl7XYWbV9V6O",
    displayName: "Elli",
    tagline: "Bright, lively voice built for upbeat brainstorming.",
    vibe: "energetic",
    accentColor: "#F5B7B1",
    sampleLine: "Hey, I am Elli! Let us bounce a few ideas around before you reach your turn.",
    defaultSpeed: 1.04,
    supportsRealtime: false,
  },
  {
    id: "elevenlabs:josh",
    provider: "elevenlabs",
    providerVoiceId: "TxGEqnHWrfWFTfGW9XjX",
    displayName: "Josh",
    tagline: "Relaxed, natural co-host tone that feels easy on long drives.",
    vibe: "calm",
    accentColor: "#7FB3D5",
    sampleLine: "Josh here. Smooth driving, quick answers, and zero screen tapping required.",
    defaultSpeed: 0.99,
    supportsRealtime: false,
  },

  // On-Device Native Voices (3 zero-key presets)
  {
    id: "on-device:pilot",
    provider: "on-device",
    providerVoiceId: "system-default",
    displayName: "On-Device Pilot",
    tagline: "Works immediately offline with zero API keys using native system speech.",
    vibe: "crisp",
    accentColor: "#D9A441",
    sampleLine:
      "On-Device Pilot is active. No API key needed, and hands-free mode is ready right now.",
    defaultSpeed: 1.0,
    supportsRealtime: false,
  },
  {
    id: "on-device:calm",
    provider: "on-device",
    providerVoiceId: "system-calm",
    displayName: "On-Device Calm",
    tagline: "Slightly slower native speech tuned for relaxed spoken summaries.",
    vibe: "calm",
    accentColor: "#82B7A0",
    sampleLine: "On-Device Calm ready. I will keep every update slow, clear, and easy to follow.",
    defaultSpeed: 0.92,
    supportsRealtime: false,
  },
  {
    id: "on-device:brief",
    provider: "on-device",
    providerVoiceId: "system-brief",
    displayName: "On-Device Brief",
    tagline: "Brisk native speech for rapid status checks without cloud setup.",
    vibe: "energetic",
    accentColor: "#E0A96D",
    sampleLine: "On-Device Brief online. Fast readouts and instant thread status with zero keys.",
    defaultSpeed: 1.08,
    supportsRealtime: false,
  },
];

const VOICE_BY_ID = new Map<string, VoiceProfile>(VOICE_CATALOG.map((voice) => [voice.id, voice]));

export function getVoiceById(voiceId: string): VoiceProfile {
  return VOICE_BY_ID.get(voiceId) ?? VOICE_CATALOG[0]!;
}

export interface VoiceFilterOptions {
  readonly provider?: VoiceProvider | "all";
  readonly vibe?: VoiceVibe | "all";
  readonly query?: string;
  readonly favoritesOnly?: boolean;
  readonly favoriteIds?: ReadonlyArray<string>;
}

export function filterVoices(
  voices: ReadonlyArray<VoiceProfile>,
  options: VoiceFilterOptions,
): ReadonlyArray<VoiceProfile> {
  const query = options.query?.trim().toLowerCase() ?? "";
  const favoriteSet = new Set(options.favoriteIds ?? []);

  return voices.filter((voice) => {
    if (options.provider && options.provider !== "all" && voice.provider !== options.provider) {
      return false;
    }
    if (options.vibe && options.vibe !== "all" && voice.vibe !== options.vibe) {
      return false;
    }
    if (options.favoritesOnly && !favoriteSet.has(voice.id)) {
      return false;
    }
    if (query.length > 0) {
      const haystack =
        `${voice.displayName} ${voice.tagline} ${voice.vibe} ${voice.provider}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function getOrderedVoicesForCarPlay(
  favoriteVoiceIds: ReadonlyArray<string>,
  selectedVoiceId: string,
): ReadonlyArray<VoiceProfile> {
  const favoriteSet = new Set(favoriteVoiceIds);
  const favorites: Array<VoiceProfile> = [];
  const rest: Array<VoiceProfile> = [];
  for (const voice of VOICE_CATALOG) {
    if (voice.id === selectedVoiceId || favoriteSet.has(voice.id)) {
      favorites.push(voice);
    } else {
      rest.push(voice);
    }
  }
  favorites.sort((a, b) => {
    if (a.id === selectedVoiceId) return -1;
    if (b.id === selectedVoiceId) return 1;
    return favoriteVoiceIds.indexOf(a.id) - favoriteVoiceIds.indexOf(b.id);
  });
  return [...favorites, ...rest];
}

export interface PreviewVoiceOptions {
  readonly native: CarPlayNativeAdapter;
  readonly getApiKey: (provider: ApiKeyProvider) => Promise<string | null>;
  readonly elevenLabsCustomVoiceId?: string;
  readonly spokenSpeed?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface PreviewVoiceResult {
  readonly voice: VoiceProfile;
  readonly mode: "openai-tts" | "elevenlabs-tts" | "on-device";
}

export async function previewVoiceSample(
  voiceId: string,
  options: PreviewVoiceOptions,
): Promise<PreviewVoiceResult> {
  const voice = getVoiceById(voiceId);
  const fetchFn = options.fetchImpl ?? fetch;
  const speed = Math.max(0.75, Math.min(1.5, options.spokenSpeed ?? voice.defaultSpeed));

  await options.native.stopFallbackSpeech();
  await options.native.clearPlaybackQueue();

  if (voice.provider === "openai-realtime") {
    const apiKey = await options.getApiKey("openai");
    if (apiKey) {
      try {
        const response = await fetchFn("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            voice: voice.providerVoiceId,
            input: voice.sampleLine,
            response_format: "pcm",
            speed,
          }),
          signal: options.signal,
        });
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 0 && !options.signal?.aborted) {
            await options.native.enqueuePcmAudio(bytesToBase64(new Uint8Array(buffer)), 24_000);
            return { voice, mode: "openai-tts" };
          }
        }
      } catch {
        // Fall through cleanly to native speech so auditions never fail on offline or invalid keys.
      }
    }
  }

  if (voice.provider === "elevenlabs") {
    const apiKey = await options.getApiKey("elevenlabs");
    if (apiKey) {
      const targetVoiceId = options.elevenLabsCustomVoiceId?.trim() || voice.providerVoiceId;
      try {
        const response = await fetchFn(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(targetVoiceId)}?output_format=pcm_24000`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: voice.sampleLine,
              model_id: "eleven_flash_v2_5",
            }),
            signal: options.signal,
          },
        );
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 0 && !options.signal?.aborted) {
            await options.native.enqueuePcmAudio(bytesToBase64(new Uint8Array(buffer)), 24_000);
            return { voice, mode: "elevenlabs-tts" };
          }
        }
      } catch {
        // Fall through to native speech so every voice remains auditionable offline.
      }
    }
  }

  if (!options.signal?.aborted) {
    await options.native.speakFallbackText(voice.sampleLine, {
      rate: speed,
      voiceId: voice.id,
    });
  }
  return { voice, mode: "on-device" };
}
