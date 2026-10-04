# genesis-dashboard

Build Genesis Dashboard - a web dashboard that shows a human the state of a Genesis dev system at a glance.

A Genesis dev system keeps all of its state in GitHub: milestones, task issues, the needs:human gates waiting on a person, pull requests, and CI results. All of it is there, but it's scattered across issues, labels, and checks, and a human has to click through a dozen pages to answer simple questions like "is anything waiting on me?", "is anything stuck?", and "how far along is the current milestone?". Genesis Dashboard answers those questions on one page.

Point it at a dev-system repository (for example Sayfan-AI/MaKlaude) and it shows:
- The roadmap: each milestone, whether it's planned, active, or done, and progress within the active one.
- Open needs:human gates, oldest first, with how long each has been waiting.
- Open pull requests and their CI state, highlighting any that are stalled, such as green but unmerged, or red with nobody working on them.
- Recent activity: what merged, closed, and opened lately.

It is a static site, published with GitHub Pages, that reads public data from the GitHub API in the browser. No server and no stored credentials.

A second capability comes after the dashboard works: a chat panel where a human can ask questions about that state in plain language ("what's blocking milestone 6?"). It talks to a local model through Ollama's OpenAI-compatible API on localhost, so it only appears when the dashboard runs locally, and the published site stays read-only.

Guiding principles, not a blueprint - you decide the architecture, framework, and tools:
- Small and finished beats large and partial. Keep the roadmap to two milestones: the dashboard first, the chat panel second.
- Read-only. The dashboard never writes to GitHub.
- Deterministic where possible. Everything except the chat answers is computed from GitHub data and covered by tests. The chat is tested against a stubbed model endpoint.
- Useful on day one. It should work against any Genesis dev system, not only MaKlaude.

Important boundary: the human chooses which repositories to point the dashboard at and runs Ollama locally. Building the dashboard and the chat panel is your job.


## Setup

This repo runs autonomously via GitHub Actions, but **genesis ships those workflows disabled and with no secrets**. They authenticate as the Genesis GitHub App and call the Anthropic API, so running them before the credentials exist would just fail on every trigger. The repo and issue #1 already exist; the autonomous loop stays dormant until you activate it.

1. **Install the Genesis GitHub App** on this repository, granting it `contents`, `issues`, `pull-requests`, and `workflows` permissions.

2. **Activate the dev system** — from a clone of this repo, run one command:

   ```bash
   .genesis/scripts/activate.sh
   ```

   It reads the App ID, App private key, and Anthropic key from your `~/.config/genesis/.env` (shared across all your genesis projects), verifies the App is installed here, sets them as this repo's Actions secrets, and enables the workflows. It refuses to run if any value is missing/placeholder or the App isn't installed. The next trigger (an issue/PR/comment event, a push, or the cron) then wakes the orchestrator and onboarding begins on issue #1.

3. **(Optional) Observability & notifications** — to ship agent activity logs to Grafana Cloud Loki, add all three of `GENESIS_LOKI_URL` (the Loki host, no path), `GENESIS_LOKI_USER` (numeric instance ID), and `GENESIS_LOKI_TOKEN` to `~/.config/genesis/.env` **before** running `activate.sh` — it seeds them as repo secrets and the workflows pass them to the logging hooks. Without them, Actions runs leave no activity trail at all — Claude Code captures hook stderr into its own transcript rather than the Actions run log, so Loki is the only place these logs can land. Configure the A2H gateway if you want Slack/email instead of GitHub-issue comms.

---

*Bootstrapped by [Genesis](https://github.com/Sayfan-AI/genesis) — an autonomous agentic AI dev system.*
