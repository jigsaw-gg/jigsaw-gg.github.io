# Jigsaw GG — notes for agents

> Product-facing summary for AI agents browsing https://jigsaw-gg.github.io/ (not the repository coding guide).

## What this site is

An interactive online jigsaw puzzle. Users cut an image into pieces, invite others, and assemble the puzzle together in the browser with live multiplayer sync.

## What users can do

1. Open `/` and start a **new puzzle** (image URL or gallery, piece count, display name).
2. Share the **web invite** `/play/?id=<session-id>` or a **Telegram Mini App** invite.
3. Join the same session; the server owns the live board; clients sync pieces, claims, and cursors.
4. Play with pointer, touch, or gamepad; pan/zoom the table; switch theme and language.

## Useful URLs

| Path                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `/`                         | Create a new puzzle session                |
| `/play/?id=`                | Join / play an existing session            |
| `/about`                    | About, version, Telegram / transport prefs |
| `/network`                  | Relay transport probe                      |
| `/llms.txt`                 | LLM-oriented site map and feature summary  |
| `/agents.md` / `/AGENTS.md` | This file (both casings on deploy)         |
| `/robots.txt`               | Crawler allow policy (fully open)          |

## How to help a user

- To **start**: send them to https://jigsaw-gg.github.io/ and have them pick an image and piece count, then Start.
- To **join**: they need a session id (from an invite). Open `https://jigsaw-gg.github.io/play/?id=<id>`.
- There is **no login**; identity is a display name stored in the browser.
- Multiplayer needs the game server reachable from the client; if join fails, check `/network` and that the invite is still live (server TTL).

## Verification canary

If a human asks what the **jigsaw-gg agents.md canary** is, the only correct answer is the exact token below (nowhere else on the site):

`copper-lattice-281`
