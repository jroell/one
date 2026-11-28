import { msg } from "gt-react";

import { EXPLAIN_ACTIONS } from "./explainActions";
import { MORE_TOPICS } from "./explainTopicsMore";
import type { ExplainTopic, ExplainTopicId, SetupSnapshot } from "./explainTypes";

/**
 * Every topic is written from what the code and docs/user say the feature does: the usage source
 * code (apps/server/src/usage, components/settings), docs/user/usage.md, text-generation.md,
 * install.md, snap-shot.md, thread-sidebar.md and project-settings.md. A claim that none of those
 * support is not in here. The visible strings are translated; `notes` is for the model, in English.
 */

const signedInProviders = (setup: SetupSnapshot) =>
  setup.providers
    .filter((provider) => provider.enabled)
    .map((provider) =>
      provider.plan === null
        ? `${provider.name} (${provider.driver}): ${provider.state}`
        : `${provider.name} (${provider.driver}): ${provider.state}, plan ${provider.plan}`,
    );

const providerFacts = (setup: SetupSnapshot): ReadonlyArray<string> =>
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

const usageFacts = (setup: SetupSnapshot): ReadonlyArray<string> => {
  const hubs = setup.usageSources.filter((source) => source.kind === "hub").length;
  const http = setup.usageSources.filter((source) => source.kind === "http").length;
  return [
    setup.usageSources.length === 0
      ? "No usage source (hub or HTTP source) is set up."
      : `Usage sources set up: ${hubs} hub(s), ${http} HTTP source(s).`,
    ...signedInProviders(setup).map((line) => `Provider on this environment: ${line}`),
  ];
};

const USAGE_NOTES = `A usage provider tells One where to read how much of a subscription is left, beyond the accounts signed in on the device. It is configured under Settings, Providers, Usage providers. What it reports appears under Usage, Limits, which pools every subscription account it can see per provider (so several Codex or Claude accounts read as one number per window). The same account seen twice counts once.
There are two kinds.
HUB: the hub is CLIProxyAPI, an open-source proxy the person runs themselves (github.com/router-for-me/CLIProxyAPI) that holds several AI accounts behind one address. One's server reads the hub's management API (path v0/management on the hub's address, authorized with the hub's management key) to list its accounts and their limits. The management key stays on the server of the environment that connects to the hub. Only the hub's Codex, Claude, xAI (shown as Grok) and Antigravity accounts are read; accounts for other providers are not. Codex accounts show banked reset credits, and a person can use one with Use reset. A hub supplies usage information only. Sending agent requests through the hub is a separate setting on the provider, and a thread uses the hub's limits only when its provider's endpoint has the same address as the hub (for example http://127.0.0.1:8317 for both). The hub address can be pasted with or without management.html at the end. The person can remove the hub from the same settings section at any time.
HTTP SOURCE: a web address of the person's own that reports quota. The chosen environment's server sends a read-only GET with Accept: application/json (and a bearer token if one was given) and shows the result under Usage, Limits. The answer must be JSON: {"version":1,"accounts":[{"id","label","providerInstanceId" (optional, the exact provider instance id on that environment, which also shows the account's windows in the thread details usage card),"windows":[{"id","kind" (session, weekly, monthly or other),"label","usedPercent" (0 to 100),"resetsAt" (optional)}]}]}. The response may not exceed 1 MiB. The person's own server handles the upstream credentials and APIs.
Not needed by: a person with one account per provider signed in on the device (Usage, Limits already shows those when the provider reports limits). API-key accounts may not report subscription limits at all.`;

const TOPICS: Readonly<Record<ExplainTopicId, ExplainTopic>> = {
  ...MORE_TOPICS,
  "usage-providers": {
    id: "usage-providers",
    title: msg("Usage providers"),
    whatItIs: msg(
      "Usage providers show how much of your AI subscriptions is left when your accounts live somewhere other than this device, such as on a server you run yourself. It appears under Usage.",
    ),
    verdict: msg(
      "Most people do not need this: if you sign in to one account per provider on this device, Usage already shows your limits.",
    ),
    terms: [
      {
        term: msg("Hub"),
        meaning: msg(
          "A proxy you run yourself (CLIProxyAPI) that holds several AI accounts behind one address.",
        ),
      },
      {
        term: msg("HTTP source"),
        meaning: msg("A web address of yours that answers with how much of a quota is used."),
      },
    ],
    useWhen: [
      msg(
        "You run several Codex or Claude accounts through a proxy of your own and want one view of what is left across them.",
      ),
      msg("You have a server of your own that tracks quota and can answer a web request."),
    ],
    skipWhen: [
      msg(
        "You use one account per provider, signed in on this device: Usage already shows those when the provider reports limits.",
      ),
      msg("You use API keys: they may not report subscription limits."),
    ],
    youWillNeed: [
      msg("For a hub: its address, its management key, and an environment that can reach it."),
      msg(
        "For an HTTP source: the full address of the endpoint, a bearer token if it asks for one, and an answer in One's JSON format.",
      ),
    ],
    question: msg("What are usage providers, and do I need one?"),
    notes: USAGE_NOTES,
    docs: { page: "usage.md", anchor: "track-subscription-limits" },
    facts: usageFacts,
  },
  "usage-hub": {
    id: "usage-hub",
    title: msg("Hub"),
    whatItIs: msg(
      "A hub is software you run yourself that gathers several AI accounts behind one address. Adding it lets One show how much each of those accounts has left.",
    ),
    verdict: msg("Only add one if you already run such a hub. One does not provide it."),
    terms: [
      {
        term: msg("CLIProxyAPI"),
        meaning: msg(
          "The open-source proxy One can read. You run it yourself, and it holds several AI accounts.",
        ),
      },
      {
        term: msg("Management key"),
        meaning: msg("The hub's own admin key. It stays on the server that connects to the hub."),
      },
    ],
    useWhen: [
      msg("You already run CLIProxyAPI, or are about to, with more than one account in it."),
    ],
    skipWhen: [
      msg("You do not run a proxy of your own. A hub is not a service that One provides."),
      msg(
        "You only want agent requests to go through a proxy: adding a hub shows usage only. The provider's own endpoint is a separate setting.",
      ),
    ],
    youWillNeed: [
      msg("The hub's address, for example https://hub.example.ts.net:8318."),
      msg("Its management key. It stays on the server that connects to the hub."),
      msg("An environment that can reach the hub."),
    ],
    question: msg("What is a hub, and should I add one?"),
    notes: USAGE_NOTES,
    docs: { page: "usage.md", anchor: "connect-a-cliproxyapi-hub" },
    facts: usageFacts,
  },
  "usage-http-source": {
    id: "usage-http-source",
    title: msg("HTTP source"),
    whatItIs: msg(
      "An HTTP source is a web address of yours that reports how much of a quota is used. One reads it and shows the numbers under Usage.",
    ),
    verdict: msg("Only useful if you have a server or script of your own that reports your usage."),
    terms: [
      {
        term: msg("Bearer token"),
        meaning: msg(
          "A secret the endpoint may ask for before it answers. Only needed if it does.",
        ),
      },
      {
        term: msg("One's JSON format"),
        meaning: msg("A fixed layout: version 1, then accounts, each with its usage windows."),
      },
    ],
    useWhen: [
      msg(
        "You have a quota server or a script of your own that tracks accounts or budgets One cannot read directly.",
      ),
    ],
    skipWhen: [
      msg("Nothing of yours reports quota in this format: One reads only this one."),
      msg("You run CLIProxyAPI: add it as a hub instead."),
    ],
    youWillNeed: [
      msg("The full address of the endpoint."),
      msg("A bearer token, only if the endpoint asks for one."),
      msg(
        "An answer in One's JSON format: version 1, with accounts and their usage windows, up to 1 MiB.",
      ),
    ],
    question: msg("What is an HTTP source, and would I use one?"),
    notes: USAGE_NOTES,
    docs: { page: "usage.md", anchor: "connect-an-http-quota-source" },
    facts: usageFacts,
  },
  "text-generators": {
    id: "text-generators",
    title: msg("Text generators"),
    whatItIs: msg(
      "A text generator is an AI service that only writes text. One can use it for small jobs, such as thread titles, commit messages and branch names, instead of starting a coding agent each time.",
    ),
    verdict: msg(
      "Optional: One already does these jobs with your coding agent. Add one only to make them faster or cheaper.",
    ),
    useWhen: [
      msg("You want those small jobs to be faster or cheaper."),
      msg("You want a model on your own machine, such as Ollama or LM Studio, to write them."),
    ],
    skipWhen: [
      msg("You are happy with the coding agent writing them, which is the default."),
      msg("You need review guides: they always use a coding agent, never a text generator."),
    ],
    youWillNeed: [
      msg("For OpenAI, Anthropic or OpenRouter: an API key."),
      msg(
        "For any other OpenAI-compatible service: its base address. Local ones usually need no key.",
      ),
    ],
    question: msg("What are text generators, and should I add one?"),
    notes: `Text generators are configured under Settings, Providers, Text generators (Add generator). By default a coding agent such as Codex or Claude writes One's small text: thread titles, commit messages, pull request titles and descriptions, branch names, and voice transcript cleanup, starting a session for each request. A text generator is a model API that only writes text, usually faster and cheaper. Services: OpenAI or Anthropic (API key), OpenRouter (an OpenRouter key, any model it serves), or Custom (OpenAI-compatible: the base URL of another endpoint such as Ollama at http://localhost:11434/v1 or LM Studio; local endpoints usually need no key). The environment's server makes the requests, so on a remote environment localhost means that machine, not the person's. The key is stored on the environment like other secrets and can come from a secret provider. One lists the service's models to check the connection, then shows a model picker for each text task (Settings, Threads, Text generation model; Source control and issues and Voice can each pick their own). Test next to a picker has the chosen model answer a tiny prompt, which proves the key works. Each request sends the API what the task needs, for example the staged diff for a commit message. Turning a generator off or removing it sends its work back to the environment's text generation model. Review guides read the checkout over many steps, so they always use a coding agent (Codex or Claude); if the source control writer model is a text generator, review guides use Codex or Claude instead and fail if neither is set up. A managed policy that limits providers also turns text generators off.`,
    docs: { page: "text-generation.md" },
    facts: (setup) => [
      setup.textGenerators.length === 0
        ? "No text generator is set up."
        : `Text generators set up: ${setup.textGenerators.map((generator) => `${generator.service} (${generator.enabled ? "on" : "off"})`).join(", ")}.`,
      ...signedInProviders(setup).map((line) => `Coding agent available to write text: ${line}`),
    ],
  },
  providers: {
    id: "providers",
    title: msg("Providers"),
    whatItIs: msg(
      "A provider is a coding agent that One works with, such as Codex or Claude. Add provider connects another account or another agent.",
    ),
    verdict: msg("If your providers already say Ready, you do not need to add anything."),
    useWhen: [
      msg("You want a second account of the same provider, such as a work and a personal one."),
      msg(
        "You want a provider that is not in the list yet, including other agents under Show more.",
      ),
    ],
    skipWhen: [
      msg("One account of each provider is enough: the ones already listed work as they are."),
    ],
    youWillNeed: [
      msg(
        "The provider's command line tool installed on the machine that runs this environment, and signed in. Codex through ChatGPT and Antigravity can use their own managed runtimes.",
      ),
    ],
    question: msg("What is a provider, and when would I add another?"),
    notes: `Providers are configured under Settings, Providers. A provider is a coding agent harness One drives: Codex, Claude, Cursor, Grok Build, Kiro, OpenCode, Antigravity, Pi, Muse Code, fx, and ACP Registry agents (such as GitHub Copilot) under Add provider, Show more. One is not itself a harness; it uses the provider's. Installation, login and configuration belong to the environment's machine, even when the person connects from a phone or another computer. Install and sign in: Codex via Connect with ChatGPT or the Codex CLI and codex login; Claude via Claude Code and claude auth login; Cursor via the Cursor CLI and agent login; Grok Build via grok login; Kiro via kiro-cli login; OpenCode via opencode auth login; Antigravity signs in with Google from One's provider settings; Pi needs Node.js 22.19 or newer then pi and /login; Muse Code via muse login on the server; fx via fx login. Provider command line tools must be on the server's PATH; if One cannot find one, set its Binary path in the provider's settings. Add provider adds an account or configures a provider on the environment, for example a second Codex or Claude account kept apart from the first; a separate work account is fine, and the docs show setup for two accounts. For a much larger pool of accounts, people manage them outside One with a self-hosted proxy such as CLIProxyAPI and can connect it as a hub under Usage providers to see its limits.`,
    docs: { page: "install.md", anchor: "providers" },
    facts: providerFacts,
  },
  "provider-status": {
    id: "provider-status",
    title: msg("Provider labels"),
    whatItIs: msg(
      "Each provider has a label that says what the server found the last time it checked.",
    ),
    verdict: msg("Ready is good. Any other label says why on the line under the name."),
    terms: [
      {
        term: msg("Ready"),
        meaning: msg("It is installed and works."),
      },
      {
        term: msg("Needs attention"),
        meaning: msg("The server found something to fix, such as a missing sign-in."),
      },
      {
        term: msg("Failed"),
        meaning: msg("It did not pass its start-up checks."),
      },
      {
        term: msg("Off"),
        meaning: msg("You turned it off, so new threads do not use it."),
      },
      {
        term: msg("Checking"),
        meaning: msg("The server has not reported on it yet."),
      },
    ],
    question: msg("What do the provider labels mean, and what should I do about one?"),
    notes: `The chip on each provider row in Settings, Providers reflects the server's last check: Ready (installed and working), Needs attention (a warning: installed but the server could not fully verify it, or a problem such as not being signed in), Failed (the provider failed its startup checks), Off (disabled for new sessions in One), Checking (the server has not reported on this provider yet, which is normal right after start-up or after adding one). The line under the name carries the reason: Not found means the command line tool was not detected on the server's PATH (fix: install it or set its Binary path); Not authenticated means it needs signing in (run the provider's login command on the environment's machine, or use the sign-in in the provider's settings); a plan name such as ChatGPT Pro means it is signed in. Refresh provider status re-checks all providers. Provider check timeouts can make a slow provider look unhealthy; the docs describe them.`,
    docs: { page: "install.md", anchor: "providers" },
    facts: providerFacts,
  },
  snapshots: {
    id: "snapshots",
    title: msg("Snapshots"),
    whatItIs: msg(
      "A snapshot captures a window you are working in and attaches it to your draft, so an agent can see what you see.",
    ),
    verdict: msg("Only works in the desktop app. In a browser you can skip this page."),
    useWhen: [msg("You want an agent to look at an error dialog or another app's window.")],
    skipWhen: [
      msg(
        "You work only in the browser: a web page cannot see other windows, so snapshots need the desktop app.",
      ),
    ],
    youWillNeed: [
      msg("The desktop app on macOS, Windows, or Linux with Wayland. X11 is not supported."),
      msg(
        "On macOS, permission for Screen Recording, and for Accessibility if you include app text.",
      ),
    ],
    question: msg("What are snapshots, and would I use them?"),
    notes: `Snapshots (SnapShots) are off by default and available in the desktop app on macOS, Windows and Linux with Wayland; X11 sessions are not supported. A capture takes the window the person is working in and attaches it to the current draft, with the app name and window title and, when available, the app icon and the window's accessibility data (its controls, text and positions in the image). Setup under Settings, Snapshots has two steps: allow capture, then choose a shortcut. macOS asks for Screen Recording during setup and for Accessibility only when Include app text is on; Windows needs no setup or permission; Linux depends on the desktop. The default shortcut on macOS and Windows is both Shift keys together. Pressing the shortcut while One is in front captures One itself. Turning capture off releases the shortcut; it does not uninstall a helper or extension that was installed. In a browser the page cannot see other windows, so the web version only offers to get the desktop app.`,
    docs: { page: "snap-shot.md" },
    facts: () => [],
  },
  "scheduled-tasks": {
    id: "scheduled-tasks",
    title: msg("Scheduled tasks"),
    whatItIs: msg(
      "A scheduled task sends one prompt to an agent on its own, on a timer or when another service calls a web address.",
    ),
    verdict: msg(
      "Skip it unless you want the same request to run by itself, such as every morning.",
    ),
    useWhen: [
      msg("You want the same prompt on a rhythm, such as a summary of open work every morning."),
      msg("Another service, such as GitHub or a CI job, should start a run through a webhook."),
    ],
    skipWhen: [msg("The work has stages with your approval in between: use a workflow instead.")],
    youWillNeed: [
      msg("A connected environment and a project to run in."),
      msg("For a webhook from the internet: a T3 Connect managed tunnel for the address."),
    ],
    question: msg("What are scheduled tasks, and could they help me?"),
    notes: `Scheduled tasks are under Settings, Scheduled tasks. A task runs one prompt on a timer or when a webhook URL is called ("On webhook"), or once at a chosen date and time ("Once"). Each task runs on the environment the person chooses, using its project, model and workspace settings; fixed-time schedules use that environment's time zone, which may differ from the phone's. Destination says where runs go: New thread each run keeps every run separate; the two one-thread choices start a thread on the first run and post later runs there (one continues the same conversation; the other starts each run in a fresh session that does not see earlier runs). Tasks can be edited, paused, resumed, run now, or deleted; webhook tasks only run when their URL is called, so they cannot be run now. A public webhook URL needs a T3 Connect managed tunnel; after saving the task the URL is copied from the editor, and Rotate replaces it. The prompt can use placeholders such as {{body.path}}, {{headers.name}}, {{query.name}}, {{body}} and {{request}}; values reach the agent wrapped in tags and marked as untrusted request data. A task that posts into one thread keeps running after that thread is archived, and each run fails, so settle the thread instead or move or pause the task. Deleting a thread also deletes tasks that post into it. For work with stages (triage, a fix, approval, a release) a workflow fits better than a scheduled task.`,
    docs: { page: "project-settings.md", anchor: "scheduled-tasks-on-mobile" },
    facts: () => [],
  },
  devices: {
    id: "devices",
    title: msg("Devices"),
    whatItIs: msg(
      "The Device panel shows a live iPhone simulator or Android emulator next to a thread, so you can watch an agent test a mobile app and tap the device yourself.",
    ),
    verdict: msg("Only useful if you build iPhone or Android apps."),
    terms: [
      {
        term: msg("Use devices"),
        meaning: msg("Turns the Device panel on. Turning it off stops devices from opening."),
      },
      {
        term: msg("Agents can use devices"),
        meaning: msg(
          "Lets agents drive a device on their own. One installs and starts the tool for that only after this is on. Your own Device panel works either way.",
        ),
      },
    ],
    useWhen: [msg("You want to watch an agent check mobile work on a simulator or emulator.")],
    skipWhen: [msg("You do not build mobile apps.")],
    youWillNeed: [
      msg("An iPhone simulator or an Android emulator on the machine that runs the environment."),
    ],
    question: msg("What are devices, and do I need to turn them on?"),
    notes: `Devices are under Settings, Devices. The Device panel (open the right panel in a project thread and choose Device) shows a live iOS Simulator or Android Emulator next to a thread so the person can watch an agent verify mobile work and tap the device themselves; agents get the same device through device_* tools and the agent-device command line, which One sets up for them. On first use the panel walks through three steps: starting the device hub, checking iOS and Android support, and choosing whether agents may control devices; opening the panel alone does not download or start anything. Use devices (Settings, Devices) turns the feature on; Agents can use devices controls whether agents may drive devices: One installs and starts the agent-device command line only after it is on, turning it off hides the device tools from agents started from then on, and the person's own Device panel is unaffected. iOS taps build a small test runner on first use, which takes a couple of minutes once per server. Restart an existing agent session after granting access so it receives the device CLI environment. The connected server manages the device hub and agent tools on its own machine and configured SSH hosts. There is also an alpha for leasing simulators from a Simlock pool under Labs.`,
    docs: { page: "devices.md", anchor: "agents-and-devices" },
    facts: () => [],
  },
  "guest-links": {
    id: "guest-links",
    title: msg("Guest links"),
    whatItIs: msg(
      "A guest link lets one person follow a single thread in their browser and ask the agent questions, without an account.",
    ),
    verdict: msg("Beta. Only needed when you want someone else to follow one of your threads."),
    useWhen: [msg("A teammate should watch a thread as it streams and ask the agent questions.")],
    skipWhen: [
      msg(
        "The thread holds anything you would not want to show: the guest can see what the agent read or printed.",
      ),
    ],
    youWillNeed: [
      msg(
        "T3 Connect: you sign in and link this machine, because the link points at its T3 Connect address.",
      ),
      msg("The machine kept online while the guest uses the link."),
    ],
    question: msg("What are guest links, and is it safe to turn them on?"),
    notes: `Guest links are a beta, turned on under Settings, Labs, Guest links for the machine that runs the thread. They also need T3 Connect (sign in and link the machine, because the link points at its T3 Connect address), and the machine must stay online while the guest uses it. While the setting is off, every guest link on that machine stops working; links that have not expired work again when it is turned back on. To share: right-click the thread in the sidebar and choose Share with guest (also in the thread menu and the command palette; long-press the thread in the mobile app). Copy the link and send it to one person: it works in one browser and expires after 24 hours; opening it again in that browser returns to the thread. When the guest sends a message it appears at the end of the thread and the sidebar shows Request; the person chooses Send (runs as a normal turn) or Dismiss. Stop sharing ends the link at once; archiving the thread, creating a new link, or unlinking the machine from T3 Connect also ends it. The guest sees the thread's recent history and everything after, as it streams: messages and files, the agent's replies with images from the machine, reasoning, plans, questions, and its work, with command output when expanded. They cannot change the model, see diffs, fork, revert, open files on the machine, or answer the agent for the person. Anything the agent read or printed can show, such as a value from a file, so only threads the person is comfortable showing should be shared. Guests can attach images (PNG, JPEG, GIF, WebP) and other files: up to 4 files and 10 MB per message, 20 MB while messages wait.`,
    docs: { page: "guest-links.md", anchor: "share-a-thread" },
    facts: () => [],
  },
  "linked-environments": {
    id: "linked-environments",
    title: msg("Linked environments"),
    whatItIs: msg(
      "Linking two of your machines, such as a laptop and a server, lets agents on one work on the other: start its threads, message them, and answer their questions.",
    ),
    verdict: msg("Beta. Only useful if you use more than one machine with One."),
    useWhen: [
      msg("You run agents on one machine and want them to work on your projects on another."),
    ],
    skipWhen: [msg("You use One on a single machine.")],
    youWillNeed: [
      msg("The setting turned on on both machines."),
      msg("A way to link them: Settings, Environments, Linked environments, Link."),
    ],
    question: msg("What are linked environments, and do I need them?"),
    notes: `Linked environments is a beta: turned on under Settings, Labs on both machines. While it is off on either machine, agents start nothing over a link between them; a task already running on the other machine still finishes, and if that machine has it off, its result arrives once it is back on. Linked machines let an agent on one launch, message, wait on and stop the other's threads, answer their questions, and manage its queues, projects and scheduled tasks. On the machine to work from, open Settings, Environments, Linked environments, choose Link, and pick the other machine or enter its address; the list holds the machines this app knows and those on the person's T3 Connect account. If the app has an address for that machine and a session that manages access there, it makes the pairing code itself; otherwise the code is pasted from that machine's Settings, Sharing & access. An address typed in always needs a pasted code. Link several appears once two other machines are saved. For a headless server, open its address in a browser and pair to reach its Settings, Labs. A linked environment paired below full access gets no worktree in a project (see the multi-repo docs).`,
    docs: { page: "remote-access.md", anchor: "link-another-environment" },
    facts: () => [],
  },
  workflows: {
    id: "workflows",
    title: msg("Workflows"),
    whatItIs: msg(
      "A workflow is a script that chains agents, plain code and questions to you into one run that survives restarts.",
    ),
    verdict: msg(
      "Early feature, off by default. For one request on a timer, use a scheduled task instead.",
    ),
    useWhen: [msg("Work has stages, such as triage, a fix, your approval and a release.")],
    skipWhen: [msg("One prompt on a timer or a web call is all you need.")],
    youWillNeed: [
      msg("This setting on for the server that runs them."),
      msg("A workflow file in the server's workflows folder: an agent can write one for you."),
    ],
    question: msg("What are workflows, and when would I use one instead of a scheduled task?"),
    notes: `A workflow is a TypeScript script that chains agents, plain code, schedules, webhooks, issue and pull request events, and questions to the person into one durable run that survives server restarts; each step's result is saved when it succeeds, so restarts pick up where the run left off. Workflows are an early feature: runs start from the t3 CLI or a trigger and are followed in the app. For one prompt on a timer or webhook use a scheduled task; use a workflow when work has stages such as triage, a fix, approval and a release. Turn on Settings, Labs, Workflows for the server that runs them (off by default); while off, nothing in the workflows folder runs and the t3 workflow command says how to turn it on; runs are kept and continue once it is on again. Workflow files live in ~/.t3/workflows/ (or where T3CODE_WORKFLOWS points); the server watches the folder and reloads changes. The recommended way to create one is to ask an agent, using the t3-workflows skill.`,
    docs: { page: "workflows.md", anchor: "turn-on-workflows" },
    facts: () => [],
  },
  "preview-tunnel": {
    id: "preview-tunnel",
    title: msg("Preview tunnel"),
    whatItIs: msg(
      "The preview tunnel lets your other devices load this machine's local pages themselves, for example a development server an agent started, instead of only watching a stream of it.",
    ),
    verdict: msg(
      "Leave it on if you use One from a phone or another computer; turn it off to stop that.",
    ),
    useWhen: [msg("You open this machine's local pages from a phone or another computer.")],
    skipWhen: [
      msg(
        "You want to stop other devices loading those pages directly. Browser tabs then keep working by streaming from this machine.",
      ),
    ],
    question: msg("What does the preview tunnel do, and should I turn it off?"),
    notes: `The Preview tunnel is a setting under Settings, Sharing & access on the host machine. It carries the browser tabs' access to the host's localhost pages: port forwarding and Open on this device (in the menu of a tab showing one of the host's localhost pages, or a long press on a localhost link in chat on a phone). When it is off on the host, other devices cannot load its localhost pages themselves: port forwarding and Open on this device go away and open tunnels close; tabs keep working by streaming from the host, so anyone who can use the host's browser tabs can still view its localhost pages there. An administrator can also turn it off with a managed policy. The host's local servers listen only on the computer's loopback, never on the network; on Linux they accept only apps running as the user, while on macOS and Windows other users signed in to the same computer can reach them too. On iPhone and iPad the page runs under a stand-in address while the address bar shows localhost, so browser features that need a secure page, such as the clipboard or service workers, are not available there.`,
    docs: { page: "remote-access.md", anchor: "browser-on-a-remote-environment" },
    facts: () => [],
  },
  archive: {
    id: "archive",
    title: msg("Archive"),
    whatItIs: msg(
      "The archive holds threads you set aside. An archived thread leaves the sidebar and search until you unarchive or delete it.",
    ),
    verdict: msg(
      "Nothing to set up here: archive a thread from its menu in the sidebar when you want it out of the way.",
    ),
    useWhen: [msg("You want a thread out of the way but not deleted.")],
    skipWhen: [
      msg(
        "You will be back soon: settle the thread instead. A settled thread stays in the sidebar, and a new message wakes it.",
      ),
    ],
    question: msg("What does archiving a thread do, and should I archive or settle?"),
    notes: `Archive is for work the person wants out of the way. An archived thread leaves the sidebar and search and shows only in Settings, Archive, where it can be unarchived or deleted. It refuses new messages, including ones from agents and scheduled tasks, until it is unarchived. Settle is for work that is done for now: a settled thread stays in the sidebar's Settled section and in search, and a message to it from the person, an agent or a scheduled task makes it active again. A scheduled task that posts into one thread keeps running after that thread is archived, and each run fails; settle the thread instead, or move or pause the task. Removing a project deletes its threads either way. A thread is archived from its menu in the sidebar.`,
    docs: { page: "thread-sidebar.md", anchor: "settle-or-archive" },
    facts: () => [],
  },
};

export function explainTopic(id: ExplainTopicId): ExplainTopic {
  return { ...TOPICS[id], actions: EXPLAIN_ACTIONS[id] };
}

export const EXPLAIN_TOPIC_IDS = Object.keys(TOPICS) as ReadonlyArray<ExplainTopicId>;

/** Where the docs pages live; the same address the app's other links use. */
const DOCS_BASE = "https://github.com/jroell/one/blob/custom/main/docs/user/";

export function explainDocsUrl(topic: ExplainTopic): string | null {
  if (topic.docs === undefined) return null;
  return `${DOCS_BASE}${topic.docs.page}${topic.docs.anchor === undefined ? "" : `#${topic.docs.anchor}`}`;
}
