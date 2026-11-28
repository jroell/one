# Voice input

Dictate into the composer, citation comments, diff/file annotations, PR comments, and desktop browser annotations. Transcripts land in your draft for review—nothing is sent to an agent until you submit.

## Choose where audio goes

- **Web and desktop**: Nothing is recorded or sent until you choose a destination in **Settings → Voice → Transcribe with**:
  - **On this Mac (Apple Speech)** (macOS 26+ desktop): Transcribes locally on your Mac (silence filtering and filler removal unavailable; dictionary applies only with cleanup enabled).
  - **A connected environment**: Sends audio over your authenticated connection to transcribe locally on that host and discards the audio. Never silently fails over to another host.
  - **Cloud providers (OpenAI, Grok Voice Transcribe, OpenRouter)**: Configure an API key (or [secret reference](./secrets.md)) on an environment to forward recordings to that provider. OpenRouter lets each user pick a model from its live STT catalog. OpenRouter and the model's provider handle the audio under their own data policies.
- **Mobile (iOS and Android)**: Transcribes on-device by default (iOS 26+ or Android 12+ with compatible Google speech services; first use may download a speech model, then works offline). To transcribe on a paired environment or cloud provider instead, configure **Settings → Voice → Transcribe on**. Keep T3 Code open while dictating on Android.

## Set up a local transcription model

In **Settings → Voice → Transcription**, filter by language, download a model, and select **Use model** (reuses matching files from Handy or the Hugging Face cache, or link an existing file via **Use existing**—Core ML/ONNX/MLX builds aren't supported).

- **Advanced**: Configure GPU/CPU (**Auto** falls back to CPU once on GPU error), idle unload timeout, and **Streaming transcription** (disable if live preview lags).

## Dictate and shortcuts

- Press the microphone button or `mod+shift+d` to start/stop (`Esc` discards; max recording length: **5 minutes**).
- Configure tap vs. hold behavior in **Settings → Voice → Dictation shortcut** (**Auto**, **Hold**, or **Toggle**), or remap the chord in [Keybindings](./keybindings.md).
- Pressing **Send** (or Save/Comment/Submit) while recording finishes transcription and submits automatically.

## Improve recognition and cleanup

- **Language & translation**: Pick a language or **Auto** (plus **Translate to English** where supported).
- **Personal & project dictionaries**: Add custom terms and common misspelling aliases in **Settings → Voice** (device-level) or scoped to a project/environment (up to 100 combined entries; project entries take priority).
- **Silence filtering & filler removal**: Skip silence (on by default) and strip hesitation words.
- **Transcript cleanup** (off by default): Sends the finished transcript and surrounding draft text (never audio) to your [text generation model](./text-generation.md) (or a dedicated **Cleanup model**) to fix punctuation, numbers, and spoken self-corrections (optionally using a custom **Correction cue** like "scratch that"). Press **Skip** during cleanup to insert raw text.

## Microphones and testing

- **Microphone priority**: Rank built-in, wired, Bluetooth, and CarPlay (iOS) devices in **Settings → Voice**—T3 Code uses the first connected device in the list.
- **Test**: Use **Test microphone** (local 10-second loopback, no transcription) to verify input, and **Test model** to preview raw transcription without cleanup.
- Browser recording requires **HTTPS** or `localhost`—for plain-HTTP remote servers, use the desktop app.

## Read replies aloud

Every finished reply has a **Read aloud** button next to **Copy**. Press it again, or run **Stop reading aloud** from the command palette, to stop. Voice chat reads with the same voice.

Choose the voice in **Settings → Voice → Reading aloud**:

- **This device** uses the voices built into your browser or operating system. **Best on this device** picks the most natural one it has for the reply's language. Nothing leaves your device.
- **OpenRouter** voices sound much more natural. They use the OpenRouter key saved for transcription on an environment, so save one under **Transcribe with** first. Each reply's text is sent to OpenRouter and the model's provider, which handle it under their own data policies, and OpenRouter bills your account per character. When a cloud voice fails, for example because the account behind the model is out of credits, the device voice reads the rest of the reply and a notice says why.
- **Reading speed** and **Play sample** apply to both.
- **Conqueror voice** is on by default. It reads with this device's voices in a deeper, slower voice: the voice you chose, or the deepest one the device has when you left it on **Best on this device**. Turn it off for the device voice as it normally sounds. It does not change OpenRouter voices.
