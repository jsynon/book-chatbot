# Question-steering audit

This audit follows the live path across `book-chatbot` (Worker and workbench) and `antilogicalism` (planner caller, index retrieval, and evaluation). The goal is to improve evidence coverage and trustworthy answers without turning observed benchmark questions into runtime routes.

## What changed

| Runtime behavior removed | Location | Reason |
| --- | --- | --- |
| Add a perception/external-world/experience/dream/skepticism query when a question looked like a simulation or reality question | Worker planner post-processing | This selected a subject-specific search vocabulary after the planner had already run. The planner can now choose context searches from the question and library context. |
| Split a query automatically when the question used the phrase “what roles do … play” | Worker planner post-processing | The heuristic was tied to one surface form and could rewrite a valid planner result. Planned query facets remain intact. |
| Permit interpretive sources for a verse-range question merely because the question named Augustine | Worker source-scope handling | Commentary is now admitted when commentary is explicitly requested or a named author/work resolves to a requested source group. The direct passage scope remains enforced. |
| Add a 1 John 4:7–12 search when an All Books planner call failed on “God is love” | Shared site retriever | A runtime fallback should preserve the reader's question and scope, not infer a preferred answer source from one acceptance case. |
| Add Kant-specific Second Analogy terms for causal-necessity searches | Shared site index search | Source-language expansions must come from the visible planner query, not a growing title/topic exception list. |
| Treat “dependent origination” and “dependent arising” as an injected synonym family | Shared site index search | The reader and planner queries now determine lexical search terms. Relevant alternate wording should be proposed by the planner and then judged against page text. |
| Add `aristotle` as a filler term in workbench recovery coverage | Python workbench | The recovery scorer now ignores generic framing words rather than a named-author exception. |

Acceptance cases may continue to mention these questions and required source groups. Those are evaluation expectations, not runtime source selection rules. The verified `Hamlet` catalog alias is also retained: it maps a named work to the collection record that actually contains it, and carries no answer content or relevance claim.

## Safeguards retained

- Explicit works, passages, chapter/verse ranges, and selected-book allowlists continue to bound retrieval.
- The planner keeps directly requested components and comparisons linked to their source groups. Contextual searches can help explain a question but do not prove its central claim or create an extra coverage obligation.
- Catalog author, title, editor, and translator metadata remains separate from page-level speaker attribution. Pseudonymous voices and editorial commentary still require provenance-aware handling.
- Candidate relevance, exact page fingerprints, citation-to-part links, quote location, and answer review remain independent checks. A search hit or a located highlight is not treated as semantic support.
- The live composer now has a general, evidence-conditional depth target aligned with the workbench: two to four developed paragraphs for substantive questions when the passages support them, with concise answers for simple questions or thin evidence. The target discourages padding and does not name or route any topic.
- Workbench evidence-gap recovery and live retrieval remain different implementations. The workbench can propose supplemental queries after retrieval and search them locally. The live Worker flow currently plans before browser retrieval; adding an adaptive second planner would require another browser/Worker round trip and a fresh single-use Turnstile token. This change keeps the existing call budget and security flow, and leaves adaptive live recovery for a separately justified pipeline design.

## Pipeline decision

The live flow remains: one planner call → bounded browser retrieval → verified passage packet → answer composition → optional existing review. Planner failure falls back to the unchanged question within the existing scope. No model call, answer-page limit, acceptance workflow, or token protocol was added. Retrieval terms, candidates, submitted pages, citations, and reviewed claims remain separately inspectable in the saved artifact.

The current evidence does not establish that removing narrow routes alone improves answer quality. After the Worker and site changes are deployed, use the existing acceptance workflow and inspect each stage in order. Score directness, source relevance, source diversity when useful, attribution, completeness, and citation support. Treat the God-is-love Bible requirement and simulation source expectations as benchmark labels, not license to reintroduce deterministic runtime routes.

## Audit boundary

This is a focused audit of question interpretation, retrieval, answer composition, and their shared validation/evaluation boundaries. It does not claim a line-by-line security review of every repository subsystem. The preserved safeguards above are cross-referenced with `docs/README.md`; the site-side retrieval policy and active evaluation guidance are in `reading-companion/LIVE-EVALUATION.md`.
