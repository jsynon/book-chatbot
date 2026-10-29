# Question-steering audit

This audit follows the live path across `book-chatbot` (Worker and workbench) and `antilogicalism` (planner caller, index retrieval, and evaluation). The goal is to improve evidence coverage and trustworthy answers without turning observed benchmark questions into runtime routes.

## What changed

| Runtime behavior removed | Location | Reason |
| --- | --- | --- |
| Add a perception/external-world/experience/dream/skepticism query when a question looked like a simulation or reality question | Worker planner post-processing | This selected a subject-specific search vocabulary after the planner had already run. The planner can now choose context searches from the question and library context. |
| Split a query automatically when the question used the phrase “what roles do … play” | Worker planner post-processing | The heuristic was tied to one surface form and could rewrite a valid planner result. Planned query facets remain intact. |
| Permit interpretive sources for a verse-range question merely because the question named Augustine | Worker source-scope handling | Commentary is now admitted when commentary is explicitly requested or a named author/work resolves to a requested source group. The direct passage scope remains enforced. |
| Bind the unlisted title `Hamlet` directly to Shakespeare's Complete Works (book 212) | Worker source-group handling | A question-specific work alias was steering source scope. Works absent from standalone catalog titles now use the same general retrieval and source-resolution path. |
| Add a 1 John 4:7–12 search when an All Books planner call failed on “God is love” | Shared site retriever | A runtime fallback should preserve the reader's question and scope, not infer a preferred answer source from one acceptance case. |
| Add Kant-specific Second Analogy terms for causal-necessity searches | Shared site index search | Source-language expansions must come from the visible planner query, not a growing title/topic exception list. |
| Treat “dependent origination” and “dependent arising” as an injected synonym family | Shared site index search | The reader and planner queries now determine lexical search terms. Relevant alternate wording should be proposed by the planner and then judged against page text. |
| Add `aristotle` as a filler term in workbench recovery coverage | Python workbench | The recovery scorer now ignores generic framing words rather than a named-author exception. |

Acceptance cases may continue to mention these questions and required source groups. Those are evaluation expectations, not runtime source selection rules. The one-off `Hamlet` alias to Shakespeare's Complete Works has also been removed; general catalog title and author matching remains.

## Safeguards retained

- Explicit works, passages, chapter/verse ranges, and selected-book allowlists continue to bound retrieval.
- The planner keeps directly requested components and comparisons linked to their source groups. Contextual searches can help explain a question but do not prove its central claim or create an extra coverage obligation.
- Catalog author, title, editor, and translator metadata remains separate from page-level speaker attribution. Pseudonymous voices and editorial commentary still require provenance-aware handling.
- Candidate relevance, exact page fingerprints, citation-to-part links, quote location, and answer review remain independent checks. A search hit or a located highlight is not treated as semantic support.
- The live composer uses a general, evidence-conditional depth target aligned with the workbench: two to four developed paragraphs for substantive questions when the passages support them, with concise answers for simple questions or thin evidence. It does not name or route any topic.
- The shared site retriever now measures lexical coverage only as a diagnostic. When a requested part has weak overlap with retrieved page text, the browser may ask the same scholarly librarian for up to three optional query leads, using bounded excerpts. It searches those leads under the same book allowlist, then repeats page fingerprint verification and answer-source selection. The check does not certify relevance or support.

## Pipeline decision

The live flow is: initial planning → bounded browser retrieval → optional conditional gap planning when page-text overlap is weak → retrieval and verification again → answer composition → optional existing review. The conditional request uses a fresh single-use Turnstile token, remains under the existing Worker rate limits, and can add at most three query facets. Original question parts and source scope stay fixed. The answer page cap, fingerprint checks, citation checks, and evidence review remain unchanged. Traces record the trigger, bounded query list, failure code, and before/after overlap diagnostic.

The current evidence does not establish that removing narrow routes or adding a conditional search pass alone improves answer quality. After the Worker and site changes are deployed, use the existing acceptance workflow and inspect each stage in order. Score directness, source relevance, source diversity when useful, attribution, completeness, and citation support. Treat the God-is-love Bible requirement and simulation source expectations as benchmark labels, not license to reintroduce deterministic runtime routes.

## Audit boundary

This is a focused audit of question interpretation, retrieval, answer composition, and their shared validation/evaluation boundaries. It does not claim a line-by-line security review of every repository subsystem. The preserved safeguards above are cross-referenced with `docs/README.md`; the site-side retrieval policy and active evaluation guidance are in `reading-companion/LIVE-EVALUATION.md`.
