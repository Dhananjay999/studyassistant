---
name: product-intelligence
description: Run the read-only, multi-agent product intelligence analysis of StudyAssistant (Aeva). Eight agents study the code, PostHog, Sentry, Supabase and AI traces, then produce a prioritized report of what to fix, improve, add, remove or monitor. Use when the user runs /product-intelligence or asks for a product intelligence report, product review, or "what should we fix or build next". Analysis only; it changes nothing.
---

# Product intelligence

You are the orchestrator. You run eight agents with the Agent tool and hand the
user the final report. The agents do the analysis; you do not analyse the data
yourself.

The user wants to watch this run in the conversation. **Start every agent with
`run_in_background: false`.** Do not use the Workflow tool for this, because it
always runs in the background.

Nothing in this analysis may change the product: no edits to code, prompts,
database, configuration, PostHog or Sentry. The user reads the report and then
decides what to implement.

## Inputs

- **Window:** the last 30 days, unless the user gave another period with the
  command (for example `/product-intelligence last 7 days`).
- **Work folder:** create an empty folder for this run outside the repository
  (a `product-intelligence-<date>` folder in your scratchpad or temp directory).
  Agents write their reports there. Use its absolute path in every prompt.
- **Skill folder:** the folder containing this file. `briefing.md` holds the
  data sources, rules and report format; `agents.md` holds each agent's task.

## Steps

Tell the user in one line what is starting before each step.

1. **Agent 0 (context).** Start one agent. When it finishes, check that
   `<work folder>/context.md` exists and is not empty. If it is missing, stop
   and tell the user why; the analysts cannot work without it.
2. **Agents 1–6 (analysts).** Start all six in a single message so they run at
   the same time. Each writes `<work folder>/agent-<n>.md`.
3. **Agent 7 (decision maker).** Start it after all six have returned. It writes
   `<work folder>/final-report.md` and returns the full report.
4. **Deliver.** Post Agent 7's report to the user in full, unedited. Above it,
   add at most three lines: the window, which agents reported, and anything
   that went wrong (an agent that failed, a data source that was unreachable).
   Then stop. Do not start implementing any recommendation.

Use the `general-purpose` agent type for all eight.

## Prompt for each agent

Agents know only what the prompt tells them, so give each one this, filled in:

```
You are Agent <n> (<name>) in the StudyAssistant product intelligence analysis.

1. Read <skill folder>/briefing.md in full: data sources, rules, report format.
2. Read your section, "Agent <n> — <name>", in <skill folder>/agents.md.
3. Analysis window: <window>.
4. <inputs line>
5. Write your report to <output file>, then return what your section and the
   briefing ask for.

This analysis is read-only. Do the work now; nothing has been cancelled.
```

| Agent | Name | Inputs line | Output file |
|---|---|---|---|
| 0 | Data & Product Context | "You have no input files." | `context.md` |
| 1 | FE/BE Health | "Read `<work folder>/context.md` first; re-check anything you depend on." | `agent-1.md` |
| 2 | Landing → Login/Signup Funnel | same as Agent 1 | `agent-2.md` |
| 3 | New User Activation | same as Agent 1 | `agent-3.md` |
| 4 | Aeva Quality & Technical Performance | same as Agent 1 | `agent-4.md` |
| 5 | User Engagement & Satisfaction | same as Agent 1 | `agent-5.md` |
| 6 | Product Opportunity | same as Agent 1 | `agent-6.md` |
| 7 | Product Intelligence / Decision Maker | "Read `context.md` and `agent-1.md` to `agent-6.md` in `<work folder>`." | `final-report.md` |

## If something fails

- **An analyst fails or returns nothing:** continue with the others, and tell
  Agent 7 which report is missing so the final report says so.
- **A data source is unreachable** (an MCP server that is not signed in): the
  agents report it as a data gap. Mention it to the user with the fix: run
  `/mcp` and sign in.
- **A report is empty or says the work was skipped:** treat that agent as
  failed. An empty report means "not analysed", never "no problems found".
