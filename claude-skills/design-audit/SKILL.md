---
name: design-audit
description: Deep frontend/UI/UX audit — phase-gated, experience intent first, visual/interaction/accessibility analysis, prioritized action plan
disable-model-invocation: true
argument-hint: "[path or project scope]"
---

Do not write any code or suggest changes yet. Your first job is to experience this app the way a user would.

**Preamble — read before anything else:**

Be willing to tell me if the core UX approach is wrong — not just if components need polish. If a page shouldn't exist, say so. If the information architecture is fundamentally misguided, say that. I'd rather hear "delete this page and merge it into X" than "add 2px more padding."

Your Phase 4 findings must be grounded in what you learned in Phases 2 and 3. If a finding in Phase 4 contradicts something you said in Phase 2, flag it explicitly and resolve the contradiction.

If you cannot determine what a component renders from the code alone, say so explicitly rather than guessing. Flag any files where intent was unclear.

If there are more than 20 distinct screens or components, group by feature area and map at the feature level, not the file level. Prioritize the user-facing surfaces.

Target: $ARGUMENTS (defaults to current project root if empty)

---

## Phase 1: Visual & Structural Inventory

Go through every page, component, and layout file. For each:
- What it renders (the visual output, not the code)
- What interaction it supports (clicks, inputs, navigation, state changes)
- What data it displays and where that data comes from
- What responsive behavior is defined in the code — breakpoints, conditional rendering, layout shifts — and where does responsive handling appear to be absent or incomplete?

**Output a screen-by-screen map:**

```
Page/Component → what the user sees → what they can do → responsive handling (present/absent/partial)
```

If you cannot determine what a component renders from the code alone, mark it as `[UNCLEAR — reason]` rather than guessing.

This is your checkpoint. Present it before moving on so I can catch any misreads.

Wait for my confirmation. Incorporate my corrections before continuing. If I correct something significant, revise your mental model and tell me what else that correction changes.

---

## Phase 2: Reconstruct the Design Intent

Based on everything you read, tell me:

1. Who the target user is and what mental state they're in when using this (rushed? exploring? anxious? optimizing?) — this frames everything else
2. What experience this app is trying to create
3. What the information hierarchy seems to be (what's emphasized, what's buried)
4. What problem it solves and how it positions itself against the closest well-known product to this app
5. The current visual language, structured as:
   - **Color**: consistent / inconsistent / absent
   - **Typography**: consistent / inconsistent / absent
   - **Spacing**: consistent / inconsistent / absent
   - **Component patterns**: consistent / inconsistent / absent

Then ask me: "Is this the experience you intended? What am I missing about your user or your vision?"

Wait for my response. Incorporate my corrections before continuing.

---

## Phase 3: Ask Me Hard Design Questions

Ask exactly 7 questions, ranked by how much my answer would change your Phase 4 analysis. Lead with the most consequential.

Target these areas:
- User flows that are incomplete or have dead ends
- States you can't find (empty, error, loading, first-time user, power user, overflow)
- Visual inconsistencies (spacing, color, typography that doesn't match the rest)
- Information architecture problems (things hard to find, grouped illogically, or competing for attention)
- Where the app uses different patterns to accomplish similar actions (e.g., some things are modals, some inline edits, some new pages — with no clear logic for which is which)
- Accessibility gaps identifiable from code (contrast, screen readers, keyboard nav, focus management)

Wait for my answers. Incorporate them before continuing.

---

## Phase 4: Think Beyond What I Built

### A. Visual Hierarchy & First Impressions
- Based on the visual hierarchy and information density on load, what would a user's attention be drawn to first on each page — and is that the right thing?
- Is there visual clutter competing for attention?
- Does the hierarchy guide the eye or scatter it?
- What's the single most important action on each page — is it visually dominant?

### B. Interaction & Flow Problems
- Where does the user have to think when they shouldn't have to?
- Where are there too many clicks to accomplish a core task?
- List any interactions where no feedback, transition, or confirmation exists in the code — places where something happens but the UI is silent about it
- Where does the app fail to communicate what just happened or what to do next?

### C. Visual Design Gaps
For each category, give: **finding → specific location in code → suggested fix** (one line each, not paragraphs)

- **Color**: is there a real system or ad-hoc choices?
- **Typography**: is the hierarchy clear? Too many font sizes/weights?
- **Spacing**: consistent scale or arbitrary?
- **Icons & imagery**: consistent style? Meaningful or decorative?
- **Motion**: is animation purposeful (guiding attention, showing state) or cosmetic?

### D. Missing States & Edge Cases
For each page/component in your Phase 1 map, mark whether each state exists:

| Page/Component | Empty | Error | Loading | Overflow | First-run |
|----------------|-------|-------|---------|----------|-----------|
| ... | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |

### E. Weakest Component
Identify the single component or interaction in this app that feels furthest from production quality. Describe specifically what's missing — not "polish," but the actual properties: timing, easing, color contrast, copy, spacing, feedback.

### F. Accessibility
For each issue found, classify severity:
- **Critical** — blocks use entirely for some users
- **Significant** — degrades experience for affected users
- **Minor** — best practice violation

Lead with Criticals. Check: keyboard navigation, touch target sizes, color contrast (WCAG AA), screen reader labels/roles/landmarks, focus management.

### G. UX Writing
- Are button labels action-oriented or vague?
- Are error messages specific or generic ("Something went wrong")?
- Is the tone consistent across the app?
- Where does the copy create confusion or friction?
- Empty state messages — helpful and guiding, or just "No data"?

### H. What's Entirely Missing
What feature or screen does this app obviously need that has no code anywhere — not incomplete, but entirely absent?

### I. What Would You Remove
If you had to remove one screen, one feature, or one component to make the app simpler without losing core value — what would it be and why?

### J. Competitive Context
What is the closest well-known product to this app? Where does this app diverge from how that product handles the same problem — and is the divergence intentional or accidental?

### K. Developer Handoff
Is the component structure self-documenting? Could a new developer understand what a component does without reading its implementation? Where are the abstraction boundaries unclear?

---

## Phase 5: Prioritized Design Action Plan

Rank everything by: (user impact × visual payoff × implementation effort)

For each item:

| # | What to change | Why it matters to the user | Effort | Visual Impact |
|---|---------------|---------------------------|--------|---------------|

Separate into:
1. **Quick wins** — under 30 minutes, immediately noticeable
2. **High-impact redesigns** — more than a day of work but transformative
3. **Polish & craft** — under 2 hours, noticeable only to detail-oriented users

Name two starting points:
- The single highest-leverage change overall (even if it's a full redesign)
- The highest-leverage change that can be implemented in under an hour

Then ask me which items I want you to implement.
