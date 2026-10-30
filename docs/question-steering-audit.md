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
- The planner keeps directly requested components and comparisons linked to their source groups. Contextual searches can help explain a question but do not prove its central claim or create an extra coverage obligation. Single-part planner queries and conditional gap queries retain links to the weak part they may help retrieve; those links affect candidate eligibility only and never prescribe a source, answer, or extra obligation.
- Catalog author, title, editor, and translator metadata remains separate from page-level speaker attribution. Pseudonymous voices and editorial commentary still require provenance-aware handling.
- Candidate relevance, exact page fingerprints, citation-to-part links, quote location, and answer review remain independent checks. A search hit or a located highlight is not treated as semantic support.
- The live deterministic packet ranks passages by local, question-linked phrase and term-cluster signals, with retrieval score and book diversity used only as tie-breakers. These inexpensive lexical features are diagnostics for choosing among already retrieved pages; they do not determine claim support. Expected-source and answer labels remain offline evaluation data and never enter runtime ranking.
- Evaluation traces record the top packet candidates, selected-page state, per-part linkage, local match signals, and whether relevance was semantically scored. The trace explicitly marks that the packet audit is lexical only.
- The live composer uses a general, evidence-conditional depth target aligned with the workbench: two to four developed paragraphs for substantive questions when the passages support them, with concise answers for simple questions or thin evidence. It does not name or route any topic.
- The shared site retriever measures lexical coverage only as a diagnostic. Its retry signal now requires distinctive terms to appear together in a short passage window, so a long page cannot satisfy coverage merely by using the same ambiguous word in separate contexts. When a part remains weak, the browser may ask the same scholarly librarian for up to three optional query leads, using bounded excerpts and recording which terms matched. The librarian may disambiguate the phrase or use source-native wording, but cannot prescribe authors or works. Retrieval stays under the same book allowlist and repeats page fingerprint verification and answer-source selection. The check does not certify relevance or support.
- Answer-source selection suppresses a near-identical passage from another edition only when normalized work titles match, both passages contain at least 40 tokens, and at least 94% of the shorter passage's three-word shingles occur in the longer excerpt. Different page lengths and surrounding context do not hide a duplicated passage; materially different text remains eligible.

## Pipeline decision

The live flow is: initial planning → bounded browser retrieval → local-window coverage check → optional conditional gap planning → retrieval and verification again → answer composition → optional existing review. The conditional request uses a fresh single-use Turnstile token, remains under the existing Worker rate limits, and can add at most three query facets. Original question parts and source scope stay fixed. The answer page cap, fingerprint checks, citation checks, and evidence review remain unchanged. Traces record matched terms, the trigger, bounded query list, failure code, and before/after coverage signal. These changes do not add a relevance-ranking model or a new model call on the ordinary answer path.

The current evidence does not establish that removing narrow routes or adding a conditional search pass alone improves answer quality. After the Worker and site changes are deployed, use the existing acceptance workflow and inspect each stage in order. Score directness, source relevance, source diversity when useful, attribution, completeness, and citation support. Treat the God-is-love Bible requirement and simulation source expectations as benchmark labels, not license to reintroduce deterministic runtime routes.

## Audit boundary

This is a focused audit of question interpretation, retrieval, answer composition, and their shared validation/evaluation boundaries. It does not claim a line-by-line security review of every repository subsystem. The preserved safeguards above are cross-referenced with `docs/README.md`; the site-side retrieval policy and active evaluation guidance are in `reading-companion/LIVE-EVALUATION.md`.


## Conditional gap-query phrasing

When the retrieved text leaves a question part weakly covered, the existing gap-planner call may return up to three optional search leads. Keep each lead compact and centered on one concept or relationship, using distinct leads for distinct angles instead of a long string of adjacent terms. Preserve the question’s central relation or contrast. When current queries only repeat a modern or specialized label, one alternate lead may express the underlying conceptual or epistemic issue in source-native terms, such as what evidence would support or weaken the claim. Do not prescribe authors, works, or conclusions. The leads remain attached to the weak part for retrieval eligibility only and do not add answer obligations. Continue to judge results from their passages rather than query overlap or titles.

## Source framing and logical scope

When an answer draws on both a primary text and later commentary, lead with what the direct text establishes, then label the commentary as its own interpretation. Keep the source voices distinct. Preserve logical scope when paraphrasing: a passage that rejects asserting either P or Q does not support the weaker statement that P and Q are not both true. Review traces and located quotations are not substitutes for checking this meaning. These general safeguards do not name or route to any source.
