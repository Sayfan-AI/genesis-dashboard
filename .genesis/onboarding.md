# Onboarding: genesis-dashboard

## Goal

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




## Instructions

This is the onboarding issue — the one-time handoff from goal to roadmap. The onboarding agent (via the human interaction agent) should:

1. Review the goal above and ask the human clarifying questions until the goal is well understood.
2. Break the goal into high-level milestones, each with clear done criteria. Detail only milestone 1's intent — keep later milestones high-level (incremental planning).
3. Keep architecture out of the roadmap. Milestones say what the system will be able to do and how you'll know it works — not what agents, roles, or components it will be built from, and *especially* not as a recommended default the human's silence would accept. Naming a roster here fixes the shape of the system before anything has been built and before anything has been seen to fail; roles arrive later, from the evolver, with evidence attached. If the goal above admires some existing multi-agent design, that's inspiration, not a specification.
4. Record the agreed milestone roadmap in this issue (description or a comment) so it persists after the issue is closed.
5. Label this issue `needs:human` and **STOP**. Do NOT plan tasks, create task issues, or start any work.

Onboarding is complete when **the human closes this issue** — that close is the human's approval of the roadmap. After it closes, the orchestrator picks up milestone 1 through the standard milestone-plan gate: it proposes the milestone 1 task breakdown in a `Milestone 1 plan` issue (`needs:human`) and waits for the human to approve that too before any work begins.
