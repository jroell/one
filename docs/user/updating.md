# Updating One

One is built from [the One repository](https://github.com/jroell/one), so updating One means pulling the latest code and building again. The repository takes in upstream T3 Code improvements and fixes every day, so pulling also brings those.

Clients and servers can run on different machines and must share a compatible orchestration protocol. Update every machine you connect to from the same code.

## Update One

From your clone of the repository:

```bash
git pull
vp i
```

Then restart what you run:

| What you run                         | Next step                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `vp run dev` or `vp run dev:desktop` | Stop it and start it again.                                                              |
| A desktop app you built              | Build the installer again ([Install One](./install.md#desktop-app)) and replace the app. |
| The `t3` background service          | Reinstall the desktop app, then run `t3 service restart`.                                |
| The mobile app                       | Build it again from `apps/mobile` ([Install One](./install.md#mobile-app)).              |

A desktop app you built does not update itself, and the mobile app has no over-the-air updates.

## What not to use on a One machine

These install upstream T3 Code in place of One:

- `t3 update`, and **Update server** for a machine that runs the `t3` background service.
- The `t3.codes` install scripts and `npx t3`.
- Homebrew, winget, Scoop, AUR, Nix, the App Store, and Google Play.

Machines you added over SSH already run upstream's `t3` server ([Install One](./install.md#remote-machines-over-ssh)), so updating those from **Settings → Environments** is fine.

## Update providers

Open **Settings → Providers** and click **Update now** on individual providers or **Update all** across connected environments. The **Update** button at the bottom of the sidebar also updates outdated providers. Running chats keep using their current CLI until they end; new sessions and model catalogs refresh automatically. (Provider update checks in **Settings → Maintenance** must be enabled to fetch model catalog updates.)

## Continue threads after restarts

**Settings → Maintenance → Continue threads after restarts** is enabled by default. After an update, crash, or reboot (once One starts again), supported active threads automatically resume, and threads waiting on subagents or monitors are woken and notified that background work stopped.

- Threads waiting for your approval, answer, or secret, and archived, snoozed, or settled threads, are not auto-resumed.
- After 3 consecutive crash recoveries of an unfinished turn, the thread waits for your next message.
- Coming from T3 Code V1? Read [Threads from older T3 Code versions](./thread-migration.md).

## Troubleshooting

- **Version mismatch**: Update whichever side (app or server) the connection notice names, from the same code.
- **Failed update**: Run `vp i` again, confirm you rebuilt on the host machine (not just the client), and check that only one server owns the One home directory (`~/.one` for an installed app).
- **Desktop won't start**: Use **Copy details** in the recovery window for a bug report, then rebuild from the last commit that worked (`git checkout <commit>`, `vp i`, build again).
