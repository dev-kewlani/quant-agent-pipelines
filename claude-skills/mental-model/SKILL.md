---
name: mental-model
description: Generate a "Pathway to X" mental model — causal graph + feature taxonomy + interactions — and visualize as interactive HTML
disable-model-invocation: true
argument-hint: "<target_variable> [domain] [context] [--resume <filename>] [--dry-run] [--parallel]"
---

## Mental Model Generator

**⚠️ CRITICAL BEHAVIORAL RULE**: This is an INTERACTIVE, multi-step workflow. You MUST stop and wait for user input at each checkpoint (marked with ⛔). Do NOT run through multiple steps in a single response. Each step produces output, waits for the user, then the next step begins in a NEW response. Treat each ⛔ checkpoint as a hard stop — output your message and end your turn.

Arguments: $ARGUMENTS

Project root: `~/work\mental-model`

> **Example**: `/mental-model "Probability of Default" "Wholesale Credit Risk" "Basic Industries sector under Basel IRB"`

---

### Step 1: Gather Inputs

Parse `$ARGUMENTS` for up to 3 positional values (quoted strings, comma-separated, or space-separated):
1. **Target variable** (required): e.g., "Probability of Default", "LGD", "Trading Revenue"
2. **Domain** (optional): e.g., "Credit Risk — Wholesale", "CRE — Non-CTL", "Market Making"
3. **Context** (optional): e.g., "Basic Industries sector under Basel IRB"

**Flags:**
- `--resume <filename>`: Skip to Step 3 and load the existing `models/<filename>_wip.json` or `models/<filename>_skeleton.json`. Read `truncated_at` or `completed_classes` in metadata to determine remaining work. **Before resuming, compare `metadata.prompt_schema_version` against the current prompt files. If versions differ, warn the user that schema changes may cause inconsistencies and ask whether to proceed or regenerate.**
- `--dry-run`: Generate Pass 1 + first 2 classes only, for pipeline testing. Skip confirmation prompts.
- `--parallel`: Run Pass 2 classes concurrently (up to 4 at a time) using the Agent tool.

**⛔ CHECKPOINT 1 — MANDATORY STOP**: If only the target is provided (no domain or context), you MUST stop here and ask the user for domain and context before proceeding. Do NOT infer or assume these values. Do NOT continue to Step 2 until the user has explicitly provided them. Output your question and WAIT for the user's response.

If no arguments provided, ask: "What target variable do you want to build a mental model for? (e.g., PD, LGD, EAD, Revenue, Grading)" — then STOP and WAIT.

**Filename convention**: Convert target to snake_case filename — lowercase, replace spaces with underscores, strip special characters, truncate to 3 words max. Examples:
- "Probability of Default" → `probability_of_default`
- "Trading Revenue" → `trading_revenue`
- "Loss Given Default" → `loss_given_default`
- "CRE Non-CTL PD" → `cre_nonctl_pd`

Use this filename consistently for `_skeleton.json`, `_wip.json`, and final `.json` across all steps.

---

### Step 2: Generate Pass 1 — Skeleton

Read `~/work\mental-model\prompt.md`.

Replace the placeholders:
- `{{TARGET_VARIABLE}}` → the target
- `{{DOMAIN}}` → the domain
- `{{CONTEXT}}` → the context

**Work through Stages 1 through 6 in prompt.md sequentially.** Do not skip to JSON generation without completing each stage. Report progress after each stage (these are progress updates within a single step, NOT pause points — continue through all 6 stages before hitting Checkpoint 2):
- Stage 1: "N theoretical frameworks, M causal channels identified"
- Stage 2: "N class features enumerated"
- Stage 2.5: "N causal nodes, M edges, K named pathways"
- Stage 5: "N interactions (X class, Y sub-feature, Z cross-class, W derivative)"
- Stage 6: "Self-audit complete, N weaknesses identified and fixed"

Generate the **Pass 1 output**:
- `metadata` — complete, including `theoretical_landscape`, `self_audit`, and `prompt_schema_version` (set to current date: YYYY-MM-DD)
- `causal_graph` — complete with nodes, edges, and 5+ named pathways
- `class_features` — CLASS LEVEL ONLY with all fields as specified in prompt.md's Feature Schema, including `default_derivative_config`. Set `sub_features: []` for now.
- `derivative_schema` — complete with all transformation types and data frequencies
- `interactions` — 30+ across all 4 levels (≥5 class, ≥8 sub-feature, ≥8 cross-class, ≥5 derivative)
- `regime_dependencies` — 6+

Add `"completed_classes": []` to metadata for Pass 2 tracking.

**Use the Write tool to save JSON directly to**: `~/work\mental-model\models\{filename}_skeleton.json`. Do not output JSON inline in conversation — always write to file.

**⛔ CHECKPOINT 2 — MANDATORY STOP**: After writing the skeleton file, show the user:
- Number of class features generated
- Number of causal graph nodes and pathways
- Number of interactions by level and regime dependencies
- Ask: "Skeleton generated with N classes, N pathways, N interactions. Proceed with Pass 2 (sub-feature detail for each class)? One step per class."

**You MUST stop here and WAIT for the user's explicit confirmation before proceeding to Step 3.** Do NOT continue automatically. Do NOT start Pass 2 in the same response. The user needs to review the skeleton counts and approve. (Skip this checkpoint only if `--dry-run` flag was passed.)

---

### Step 3: Generate Pass 2 — Per-Class Detail

For EACH class feature in the skeleton (or first 2 if `--dry-run`), generate sub-features:

1. **Re-read** `~/work\mental-model\pass2_class.md` fresh for each class — do not rely on memory from prior classes
2. Replace placeholders:
   - `{{TARGET_VARIABLE}}` → the target
   - `{{DOMAIN}}` → the domain
   - `{{CLASS_FEATURE_JSON}}` → the class feature object from the skeleton (including `default_derivative_config`)
   - `{{DERIVATIVE_SCHEMA_JSON}}` → the derivative_schema from the skeleton
   - `{{RELEVANT_CAUSAL_NODES}}` → filter causal_graph.nodes where class_feature_ref matches this class id
3. Generate the sub-features array following pass2_class.md's quality requirements
4. **Save per-class file**: Write the sub-features JSON array to `models/pass2/{class_id}.json`
5. **Update WIP**: Merge into the model (`class_features[i].sub_features = generated_array`), update `metadata.completed_classes` with the class id, and save to `models/{filename}_wip.json`

After each class, report progress: "Class N/M: {class_name} — {count} sub-features generated."

**Token budget management**: After saving each class to disk, the generated sub-features are persisted in the file — do not retain prior classes' sub-features in working context. If you need to check cross-references or model state, re-read the WIP file from disk rather than relying on conversation memory.

**Quality maintenance**: Monitor concrete signals per class. Pause and flag to the user if ANY of:
- >40% of sub-features have null `known_pitfalls`
- >50% of sub-features share identical `key_derivatives` pairs (same transformation + periods)
- <25 sub-features generated (for a class that should have ≥30)
- >70% of sub-features are importance 3-4 (clustering)

It is better to produce 8 high-quality classes and flag 4 for a resume session than to produce 12 classes where the last 4 are shallow.

**Per-class file output**: In addition to updating `_wip.json`, save each class's sub-features array as a standalone file: `models/pass2/{class_id}.json`. This enables the `merge.py` workflow and makes individual classes re-generable without re-running the full pipeline.

**Parallel mode** (`--parallel`): Launch up to 4 classes concurrently using the Agent tool. Each agent receives:
- The full pass2_class.md content
- The skeleton's derivative_schema
- The specific class feature object with its default_derivative_config
- The relevant causal nodes for that class

Each agent saves its output to `models/pass2/{class_id}.json`. After each batch completes, run `merge.py` to combine results (see Step 4).

**Context recovery**: If context limits are approaching, save the current `_wip.json` and any completed per-class files to `models/pass2/` immediately. Tell the user which classes remain and instruct them to run `/mental-model --resume {filename}` in a new conversation to continue.

---

### Step 3b: Generate Pass 3 — Derivative Feature Expansion

**⛔ CHECKPOINT 3 — MANDATORY STOP**: After Pass 2 is complete for all classes, ask: "Pass 2 complete. Want to run Pass 3 (derivative feature expansion)? This promotes the most important derivatives into first-class features with their own pitfalls, thresholds, pathway connections, and interaction pairs. ~2 min per class."

**You MUST stop here and WAIT for the user's explicit confirmation before starting Pass 3.** Do NOT continue automatically. (Skip this checkpoint only if `--dry-run` flag was passed.)

For EACH class with sub-features:

1. **Re-read** `~/work\mental-model\pass3_derivatives.md` fresh for each class
2. Replace placeholders:
   - `{{TARGET_VARIABLE}}` → the target
   - `{{DOMAIN}}` → the domain
   - `{{CLASS_SUB_FEATURES_JSON}}` → the class's sub-features array (from Pass 2)
   - `{{DERIVATIVE_SCHEMA_JSON}}` → the derivative_schema from the skeleton
   - `{{RELEVANT_CAUSAL_PATHWAYS}}` → filter causal_graph.pathways where chain includes any node with class_feature_ref matching this class
   - `{{DERIVATIVE_INTERACTIONS_JSON}}` → filter interactions where level="derivative" AND features reference this class
3. Generate the derivative features array
4. **Save per-class file**: Write to `models/pass3/{class_id}.json`
5. Report progress: "Class N/M: {class_name} — {count} derivative features expanded."

**Selection filter**: Pass 3 only expands derivatives rated `"higher"` in `importance_vs_level` from sub-features with importance >= 3. Plus up to 5 agent-nominated derivatives per class. This keeps output focused — ~20-30 derivative features per class, not hundreds.

**Parallel mode** (`--parallel`): Same as Pass 2 — launch up to 4 classes concurrently using the Agent tool. Each agent saves to `models/pass3/{class_id}.json`.

---

### Step 4: Merge & Validate

After all classes are complete (or after resuming and completing remaining classes):

**Option A — merge.py workflow** (preferred when per-class files exist in `models/pass2/`):

```bash
cd "~/work\mental-model" && python merge.py "models/{filename}_skeleton.json" models/pass2/ --pass3 models/pass3/ -o "models/{filename}.json"
```

If Pass 3 was skipped (no `models/pass3/` directory), omit `--pass3`:
```bash
cd "~/work\mental-model" && python merge.py "models/{filename}_skeleton.json" models/pass2/ -o "models/{filename}.json"
```

`merge.py` handles:
- Merging skeleton + per-class sub-feature files from `models/pass2/`
- Merging derivative features from `models/pass3/` onto their parent sub-features (via `parent_id` matching)
- Resolving `derivative_config` inheritance (`"inherit"` → copies class `default_derivative_config`, partial objects → merged with defaults)
- Full validation against all hard minimums (counts, quality, referential integrity, plus Pass 3 checks: parent references, pathway connections, threshold zones, transformation diversity, interaction pair coverage)
- Reports errors and warnings with specific feature IDs
- Exits with code 1 if any errors found

If merge.py reports errors, show them to the user and ask how to proceed:
- **Truncation errors** (`_truncated` sentinel found): re-run Pass 2 for that class
- **Count errors** (< minimum sub-features): re-run Pass 2 for that class
- **Referential integrity errors** (dangling IDs): fix the references
- **Quality warnings** (derivative pair diversity, importance clustering): note but don't block

**Option B — WIP file workflow** (when building incrementally in-conversation):

If Pass 2 was done in-conversation (updating `_wip.json` directly rather than saving per-class files), run validation only:

```bash
cd "~/work\mental-model" && python merge.py "models/{filename}_wip.json" . --validate-only
```

If validation passes, copy WIP to final:
```bash
cp "models/{filename}_wip.json" "models/{filename}.json"
```

**In both cases**, show the user the validation output (errors + warnings) and the summary line. Ask if they want to fix failures before building the viz.

---

### Step 5: Build Visualization

First verify prerequisites:
- Check that `build_viz.py` exists at the project root
- Check that Python is available: `python --version`

Run:
```bash
cd "~/work\mental-model" && python build_viz.py "models/{filename}.json"
```

**If build_viz.py fails**: Read the error output.
- **JSON parsing error**: Re-validate the JSON file, fix, and retry.
- **KeyError / missing field**: The viz script may not support the current schema — flag to user and offer to inspect the script for needed updates.
- **Module not found**: Install missing dependencies and retry.

Tell the user:
- The HTML file path
- "To compare against an actual model, go to the Compare tab and upload a JSON with the model's features."

---

### Step 6: Optional — Refinement

Ask: "Want to refine anything? Options:
1. Adjust causal pathways or class-level features (I'll update the full model)
2. Refine sub-features for a specific class"

**Before any refinement**: Back up the current model by copying `models/{filename}.json` to `models/{filename}_v{current_version}.json` before making changes.

**For full-model refinement** (option 1): Read `~/work\mental-model\refine.md`. Extract only `metadata`, `causal_graph`, class-level fields (without sub_features), `interactions`, and `regime_dependencies` — do NOT paste the full model with all sub-features. Apply the user's feedback to this skeleton, then merge sub_features back from the saved file.

**For per-class refinement** (option 2): Load the FULL model as context (read from the saved JSON file). Apply the user's feedback scoped to the target class only. Use refine.md's quality bars and consistency checks against the full model — do NOT extract just the class subset. This ensures cross-references (interactions, regime_dependencies, highly_correlated_with) remain valid. Only modify the target class's sub_features and any cross-references that the feedback explicitly changes.

After any refinement: increment `metadata.version`, save using the Write tool, and re-run `build_viz.py`.

---

### Schema Compatibility Note

The current prompt schema uses:
- Dot-notation IDs: `leverage.debt_to_ebitda` (not bare `debt_to_ebitda`)
- Class-level `default_derivative_config` with sub-feature inheritance
- `metadata.theoretical_landscape`, `metadata.self_audit`, `metadata.prompt_schema_version`

Models generated before these changes (e.g., `pd_v1.json`) use the old schema and are NOT compatible with `--resume` or the current refinement workflow. To use old models, they must be migrated to the new schema first.
