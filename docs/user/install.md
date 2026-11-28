# Install One

One runs coding agents on your computer (or server) and lets you control them from the desktop app, web app, or mobile app. Install One on the machine where your agents will run first.

One is an unofficial fork of [T3 Code](https://github.com/pingdotgg/t3code). It has no published downloads, app store listings, or package manager packages yet, so you build it from [the One repository](https://github.com/jroell/one).

> **Upstream installers install T3 Code, not One.** The `t3.codes` install scripts, `npx t3`, Homebrew, winget, Scoop, AUR, Nix, the App Store, and Google Play all install upstream T3 Code. One and T3 Code can run side by side: an installed One app keeps its data in `~/.one`, T3 Code keeps its data in `~/.t3`.

## Requirements

- [Vite+](https://viteplus.dev/guide/) (`vp`), which installs the Node.js version the repository pins.
- [Rust](https://rustup.rs/) for the desktop app and its resource monitor.
- On macOS, Xcode Command Line Tools (`xcode-select --install`). Building the iOS app needs full Xcode.
- At least one installed, authenticated coding agent (provider) before starting a thread. You can launch One first and set up providers from the [Welcome page](./welcome-page.md) or **Settings → Providers**.

## Run from source

```bash
git clone https://github.com/jroell/one.git
cd one
vp i
vp run dev
```

Open the pairing URL printed in the terminal. `vp run dev:desktop` opens the desktop shell instead, and `vp run dev --share` makes the server reachable from your other devices over Tailscale ([Remote access](./remote-access.md)).

## Desktop app

Build an installer from the repository. Installers are written to `release/` and are not signed:

| Platform              | Command                         |
| --------------------- | ------------------------------- |
| macOS (Apple Silicon) | `vp run dist:desktop:dmg:arm64` |
| macOS (Intel)         | `vp run dist:desktop:dmg:x64`   |
| Linux (AppImage)      | `vp run dist:desktop:linux`     |
| Windows (installer)   | `vp run dist:desktop:win`       |

An app you build opens normally on the Mac that built it. If you copy it to another Mac, macOS blocks it the first time because it is not signed: open **System Settings → Privacy & Security** and choose **Open Anyway**.

A desktop app you built yourself does not update itself. To update, pull the latest code and build again ([Updating One](./updating.md)).

### The `t3` command

The desktop app bundles the `t3` command and sets it up on first launch (manage anytime under **Settings → About → t3 command**). Use **Add to PATH** if needed, then open a new terminal.

| Task                          | Command                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| Start server and open web app | `t3` (or `t3 ./my-project`)                                             |
| Start server without browser  | `t3 serve`                                                              |
| Open a folder in the app      | `t3 app` (or `t3 app ../my-project`)                                    |
| Set up remote access          | `t3 up` ([Remote access](./remote-access.md))                           |
| Run in the background         | `t3 service install` ([Background service](./background-service.md))    |
| Reclaim database space        | `t3 doctor` ([Details](./background-service.md#reclaim-database-space)) |

Do not run `t3 update` on a One machine: it downloads upstream T3 Code. If `t3` reports a server is already running, connect with `t3 pair` or pass a separate `--base-dir`. Run `t3 --help` for all commands.

You can also drag folders from your file manager onto the desktop sidebar.

### Windows Subsystem for Linux

Select a WSL distro in **Settings → Sharing & access** to run agents and projects inside WSL (install provider CLIs inside that distro). One manages its own server runtime inside WSL automatically.

## Mobile app

The mobile app is built from `apps/mobile`; the store apps are upstream T3 Code. See [Build the mobile companion app](https://github.com/jroell/one#3-build-the-mobile-companion-app-android-and-ios) in the README. The mobile app connects to a server on another machine via [remote access](./remote-access.md).

If the mobile app crashes on launch, open **Settings → Diagnostics** on the next launch to copy recent startup crash reports.

## Remote machines over SSH

When you add a machine over SSH, One installs a matching `t3` server on it from upstream's releases, because One does not publish its own server downloads. That server is upstream T3 Code's build of the same version.

## Providers

Open **Settings → Providers** (web or desktop), select the environment, and enable the providers you use. Installation and sign-in always happen on the **environment's machine**.

| Provider         | Install and authenticate                                                                                                 | Guide                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Codex**        | Connect with ChatGPT in Settings, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. | [Codex](./providers-codex.md)             |
| **Claude**       | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`.                               | [Claude](./providers-claude.md)           |
| **Cursor**       | Sign in in Settings or install [Cursor CLI](https://cursor.com/cli) and run `agent login`.                               | [Cursor](./cursor.md)                     |
| **Grok Build**   | Install [Grok Build CLI](https://x.ai/cli) and run `grok login`.                                                         | [Grok](./providers-grok.md)               |
| **Antigravity**  | Install managed runtime and sign in with Google in Settings.                                                             | [Antigravity](./providers-antigravity.md) |
| **OpenCode**     | Install [OpenCode](https://opencode.ai) and run `opencode auth login`.                                                   | [OpenCode](./providers-opencode.md)       |
| **Kiro**         | Install [Kiro CLI](https://kiro.dev/docs/cli/) and run `kiro-cli login`.                                                 | [Kiro](./providers-kiro.md)               |
| **Pi**           | Install [Pi](./providers-pi.md) (Node.js 22.19+) and run `pi` → `/login`.                                                | [Pi](./providers-pi.md)                   |
| **Muse Code**    | Install [Muse Code](https://dev.meta.ai/docs/muse-code) and run `muse login`.                                            | [Muse Code](./providers-muse.md)          |
| **fx**           | Install [fx](https://fx.sh) and run `fx login`.                                                                          | [fx](./providers-fx.md)                   |
| **ACP Registry** | Add GitHub Copilot and other agents in **Settings → Providers → Add provider → Show more**.                              | [ACP](./providers-acp.md)                 |

- **Binary path**: If a CLI isn't on the server's `PATH` (common with version managers), set **Binary path** in the provider's settings.
- **Updates**: Click **Update now** on outdated provider cards (supports Homebrew, mise `latest`, npm/pnpm/Yarn/Bun/Volta/Vite+, or the CLI's own updater; update Nix, Chocolatey, or pinned mise installs manually).
- **Multiple instances**: Add extra provider instances for separate accounts, API keys, or custom endpoints (mark secret env vars as sensitive).

### Provider check timeouts

If a working CLI times out during One's readiness check, increase its probe deadline (in milliseconds) in the server's environment (or systemd override / `service.env`) and restart:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 t3 serve
```

| Provider     | Environment variable                   |
| ------------ | -------------------------------------- |
| Codex        | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude       | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor       | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity  | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok         | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro         | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx           | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi           | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code    | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode     | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

## Next steps

- [User guide index](./README.md): overview of how One works.
- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): control when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Updating One](./updating.md): keep apps, servers, and providers up to date.
