import { msg } from "gt-react";

import type { ExplainTopic, MoreExplainTopicId, SetupSnapshot } from "./explainTypes";

/**
 * Settings sections beyond the first round, and the Usage sheet. Written from docs/user, or from
 * the section's own labels where no page exists. `notes` is for the model, in English.
 */

const providerLines = (setup: SetupSnapshot): ReadonlyArray<string> =>
  setup.providers.length === 0
    ? ["No providers are configured on this environment yet."]
    : setup.providers.map((provider) =>
        [
          `${provider.name} (${provider.driver})`,
          provider.enabled ? provider.state : "Off",
          provider.plan === null ? null : `plan ${provider.plan}`,
        ]
          .filter((part) => part !== null)
          .join(", "),
      );

export const MORE_TOPICS: Readonly<Record<MoreExplainTopicId, ExplainTopic>> = {
  environments: {
    id: "environments",
    title: msg("Environments"),
    whatItIs: msg(
      "An environment is a computer that runs your agents and holds your projects. This app can use its own, and you can add other computers to use theirs too.",
    ),
    verdict: msg("If you work on one computer, you do not need to add any."),
    terms: [
      {
        term: msg("Add environment"),
        meaning: msg("Takes a pairing link or code from the computer you want to add."),
      },
      {
        term: msg("Load balancing"),
        meaning: msg(
          "Off by default. It appears once two or more computers are switched on, and chooses a computer for new threads in projects grouped across them.",
        ),
      },
    ],
    useWhen: [
      msg("Your agents or projects live on a server or on another computer."),
      msg("You start work from a phone or laptop on a computer that stays on."),
    ],
    skipWhen: [msg("You work on one computer.")],
    youWillNeed: [
      msg(
        "A pairing link or code from the other computer, or the same T3 Connect account signed in on both.",
      ),
    ],
    question: msg("What is an environment, and do I need to add more than one?"),
    notes: `Environments are under Settings, Environments (web and desktop; mobile has Settings, Environments too). An environment is a machine running the T3 Code server: it runs agents and holds projects. The desktop app has its own local environment (shown under "This app"; a desktop app with Local environment off can manage a background service on the same machine). Other machines are added with Add environment, using a pairing link or code from that machine (Settings, Sharing & access there, or the t3 pair command) or through T3 Connect by signing in to the same T3 Connect account and choosing the environment. A loopback address such as 127.0.0.1 reaches only the device that opens the link. Pairing authorizes that device for future connections. The setting named Load balancing (Settings, Environments, Load balancing) is off by default and appears once two or more machines are switched on; each machine starts at Normal and can be set to Prefer, Less often or Manual only; these are preferences, not fixed traffic shares, and they are saved separately in each client; existing threads stay where they started. A person who uses one computer needs nothing here. If a connection fails, Details on the environment shows which part of the route failed (see t3-connect-troubleshooting.md).`,
    docs: { page: "remote-access.md", anchor: "pair-over-a-lan-or-private-network" },
    facts: () => [],
  },
  "t3-connect": {
    id: "t3-connect",
    title: msg("T3 Connect"),
    whatItIs: msg(
      "T3 Connect lets your phone, browser or another computer reach this computer without changing your router. You sign in and switch it on for the environment.",
    ),
    verdict: msg("Only needed if you want to reach this computer from another device."),
    useWhen: [msg("You want to use this computer's agents from a phone or another computer.")],
    skipWhen: [msg("You only work on this computer.")],
    youWillNeed: [
      msg("A T3 Connect account, signed in on this computer and on the other device."),
      msg("This computer kept running and reachable while you work."),
    ],
    question: msg("What is T3 Connect, and do I need it?"),
    notes: `T3 Connect makes an environment available to the person's other devices without router forwarding. On the host machine, open Settings, Sharing & access, sign in, and turn on T3 Connect for that environment; on a command-line host run t3 up and choose T3 Connect (t3 connect is the same as t3 up --connect; t3 status shows the choice). On the other device, sign in to the same T3 Connect account and choose the environment. The host must stay running and reachable; closing the desktop app's last window stops its local server unless T3 Code runs as a background service, and saving the sign-in alone does not start a server. Each T3 Connect account can link up to 3 machines; phones and browsers do not count. Linking T3 Chat raises the limit to 10 machines with Pro or 100 with Premier; machines already linked stay linked after a downgrade. By default any device signed in to the account can open a linked machine. Require approval for new devices (Settings, Sharing & access, T3 Connect) makes a new device wait and show a code such as K7QM-2XFD that must be approved from an already connected device; a request expires after 10 minutes; approved devices are listed under T3 Connect devices and can be revoked there. When a connection fails, Settings, Environments, Details shows which of four parts failed (this device, T3 Connect, the host's tunnel, T3 Code on the host); see t3-connect-troubleshooting.md.`,
    docs: { page: "remote-access.md", anchor: "t3-connect" },
    facts: () => [],
  },
  "authorized-clients": {
    id: "authorized-clients",
    title: msg("Authorized clients"),
    whatItIs: msg(
      "Authorized clients are the devices and links allowed to use this computer. You can make a pairing link for a new device and remove one you no longer trust.",
    ),
    verdict: msg("Look here when you share access or lose a device; otherwise leave it alone."),
    useWhen: [
      msg("You want to connect a new phone or computer."),
      msg("A device is lost, or someone should no longer have access."),
    ],
    skipWhen: [msg("Nothing has changed since you last checked.")],
    question: msg("What are authorized clients, and when should I remove one?"),
    notes: `On the host, Settings, Sharing & access lets authorized administrators create pairing links and revoke client sessions. Pairing authorizes that device for future connections; each new device needs a fresh one-time link. A device stays signed in while it is used, until the person revokes it here; one unused for 30 days, or paired with an older host, has to pair again. A link created in Settings can only be copied from the client that created it while the Sharing & access page stays open; leave or reload and create another. Revoking an unused link prevents new pairings; revoking a device's session removes its existing access. A session with an open connection stays listed after its access credential expires. When the app connects to more than one environment, choose one at the top of the page. Permissions: pairing tokens get the standard client permissions, including managing access, unless created with t3 pair --scope for each wanted scope; to change a client's permissions create a fresh pairing link with the scopes it needs and use Add Environment with it (reconnecting alone does not change them). Setting up or replacing a T3 Connect link needs the separate relay:configure permission. Command-line management is available through t3 auth --help.`,
    docs: { page: "remote-access.md", anchor: "manage-or-revoke-access" },
    facts: () => [],
  },
  secrets: {
    id: "secrets",
    title: msg("Secrets"),
    whatItIs: msg(
      "A secret provider lets One read passwords and keys from your password manager. One then saves a reference to the secret instead of the secret itself.",
    ),
    verdict: msg("Only useful if you keep your keys in 1Password and want them kept out of One."),
    terms: [
      {
        term: msg("Reference"),
        meaning: msg(
          "An address for one item in 1Password, such as op://vault/item/field. You copy it from 1Password with Copy Secret Reference.",
        ),
      },
    ],
    useWhen: [msg("You already keep keys in 1Password and want One to read them from there.")],
    skipWhen: [msg("You are happy pasting a key into One once.")],
    youWillNeed: [
      msg(
        "The 1Password command-line tool, installed and signed in on the computer that runs One.",
      ),
    ],
    question: msg("What is a secret provider, and should I set one up?"),
    notes: `Secret providers are under Settings, Secrets, which the docs call a preview page that is not in every build. 1Password is the supported provider. One reads secrets with the 1Password CLI (op), which must be installed and signed in on the machine that runs the One server (for a remote or phone session that is the remote machine). A desktop sign-in asks for approval on that machine, which a remote user cannot answer; on a remote or headless server sign op in with a 1Password service account or a Connect server instead. Add provider takes a name and the 1Password account (the shorthand, sign-in address without https://, or ID that op account list shows). Providers belong to the environment, and each environment keeps its own list. Credential fields in Settings (provider environment variables and credentials, source control tokens, usage limit keys, device host tokens) show a source picker: Value saves the credential itself; a secret provider plus a reference such as op://vault/item/field saves only the reference, and the check button reads it now. One reads the secret when it needs it, for example when a provider starts. If 1Password is locked or signed out, the feature that needs the secret shows an error naming the provider; unlock 1Password on the server's machine and use Refresh in Settings, Providers. One never replaces a saved credential it cannot read with another login. Removing a provider lists the fields that read from it and clears them; the secrets in 1Password are untouched. Separately, an agent that needs a secret shows a private card in the thread, so the value never appears in the conversation.`,
    docs: { page: "secrets.md", anchor: "secret-providers" },
    facts: () => [],
  },
  "voice-transcription": {
    id: "voice-transcription",
    title: msg("Transcription"),
    whatItIs: msg(
      "Transcription decides where your speech is turned into text when you dictate. Nothing is sent anywhere until you choose a place.",
    ),
    verdict: msg("Choose one if you want to dictate. Leave it Off if you do not."),
    useWhen: [msg("You want to dictate into the message box instead of typing.")],
    skipWhen: [msg("You never dictate: leave it Off and no audio is sent.")],
    youWillNeed: [
      msg(
        "A computer to do the work: one of your environments, Apple Speech on a recent Mac, or a cloud service.",
      ),
    ],
    question: msg("Where should my voice be transcribed, and which choice fits me?"),
    notes: `Settings, Voice, Transcribe with (under Transcription) sets where speech becomes text on web and desktop. Nothing is sent until one is chosen. The recording made on this device goes to the chosen environment over the authenticated connection, is transcribed there and discarded; the choice is saved on this device only, so each computer and browser asks once. Off stops it (a recording in progress is discarded). If the chosen environment goes offline, voice input waits; One never substitutes another. In the desktop app on macOS 26 or later, Apple Speech (under On this Mac) keeps audio on the Mac and macOS transcribes it; the first recording in a language can take longer while macOS downloads its speech model. Cloud dictation via an environment: OpenAI or Grok Voice Transcribe, which may need a key (Save and enable; a secret provider reference can replace Value); the environment forwards the recording and vocabulary hints to that provider, which bills its API account; removing the key stops that provider for everyone on the environment. OpenRouter works the same but has no default model: pick one from its live speech-to-text catalog; it requests zero data retention; vocabulary hints are not sent to it. Setup of a local model is under Settings, Voice, Transcription: download a model, Use model, and Test model. On iPhone and Android voice input transcribes on the device by default and an environment is opt-in under Settings, Voice, Transcribe on. Dictated text lands in the draft for review and only sending the message sends anything to an agent.`,
    docs: { page: "voice-input.md", anchor: "choose-where-audio-goes" },
    facts: () => [],
  },
  "source-control-providers": {
    id: "source-control-providers",
    title: msg("Source control providers"),
    whatItIs: msg(
      "These connect One to where your code is hosted, such as GitHub or GitLab, so it can clone and publish projects and open pull requests.",
    ),
    verdict: msg(
      "Sign in to your code host on the computer that runs One, then choose Rescan. Nothing else is needed.",
    ),
    useWhen: [msg("You want One to clone, publish or open pull requests for your projects.")],
    skipWhen: [msg("You only work on local folders and never publish.")],
    youWillNeed: [
      msg("Git installed and signed in to your host on the computer that runs the server."),
    ],
    question: msg("What do source control providers do, and what must I set up?"),
    notes: `Settings, Source control & issues. One integrates with GitHub, GitLab, Forgejo, Gitea, Bitbucket, Azure DevOps, GitCafe and Cursor Origin to clone and publish repositories, create pull requests and review changes. Install Git and configure authentication on the machine that runs the One server (for a remote environment, that remote machine). After signing in, open Settings, Source control & issues and choose Rescan; the page also shows a Server environment scan and what it detected. GitHub: One talks to GitHub's API directly and needs only a token, in this order: a token saved in Settings, Source control & issues, GitHub (kept in the server's secret store, works without the GitHub CLI); GH_TOKEN (GH_ENTERPRISE_TOKEN with GH_HOST for Enterprise Server) in the server's environment; or the GitHub CLI 2.81.0 or newer signed in with gh auth login. If gh is signed in to several accounts or hosts, expand GitHub to pick the account each host uses or turn a host off. Forgejo and Gitea: install Forgejo CLI (fj) or Gitea CLI (tea) 0.16 or later on the server and sign in with fj auth add-token or tea login add; they share one entry. GitLab: install the GitLab CLI and run glab auth login. Bitbucket: expand Bitbucket and enter an Access token, or an Atlassian account email plus API token; a field saves when left; saved tokens cannot be viewed again. Credentials live on the environment's server, so select a remote environment to configure it. Git push and clone also need Git credentials or an SSH key for the host.`,
    docs: { page: "source-control.md", anchor: "connect-an-account" },
    facts: () => [],
  },
  "background-activity": {
    id: "background-activity",
    title: msg("Background activity"),
    whatItIs: msg(
      "Background activity sets how often One quietly checks things while you work, such as Git changes and whether each AI provider is healthy, and when it pauses those checks.",
    ),
    verdict: msg("Balanced suits most people. Change it to save battery or keep checks running."),
    terms: [
      {
        term: msg("Balanced"),
        meaning: msg("Pauses checks for idle clients, locked hosts, or low power mode."),
      },
      {
        term: msg("Performance"),
        meaning: msg("Keeps checks running while any connected client remains."),
      },
      {
        term: msg("Battery saver"),
        meaning: msg("Also pauses checks when the host or the client is on battery."),
      },
      {
        term: msg("Advanced"),
        meaning: msg(
          "Your own intervals for Git fetch, provider health and host power checks, and your own pause rules.",
        ),
      },
    ],
    useWhen: [msg("A laptop drains faster than it should, or provider status looks out of date.")],
    skipWhen: [msg("Nothing is wrong: Balanced is the default.")],
    question: msg("What is background activity, and should I change it?"),
    notes: `Settings, Maintenance, Background activity (a server-scoped setting). The shared policy gates background work such as Git refreshes and provider health probes after their individual intervals elapse. The profile choices are Balanced (the default: pauses probes for idle clients, locked hosts or low power mode), Performance (allows scoped background probes while any subscribed client remains connected), Battery saver (also pauses background probes when the host or client is on battery) and Advanced. Advanced, opened for an environment, sets the Git fetch interval, the provider health interval and the active and idle host power intervals in seconds, plus switches for pausing when the host is locked, on host low power, on client low power, or on battery; a row then reads "Uses custom intervals" with the shared policy named. A reset action returns it to the default. There is no separate user docs page for this setting; do not state numbers for the intervals that the facts do not give.`,
    facts: () => [],
  },
  "browser-profiles": {
    id: "browser-profiles",
    title: msg("Browser profiles"),
    whatItIs: msg(
      "A browser profile keeps its own cookies and logins for the preview browser. You can copy the sessions you are signed in to from another browser into one.",
    ),
    verdict: msg("Only useful if a site you preview needs a login you already have elsewhere."),
    useWhen: [
      msg("A page you preview asks you to sign in and you are signed in in another browser."),
    ],
    skipWhen: [msg("You only preview pages that need no login.")],
    youWillNeed: [msg("The desktop app, with the other browser closed while you import.")],
    question: msg("What are browser profiles, and should I import my sessions?"),
    notes: `Settings, Browser, Browser profiles. Profiles separate cookies and logins; incognito data is cleared when the app closes. The desktop app can import cookies from another browser so the person can reuse its signed-in sessions in the preview browser: Add profile, then choose a browser under Import from. Close the source browser before importing, and allow an operating-system keyring unlock prompt if one appears. It is a one-time copy: later login changes stay separate between the two browsers, and some sites may still ask the person to sign in again. On macOS, Safari imports need Full Disk Access: choose Allow, drag the app into the System Settings permission list and turn access on; Continue becomes available when access is detected; macOS may require quitting and reopening the app, and the person can revoke Full Disk Access after the import. On Windows, import supports Firefox, Zen and Helium profiles that use standard profile encryption; other Chromium-based browsers use app-bound encryption and cannot be imported. Partitioned cookies are skipped on all platforms. There is a profile limit; at the limit, import into an existing profile.`,
    docs: { page: "browser-import.md" },
    facts: () => [],
  },
  "settings-scope": {
    id: "settings-scope",
    title: msg("Who these settings apply to"),
    whatItIs: msg(
      "Settings here apply to every project on every computer you use. You can pick a project or a computer above to give it settings of its own.",
    ),
    verdict: msg("Leave it on All projects unless one project needs to behave differently."),
    terms: [
      {
        term: msg("Environment"),
        meaning: msg("A computer that runs your agents and holds your projects."),
      },
      {
        term: msg("Inherit"),
        meaning: msg("A project that does not set a value uses the one from the next level up."),
      },
    ],
    useWhen: [msg("One project needs a different model, workspace or provider than the rest.")],
    skipWhen: [msg("You want the same behavior everywhere.")],
    question: msg("What does choosing a project or computer here change?"),
    notes: `The sentence under a Settings page title, "Applying settings for <project> on <environment>", says which level the settings on the page edit. The same rows edit environment defaults or a project's overrides depending on the project chosen (docs/user/project-settings.md, Defaults and inheritance). Settings resolve in one order: a project override, then the environment setting, then t3.json in the repository, then the built-in default; a setting left on Inherit lets the next tier decide. When a project has several checkouts on one environment, a third choice, the checkout, narrows to one. An environment is a machine running the server that holds projects and runs agents. The bar is only shown when there is more than one project or more than one machine, or when a project is selected. Pages about this device (General, Appearance, Chat, Diffs, Snapshots, Environments, Sharing and access, About) have no bar because they are not per project.`,
    docs: { page: "project-settings.md", anchor: "defaults-and-inheritance" },
    facts: () => [],
  },
  "project-file": {
    id: "project-file",
    title: msg("t3.json"),
    whatItIs: msg(
      "t3.json is a small file a project can keep in its own folder. It holds settings and commands for that project, and travels with the project's code.",
    ),
    verdict: msg("Most people never edit it. A project only needs one if it has custom setup."),
    terms: [
      {
        term: msg("Order of settings"),
        meaning: msg(
          "A project's own override wins, then the environment setting, then t3.json, then the built-in default. Leave a setting on Inherit to let the next one decide.",
        ),
      },
    ],
    useWhen: [msg("A project needs its own commands, workspace choice or worktree setup.")],
    skipWhen: [msg("The defaults on this page already suit the project.")],
    question: msg("What is t3.json, and do I need one in my project?"),
    notes: `t3.json is a file in a project's folder (or a checkout's) that declares settings and commands for that project. Per docs/user/project-settings.md, settings a repository declares in t3.json, such as the workspace for new threads, resolve in one order: a project override, then the environment setting, then t3.json, then the built-in default; leaving a setting on Inherit lets the next tier decide. A project's t3.json actions can be imported under Settings, Projects (Import from t3.json). Other things it can hold, from the docs: "worktreeSubmodules" (how new worktrees initialize git submodules, read from the branch being checked out), "worktreeSparsePatternsPath" (a repository-relative file of git sparse-checkout patterns), "worktreeLayout" with create and remove commands, and a list that keeps a repository inside the project folder out of the project (multi-repo-projects.md). In a project with several repositories only the project folder's t3.json is read. A t3.json that fails to parse is reported on Settings, Projects, and every action and icon it declares is ignored. Do not describe fields that these docs do not name.`,
    docs: { page: "project-settings.md", anchor: "defaults-and-inheritance" },
    facts: () => [],
  },
  "provider-runtime": {
    id: "provider-runtime",
    title: msg("Advanced runtime settings"),
    whatItIs: msg(
      "These are where One finds the provider's program and its settings folder on this computer. One chooses them for you.",
    ),
    verdict: msg("Leave them alone unless you installed the provider yourself in a custom place."),
    useWhen: [
      msg("You installed the provider's program somewhere unusual and One cannot find it."),
    ],
    skipWhen: [msg("Everything already works: nothing here needs a change.")],
    question: msg("What are these runtime settings, and do I ever need to change them?"),
    notes: `On a managed Codex provider's page, the Runtime section is folded under Advanced. It lists the Binary path (selected by One), the CODEX_HOME path (shared Codex config, sessions and state), the Shadow home path (it keeps auth.json separate while sharing state from CODEX_HOME) and Launch arguments (passed to codex app-server). These are the places on the machine that runs the environment where the provider's program and settings live; One fills them in, and a person changes them only for a custom install. The provider's own account sign-in is shown above, not here. Do not suggest changing a path unless the person says One cannot find their installation.`,
    docs: { page: "providers-codex.md" },
    facts: () => [],
  },
  "usage-sign-in": {
    id: "usage-sign-in",
    title: msg("Sign in to see limits"),
    whatItIs: msg(
      "This provider can only show how much of your plan is left after you sign in to it. Until then the Usage page has nothing to read.",
    ),
    verdict: msg(
      "Sign in to its Google account and its limits can appear. You do not need to add anything else.",
    ),
    youWillNeed: [msg("The Google account you use with this provider.")],
    question: msg("Why does Usage ask me to sign in, and what happens if I do?"),
    notes: `On Usage, Limits, a provider card reading "Sign in to see limits" with a Sign in with Google button appears for an Antigravity provider whose limits are unavailable until its Google account is signed in. The button opens Settings, Providers on that provider with the sign-in action. Per providers-antigravity.md, One manages the provider's own CLI installation and sign-in, separate from the person's terminal or IDE; Sign in opens a browser sign-in and One confirms when done; from a remote device Google finishes on a page that shows a code to paste; a Google account maps to a provider instance, and a separate provider instance is added for each Google account. Other providers show their limits when they report them (see usage.md): API-key accounts may not report subscription limits. Do not promise more than that; if the person is not using Antigravity, say this row does not apply to them.`,
    docs: { page: "providers-antigravity.md" },
    facts: providerLines,
  },
  "usage-no-accounts": {
    id: "usage-no-accounts",
    title: msg("No accounts reported"),
    whatItIs: msg(
      "One reached a usage source you added, but it listed no accounts, so there is nothing to show for it on this page.",
    ),
    verdict: msg(
      "Check the source itself: it may be empty, or it may hold accounts One does not read.",
    ),
    skipWhen: [msg("You never added a usage source: this message cannot apply to you.")],
    question: msg("Why does a usage source report no accounts, and how do I fix it?"),
    notes: `The notice "<source>: No accounts reported." appears on Usage, Limits when a usage source (a hub or an HTTP source added under Settings, Providers, Usage providers) was read without an error but returned zero accounts. For a hub (CLIProxyAPI), One reads only the hub's Codex, Claude, xAI (shown as Grok) and Antigravity accounts; accounts for other providers are not read, so a hub that holds only other providers shows none; a hub with no accounts of its own shows none. For an HTTP source, the person's own server must answer a read-only GET with JSON of the form {"version":1,"accounts":[...]} with at least one account, each with windows; a response with an empty accounts list gives this notice, and the response may not exceed 1 MiB. A real failure shows a different line with the error instead. The fix is on the source side (add accounts to the hub, or return accounts from the HTTP source), then refresh Limits; the person can remove the source under Settings, Providers, Usage providers at any time. If the person did not mean to add a source, removing it clears the notice.`,
    docs: { page: "usage.md", anchor: "connect-a-cliproxyapi-hub" },
    facts: (setup) => [
      setup.usageSources.length === 0
        ? "No usage source (hub or HTTP source) is set up on this machine."
        : `Usage sources set up: ${setup.usageSources.filter((s) => s.kind === "hub").length} hub(s), ${setup.usageSources.filter((s) => s.kind === "http").length} HTTP source(s).`,
    ],
  },
};
