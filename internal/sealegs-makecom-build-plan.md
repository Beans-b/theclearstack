# SeaLegs — Make.com Build Plan
**The Clear Stack · Phase 01: Internal OS**

---

| Field | Value |
|---|---|
| Version | 1.0 |
| Last updated | June 2026 |
| Owner | Brian Burge |
| Active stage | Stage 01 |
| Phase | 01 — Internal OS |
| Phase complete when | T1 Bridge books first meeting autonomously |

---

## Progress tracker

| Stage | Title | Status |
|---|---|---|
| 01 | Secure foundation | ⬜ Not started |
| 02 | Data layer | ⬜ Not started |
| 03 | T3 worker build — revenue | ⬜ Not started |
| 04 | T2 Research — Stack Discovery | ⬜ Not started |
| 05 | T1 Bridge — revenue orchestration | ⬜ Not started |
| 06 | T2 Outreach — sequence execution | ⬜ Not started |
| 07 | Operations chain — Helm, Content, Support | ⬜ Not started |
| 08 | Guardrails & security hardening | ⬜ Not started |
| 09 | End-to-end test & first autonomous run | ⬜ Not started |

**Status key:** ⬜ Not started · 🔄 In progress · ✅ Complete · 🚫 Blocked

---

## Stage 01 — Secure foundation
**Tag:** Infrastructure · **Security:** Critical

> Everything downstream is only as secure as this layer. No scenarios run until this is locked.

**Action items:**
- [ ] Create Make.com organization account — define team roles and permission levels
- [ ] Establish folder structure: /Revenue Chain · /Operations Chain · /Monitoring
- [ ] Store ALL API credentials as Make.com environment variables — zero credentials in scenario logic, ever
- [ ] Create separate API keys per agent tier (T1, T2, T3) — least privilege, no cross-tier sharing
- [ ] Document webhook URL policy — treat as secrets, rotation schedule defined before first use
- [ ] Document quarterly key rotation schedule in ops calendar with owner assigned

**Milestone:** Zero credentials in scenario logic. Folder structure confirmed. Security policy documented before any scenario is built.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 02 — Data layer
**Tag:** Supabase Schema · **Security:** Critical

> Every agent action is logged. Every client is scoped. RLS enforced before any live scenario runs.

**Action items:**
- [ ] Design schema: prospects · stack_reports · outreach_sequences · client_interactions · agent_logs · error_log · agent_sessions
- [ ] Enforce client_id on all records — prevents cross-client data contamination at the row level
- [ ] Implement Row Level Security (RLS) by agent_id — no agent reads outside its designated scope
- [ ] Build error_log with required fields: agent_id · tier · error_type · timestamp · escalated_to
- [ ] Create agent_sessions table for signed inter-agent session tokens
- [ ] Test RLS — verify no cross-client data access is possible under any query condition

**Milestone:** Schema live. RLS tested and confirmed. No cross-client data access achievable under any condition.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 03 — T3 worker build — revenue
**Tag:** Worker Agents · **Security:** Touchpoint

> Build and test each worker in isolation. No worker connects to the chain until it passes independently.

**Action items:**
- [ ] Build T3 Stack Scanner: BuiltWith API → structured output schema (tools · categories · confidence score)
- [ ] Build T3 Enricher: Apollo.io → company size · revenue range · key contacts · verified output schema
- [ ] Build T3 Signal Puller: LinkedIn job postings → tool mention extraction · structured output
- [ ] Define and enforce output validation schema per worker — required fields must populate or the record fails
- [ ] Test each worker independently against 10 sample domains
- [ ] Build failure logic: failed output → log to error_log → escalate to T2 · never silently continue

**Milestone:** All 3 T3 workers produce valid, schema-compliant output against test domains. Failure escalation path verified on intentional error.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 04 — T2 Research — Stack Discovery
**Tag:** Department Agent · **Security:** Touchpoint

> T2 Research orchestrates all three T3 workers and compiles the Stack Discovery Report before any prospect is contacted.

**Action items:**
- [ ] Build T2 Research scenario — receives ICP parameters from T1 Bridge (stub input for now)
- [ ] Fire T3 Stack Scanner, T3 Enricher, and T3 Signal Puller in parallel Make.com branches
- [ ] Aggregate outputs into Stack Discovery Report — defined fields only, no loose data passed forward
- [ ] Apply output validation: domain must resolve via DNS · contact must exist in Apollo before record advances
- [ ] Score each prospect against ICP criteria — return qualified list only
- [ ] Return Stack Discovery Reports to T1 Bridge stub · log all outputs to Supabase with agent_id and timestamp

**Milestone:** T2 Research produces valid Stack Discovery Reports for 5 test companies. Failed records logged and skipped — chain does not halt.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 05 — T1 Bridge — revenue orchestration
**Tag:** Super Agent · **Security:** High

> The revenue engine core. Runs on a schedule, assesses pipeline, delegates, scores, and deduplicates — no human involvement.

**Action items:**
- [ ] Build Make.com scheduled trigger: 6am daily · no human initiation required
- [ ] HubSpot pipeline query: current value vs. weekly target → gap calculation logic
- [ ] Delegate to T2 Research with ICP parameters when pipeline gap is confirmed
- [ ] Receive Stack Discovery Reports · run ICP scoring logic against defined criteria
- [ ] Deduplicate against HubSpot — suppress all previously contacted prospects before any handoff
- [ ] Add qualified prospects to HubSpot · delegate qualified list to T2 Outreach
- [ ] Build weekly performance report scenario — delivered to Brian on schedule regardless of system activity
- [ ] Build 3-consecutive-unresolved-escalations trigger → full system pause + immediate Brian alert

**Milestone:** T1 Bridge runs daily trigger, queries HubSpot, delegates full research chain, scores output, deduplicates, and hands qualified list to T2 Outreach stub.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 06 — T2 Outreach — sequence execution
**Tag:** Department Agent · **Security:** High

> Personalized, rate-limited outreach with a mandatory human approval gate. Auto-send is never enabled under any condition.

**Action items:**
- [ ] Build sequence drafter — uses Stack Discovery Report to write personalized LinkedIn + email copy per prospect
- [ ] Build approval gate: batch delivered to Brian's inbox · 4-hour response window
- [ ] 'No response = HOLD' — system holds indefinitely · auto-send never enabled under any condition
- [ ] Build LinkedIn connection executor: hard cap ≤20/day in Make.com · not AI-controlled · not overridable
- [ ] Build Apollo email executor: hard cap ≤50/day in Make.com · not AI-controlled · not overridable
- [ ] Build positive response router → T1 Bridge → Brian notification
- [ ] Build negative/unsub handler → HubSpot update + permanent suppression list entry
- [ ] Pre-execution suppression check: verify prospect not in suppression list before any send action

**Milestone:** Approval gate confirmed — system holds without a response. Rate limits tested and verified unoverridable. Full outreach loop runs clean in staging with test data.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 07 — Operations chain — Helm, Content, Support
**Tag:** Ops Agents · **Security:** Touchpoint

> Operations runs parallel to revenue. Brian's time goes to strategy and relationships only.

**Action items:**
- [ ] T2 Content: weekly trigger · Claude API → LinkedIn post drafts (3–5/week from client insights)
- [ ] T2 Content: LinkedIn publisher queue · client-reference flag → Brian approval gate before any publish
- [ ] T2 Support: inbound webhook handler (contact form + email) · Claude API → response draft
- [ ] T2 Support: flagged keyword pattern list → auto-route to Brian · all sensitive/legal/contract → Brian only
- [ ] T2 Support: FAQ autonomous response handler · Supabase logging on all interactions
- [ ] T1 Helm: client milestone monitoring scenario · 24-hour unresolved issue escalation trigger
- [ ] T1 Helm: weekly ops report covering delivery + content + support · delivered to Brian on schedule

**Milestone:** T2 Content produces first week of LinkedIn drafts autonomously. T2 Support handles test inbound inquiry and logs correctly. Weekly ops report delivered.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 08 — Guardrails & security hardening
**Tag:** Security Layer · **Security:** Critical

> Nothing can run away. Nothing can be injected. Nothing can fail silently. Applied across all scenarios before any live run.

**Action items:**
- [ ] Circuit breaker: maximum scenario runs per hour enforced in Make.com across all agents
- [ ] Hard daily operation cap per agent — set and reviewed before any live run begins
- [ ] 80% daily spend alert configured for all APIs · auto-pause + Brian alert at 100%
- [ ] Prompt injection sanitization: all external data wrapped in explicit delimiters before reaching agent context
- [ ] Webhook authentication: auth headers required on all inbound webhooks · URLs rotated and treated as secrets
- [ ] IP allowlist applied on all Make.com webhooks where the platform supports it
- [ ] Signed session tokens on all inter-agent communications · actor_id logged on every handoff
- [ ] Anomaly detection: flagged pattern list for unusual inter-agent behavior → immediate Brian alert
- [ ] Full audit against SeaLegs Threat Register — all categories (HIGH + MEDIUM + MONITORED) verified mitigated

**Milestone:** Circuit breaker tested against intentional runaway — contained. Injection test passed. All threat register categories verified mitigated in Make.com.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## Stage 09 — End-to-end test & first autonomous run
**Tag:** Go Live · **Security:** Validation gate

> The full loop runs without Brian's involvement except at the approval gate. Phase 01 complete when T1 Bridge books its first meeting.

**Action items:**
- [ ] Full revenue loop dry run — test data only · no live outreach
- [ ] Full operations loop dry run — confirm all parallel chains execute correctly
- [ ] Error injection testing at each tier — force failures and verify escalation path at every level
- [ ] Security penetration test: attempt prompt injection · attempt webhook spoof · verify both blocked
- [ ] First live approval gate run: Brian approves one outreach batch · system executes within rate limits
- [ ] First live outreach batch sent and tracked in HubSpot
- [ ] Weekly report generated and delivered — confirm all metrics populate correctly
- [ ] Document first autonomous pipeline hit — this is the Phase 01 completion event

**Milestone:** T1 Bridge books first meeting autonomously. Phase 01 complete. SeaLegs operational as The Clear Stack's internal OS.

**Notes:**
<!-- Add blockers, decisions, and updates here -->

---

## API credential inventory
*Complete before Stage 01 milestone is marked done*

| API / Service | Key stored in Make.com env vars | Agent tier | Least privilege confirmed | Rotation date |
|---|---|---|---|---|
| Anthropic API | ⬜ | T2 Content · T2 Support | ⬜ | — |
| BuiltWith API | ⬜ | T3 Stack Scanner | ⬜ | — |
| Apollo.io | ⬜ | T3 Enricher · T2 Outreach | ⬜ | — |
| LinkedIn Sales Navigator | ⬜ | T3 Signal Puller · T2 Outreach | ⬜ | — |
| HubSpot | ⬜ | T1 Bridge | ⬜ | — |
| Supabase | ⬜ | All tiers (RLS enforced) | ⬜ | — |
| OpenClaw | ⬜ | T1 agents | ⬜ | — |

---

## Change log

| Date | Stage | Change | Author |
|---|---|---|---|
| June 2026 | All | Initial plan created | Brian Burge |

---

*© 2026 The Clear Stack · theclearstack.com · Internal use only*
