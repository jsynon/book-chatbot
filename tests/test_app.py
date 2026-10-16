import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch


# Load the app from its project path so tests work when launched from either the
# project folder or the repository root, without installing this prototype.
APP_PATH = pathlib.Path(__file__).resolve().parents[1] / "app.py"
SPEC = importlib.util.spec_from_file_location("book_chatbot_app", APP_PATH)
app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(app)


class FakeResponse:
    """Minimal urllib response double for deterministic local-model tests."""

    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.payload


class RetrievalTests(unittest.TestCase):
    """Check corpus loading, whole-book indexing, and query expansion behavior."""

    def test_shared_library_data_shard_is_preferred_when_present(self):
        """Use the central library-data repository as the text source of truth."""
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "book-chatbot"
            library = pathlib.Path(temporary) / "antilogicalism-library-data"
            shared_shard = library / "data-v48" / "book-7.json.gz"
            shared_shard.parent.mkdir(parents=True)
            shared_shard.touch()

            resolved = app.resolve_book_file(root, {
                "BOOK_CHATBOT_LIBRARY_DATA": str(library),
                "BOOK_CHATBOT_DATA_VERSION": "v48",
            })

        self.assertEqual(resolved, shared_shard)

    def test_local_pilot_shard_is_the_missing_repository_fallback(self):
        """Keep the downloadable pilot runnable without a library checkout."""
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "book-chatbot"
            fallback = root / "data" / "book-7.json.gz"
            fallback.parent.mkdir(parents=True)
            fallback.touch()

            resolved = app.resolve_book_file(root, {
                "BOOK_CHATBOT_LIBRARY_DATA": str(pathlib.Path(temporary) / "missing-library"),
                "BOOK_CHATBOT_DATA_VERSION": "v47",
            })

        self.assertEqual(resolved, fallback)

    def test_indexes_short_passages_across_the_book(self):
        """Guard against accidentally bundling an empty or partial text corpus."""
        self.assertEqual(len(app.PAGES), 127)
        self.assertGreater(len(app.CHUNKS), 500)
        self.assertEqual(min(chunk["page"] for chunk in app.CHUNKS), 1)
        self.assertEqual(max(chunk["page"] for chunk in app.CHUNKS), 127)

    def test_evidence_context_labels_sentences_without_losing_words(self):
        """Separate passage locator metadata from quotable source wording."""
        text = "Scientific knowledge concerns universal and necessary things. Philosophic wisdom concerns the highest objects."
        context = app.format_evidence_context([
            {"source_id": "S4", "page": 66, "text": text},
        ])

        self.assertIn('<passage source_id="S4" page="66" sentence="1">', context)
        self.assertIn("TEXT: Scientific knowledge concerns universal and necessary things.", context)
        self.assertIn('<passage source_id="S4" page="66" sentence="2">', context)
        self.assertIn("TEXT: Philosophic wisdom concerns the highest objects.", context)
        self.assertEqual(
            " ".join(
                line.removeprefix("TEXT: ")
                for line in context.splitlines()
                if line.startswith("TEXT: ")
            ),
            text,
        )

    def test_evidence_context_uses_numeric_question_part_metadata(self):
        """Do not repeat the full question alongside every source window."""
        question_parts = ["What is the highest human good", "how does Aristotle argue for it"]
        context = app.format_evidence_context([
            {"source_id": "S1", "page": 2, "text": "Every pursuit aims at some good.",
             "question_part_matches": [1, 2]},
        ], question_parts)

        self.assertIn('question_parts="1,2"', context)
        self.assertNotIn("highest human good", context)
        self.assertNotIn("Aristotle argue", context)
        self.assertIn("TEXT: Every pursuit aims at some good.", context)

    def test_expanded_queries_find_passages_for_varied_topics(self):
        """Exercise unrelated topics to ensure retrieval is not question-specific."""
        cases = [
            ("What is the definition of virtue?", ["state of character", "choice", "mean", "rational principle"], 18),
            ("What is the doctrine of the mean?", ["intermediate", "excess", "deficiency"], 18),
            ("What does Aristotle say about raising children?", ["young", "nurture", "habituation", "good laws"], 125),
            ("What makes an action voluntary?", ["voluntary", "involuntary", "compulsion", "ignorance"], 24),
            ("Why does Aristotle value contemplation?", ["contemplation", "happiness", "activity", "reason"], 123),
        ]
        for question, terms, expected_page in cases:
            with self.subTest(question=question):
                sources = app.retrieve(question, [], search_terms=terms)
                self.assertTrue(sources)
                self.assertIn(expected_page, [source["page"] for source in sources])

        happiness = app.retrieve("What does Aristotle mean by happiness?", [])
        page_87 = next(source for source in happiness if source["page"] == 87)
        self.assertIn("happy man needs the goods of the body and external goods", page_87["text"].lower())

    def test_generic_question_wording_does_not_suppress_expansion_for_missing_topic_link(self):
        """Expand when matches cover separate words but not the requested relation.

        "Habituation" and "virtuous" occur in different, incidental contexts
        in the top direct results. Generic wording such as "help someone
        become" must not make either single passage look like it covers how
        repeated actions form character. Query expansion can then search the
        book's own terms, including forming habits and becoming just.
        """
        question = "How does habituation help someone become virtuous?"
        direct = app.retrieve(question, [])

        self.assertTrue(app.query_needs_expansion(question, direct))
        expanded = app.retrieve(
            question,
            [],
            search_terms=["become just or unjust", "habituated", "states of character"],
        )
        self.assertIn(14, [source["page"] for source in expanded])

        combined = app.merge_retrieval_sources(direct, expanded)
        page_fourteen = next(source for source in combined if source["page"] == 14)
        self.assertIn("become just", page_fourteen["text"].lower())
        self.assertIn(14, [source["page"] for source in combined[:5]])
        # Promotion changes ordering but keeps this original direct hit in the
        # context so the model can compare it with the stronger expansion.
        self.assertIn(126, [source["page"] for source in combined])

    def test_broad_expansion_keeps_a_distinct_passage_from_the_same_page(self):
        """Retain a strong second paragraph when page-level dedup hid it.

        The live diagnostic's broad vocabulary ranked page 14 because it
        matched one paragraph, while the passage explaining how actions form
        character was a separate chunk from that same page. The source should
        keep both chunks under one page citation instead of discarding the
        stronger explanatory detail or adding a duplicate page link.
        """
        question = "How does habituation help someone become virtuous?"
        broad_terms = ["habituation virtue development behavioral adaptation"]

        expanded = app.retrieve(question, [], search_terms=broad_terms)
        page_fourteen = next(source for source in expanded if source["page"] == 14)
        self.assertIn("become just or unjust", page_fourteen["text"].lower())
        self.assertEqual(sum(source["page"] == 14 for source in expanded), 1)

        merged = app.merge_retrieval_sources(
            app.retrieve(question, []),
            expanded,
        )
        merged_page_fourteen = next(source for source in merged if source["page"] == 14)
        self.assertIn("become just or unjust", merged_page_fourteen["text"].lower())
        self.assertEqual(sum(source["page"] == 14 for source in merged), 1)

    def test_compact_ordered_term_match_surfaces_the_highest_good_passage(self):
        """Use source-word proximity to recover the opening argument passage.

        The question adds "human" between "highest" and "good," while the
        book says "highest of all goods achievable by action." BM25 alone ranks
        this passage below several unrelated pages that repeat the query words
        farther apart. The shared proximity feature should preserve page 2 in
        the ordinary top-five retrieval without relying on model expansion.
        """
        question = "What is the highest human good, and how does Aristotle argue for it?"

        primary = app.retrieve(question, [])

        page_two = next((source for source in primary if source["page"] == 2), None)
        self.assertIsNotNone(page_two)
        self.assertIn("highest of all goods achievable by action", page_two["text"].lower())

    def test_argument_reranker_promotes_topic_matched_purpose_premises(self):
        """Treat goal statements as argument evidence when they name the asked-about topic."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        primary = app.retrieve(question, [])

        ranked = app.prioritize_argument_sources(question, primary)

        page_two_rank = next(
            index for index, source in enumerate(ranked, start=1)
            if source["page"] == 2
        )
        # The opening passage states that pursuits aim at a good and asks what
        # political science aims at, then names the highest good achievable by
        # action. Its argument is teleological rather than marked by a
        # because/therefore word, so the generic argument reranker must still
        # surface it near the top when the question names the highest good.
        self.assertLessEqual(page_two_rank, 3)
        page_two = next(source for source in ranked if source["page"] == 2)
        self.assertIn("every pursuit aims at some good", page_two["text"].lower())

    def test_weak_lexical_match_triggers_query_expansion(self):
        """Verify expansion supplies search terms only and improves retrieval."""
        question = "What does Aristotle say about raising children?"
        initial = app.retrieve(question, [])
        self.assertTrue(app.query_needs_expansion(question, initial))

        payload = {"message": {"content": json.dumps({
            "search_terms": ["nurture", "education of the young"],
            "facet_terms": [["nurture", "education of the young"]],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            expansion = app.expand_query(question, [], "qwen3:4b")
        self.assertIn("nurture", expansion["search_terms"])
        expanded = app.retrieve(question, [], search_terms=expansion["search_terms"])
        self.assertEqual(expanded[0]["page"], 125)

    def test_expansion_requests_distinct_search_terms_for_each_question_part(self):
        """Ask for reasoning vocabulary as well as synonyms for a conclusion."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        payload = {"message": {"content": json.dumps({
            "search_terms": ["happiness", "human good", "virtue"],
            "facet_terms": [
                ["highest of all goods achievable by action", "chief good"],
                ["human function", "rational activity", "activity of soul in accordance with virtue"],
            ],
        })}}
        captured = {}

        def capture_request(request, timeout):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(payload)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            expansion = app.expand_query(question, [], "qwen3:4b")

        prompt = captured["payload"]["messages"][1]["content"].lower()
        self.assertIn("question parts, in order", prompt)
        self.assertIn("intermediate ideas", prompt)
        self.assertIn("separated by semicolons", prompt)
        expansion_schema = captured["payload"]["format"]["properties"]
        self.assertEqual(expansion_schema["search_terms"]["type"], "string")
        self.assertEqual(expansion_schema["facet_1"]["type"], "string")
        self.assertEqual(expansion_schema["facet_2"]["type"], "string")
        self.assertEqual(len(expansion["facet_terms"]), 2)

        # With the term groups kept separate, the opening passage that names
        # the highest good and the later human-function argument both survive
        # retrieval. This checks the shared pipeline using the real pilot text,
        # without prescribing any one answer or depending on a live model.
        primary = app.retrieve(question, [])
        expanded = app.retrieve(question, [], search_terms=expansion["search_terms"])
        per_facet = [
            app.retrieve(part, [], search_terms=terms)
            for part, terms in zip(app.question_facets(question), expansion["facet_terms"])
        ]
        merged = app.merge_retrieval_sources(
            primary,
            expanded,
            facet_sources=per_facet,
        )
        self.assertIn(2, [source["page"] for source in merged])
        self.assertIn(6, [source["page"] for source in merged])

    def test_page_reference_uses_drive_preview_instead_of_download_endpoint(self):
        """Keep source links in Drive preview; the citation label carries page."""
        self.assertEqual(
            app.pdf_page_url(44),
            "https://drive.google.com/file/d/1XVInAFS2zutV8PDp8A3DirUrW6nLLfvY/view?usp=sharing#page=44",
        )

    def test_empty_expansion_retries_with_scalar_fields_and_recovers_terms(self):
        """A valid empty response must trigger the differently shaped retry."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        empty = {"message": {"content": json.dumps({"search_terms": "", "facet_terms": ""})}}
        recovered = {"message": {"content": json.dumps({
            "terms": "chief good; happiness; final end",
            "part_1": "highest good achievable by action; chief good",
            "part_2": "human function; rational activity; activity of soul",
        })}}
        captured = []

        def return_sequential(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse(empty if len(captured) == 1 else recovered)

        with patch.object(app.urllib.request, "urlopen", side_effect=return_sequential):
            expansion = app.expand_query(question, [], "qwen3:4b")

        self.assertEqual(len(captured), 2)
        self.assertIn("search_terms", captured[0]["format"]["properties"])
        self.assertIn("terms", captured[1]["format"]["properties"])
        self.assertIn("happiness", expansion["search_terms"])
        self.assertIn("highest good achievable by action", expansion["facet_terms"][0])
        self.assertIn("human function", expansion["facet_terms"][1])

    def test_expansion_parser_removes_inline_number_labels_from_terms(self):
        """Numbered synonyms must not bleed into the next facet's vocabulary."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        payload = {"message": {"content": json.dumps({
            "search_terms": "highest good; action",
            "facet_1": "highest human good; purpose of action: 2: Aristotle's argument",
            "facet_2": "end all things aim at; desirable for its own sake",
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            expansion = app.expand_query(question, [], "qwen3:4b")

        self.assertEqual(len(expansion["facet_terms"]), 2)
        self.assertIn("Aristotle's argument", expansion["facet_terms"][0])
        self.assertNotIn("2: Aristotle's argument", expansion["facet_terms"][0])
        self.assertIn("end all things aim at", expansion["facet_terms"][1])

    def test_expansion_threshold_scales_with_question_term_coverage(self):
        """Longer multi-concept queries require more overlap before skipping expansion."""
        short_question = "What is virtue?"
        short_source = [{"text": "Virtue is a stable state of character."}]
        self.assertFalse(app.query_needs_expansion(short_question, short_source))

        long_question = (
            "How are virtue, courage, justice, temperance, friendship, choice, and pleasure connected?"
        )
        weak_source = [{"text": "Virtue and courage are discussed together."}]
        strong_source = [{"text": "Virtue, courage, and justice are discussed together."}]
        self.assertTrue(app.query_needs_expansion(long_question, weak_source))
        self.assertFalse(app.query_needs_expansion(long_question, strong_source))

    def test_multi_part_question_expands_when_one_part_has_no_coverage(self):
        """A strong definition match cannot mask an uncovered request for its argument."""
        question = "What does he identify as the highest human good, and how does he argue for it?"
        sources = [{"text": "The highest human good is happiness, and everyone agrees that living well is happiness."}]
        self.assertEqual(app.question_facets(question), [
            "What does he identify as the highest human good",
            "how does he argue for it",
        ])
        self.assertTrue(app.query_needs_expansion(question, sources))

    def test_anaphoric_question_part_inherits_the_prior_topic_for_search(self):
        """Resolve a later "it" search to the concept named in the prior part."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        parts = app.question_facets(question)
        terms = app.contextual_facet_search_terms(
            parts,
            1,
            ["Aristotle's argument", "proof", "demonstration"],
        )

        self.assertIn("Aristotle's argument", terms)
        self.assertIn("highest human good", terms)
        candidates = app.retrieve(parts[1], [], search_terms=terms)
        self.assertIn(6, [source["page"] for source in candidates])
        self.assertIn(2, [source["page"] for source in candidates])

    def test_non_anaphoric_part_does_not_inherit_prior_terms(self):
        """Keep a later facet focused when it names its own subject."""
        parts = ["What is practical wisdom", "What does moral virtue mean"]
        terms = app.contextual_facet_search_terms(parts, 1, ["relation", "moral virtue"])

        self.assertEqual(terms, ["relation", "moral virtue"])

    def test_expanded_multi_part_search_can_retrieve_the_human_function_argument(self):
        """Related search vocabulary can add the argument passage missing from direct results."""
        question = "What does he identify as the highest human good, and how does he argue for it?"
        initial = app.retrieve(question, [])
        self.assertTrue(app.query_needs_expansion(question, initial))
        expanded = app.retrieve(
            question,
            [],
            search_terms=["function of man", "rational activity", "activity of soul", "virtue"],
        )
        merged = app.merge_retrieval_sources(initial, expanded)
        self.assertIn(6, [source["page"] for source in merged])

    def test_single_weak_match_does_not_hide_a_missing_argument_facet(self):
        """Expand when one incidental word is the only match for a requested part."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        initial = app.retrieve(question, [])

        # Page 115 contains the word "argue" in a discussion of Plato and
        # pleasure, but does not supply Aristotle's argument for the human
        # good. A single lexical match on that second facet is insufficient.
        self.assertTrue(app.query_needs_expansion(question, initial))

        # These are general conceptual search terms that link the question to
        # Aristotle's opening account of political science's end and the
        # human-function argument. The query expander supplies such terms at
        # runtime; fixed terms here keep the retrieval regression test offline.
        expanded = app.retrieve(
            question,
            [],
            search_terms=[
                "highest good achievable by action",
                "political science aims at",
                "happiness",
                "human function",
                "rational activity",
            ],
        )
        merged = app.merge_retrieval_sources(initial, expanded)
        page_two = next(source for source in merged if source["page"] == 2)
        self.assertIn("highest of all goods achievable by action", page_two["text"].lower())
        self.assertIn("happiness", page_two["text"].lower())

    def test_argument_question_reranks_reasoning_passages_ahead_of_topic_definitions(self):
        """Place a passage with premises and inference before a definition-only match."""
        sources = [
            {
                "source_id": "S1",
                "page": 2,
                "score": 12.0,
                "text": (
                    "The highest of all goods achievable by action is happiness. "
                    "People identify living well and doing well with being happy."
                ),
            },
            {
                "source_id": "S2",
                "page": 6,
                "score": 0.2,
                "text": (
                    "The function of man is activity of soul implying a rational principle. "
                    "If any action is well performed in accordance with appropriate excellence, "
                    "human good turns out to be activity of soul in accordance with virtue."
                ),
            },
        ]

        ranked = app.prioritize_argument_sources(
            "What does he identify as the highest human good, and how does he argue for it?",
            sources,
        )

        self.assertEqual([source["page"] for source in ranked], [6, 2])
        self.assertEqual([source["source_id"] for source in ranked], ["S1", "S2"])
        # Plain identification questions retain the retrieval order unchanged.
        self.assertIs(
            app.prioritize_argument_sources("What is the highest human good?", sources),
            sources,
        )

    def test_argument_reranker_pairs_topical_result_with_reasoning_passage(self):
        """Keep the clearest conditional-to-result passage near its topic evidence."""
        sources = [
            {
                "source_id": "S1",
                "page": 12,
                "score": 8.0,
                "text": (
                    "Since happiness is an activity of soul in accordance with perfect virtue, "
                    "we must consider the nature of virtue; for perhaps we shall thus see better "
                    "the nature of happiness. The true student of politics studies human virtue, "
                    "because the good being sought is human good and human happiness."
                ),
            },
            {
                "source_id": "S2",
                "page": 2,
                "score": 0.8,
                "text": (
                    "Let us resume our inquiry and state, in view of the fact that all knowledge and "
                    "every pursuit aims at some good, what it is that we say political science aims at "
                    "and what is the highest of all goods achievable by action. Verbally there is very "
                    "general agreement; for both the general run of men and people of superior refinement "
                    "say that it is happiness."
                ),
            },
            {
                "source_id": "S3",
                "page": 115,
                "score": 0.6,
                "text": (
                    "This argument seems to show it to be one of the goods, and no more a good than any "
                    "other; for every good is more worthy of choice along with another good than taken "
                    "alone. And so it is by an argument of this kind that Plato proves the good not to be "
                    "pleasure; he argues that the pleasant life is more desirable with wisdom than without."
                ),
            },
            {
                "source_id": "S4",
                "page": 67,
                "score": 2.625,
                "text": (
                    "If the argument be that man is the best of the animals, this makes no difference; "
                    "philosophic wisdom concerns the things that are highest by nature."
                ),
            },
            {
                "source_id": "S5",
                "page": 99,
                "score": 0.5,
                "text": (
                    "If human good concerns virtue, and if action concerns a good, and if the human "
                    "activity concerns virtue, and if the question concerns happiness, the discussion "
                    "continues with several conditions but does not state what follows from them."
                ),
            },
            {
                "source_id": "S6",
                "page": 6,
                "score": 1.875,
                "text": (
                    "The function of man is activity of soul implying a rational principle. "
                    "If any action is well performed in accordance with appropriate excellence, "
                    "human good turns out to be activity of soul in accordance with virtue."
                ),
            },
        ]

        ranked = app.prioritize_argument_sources(
            "What is the highest human good, and how does Aristotle argue for it?",
            sources,
        )

        self.assertEqual([source["page"] for source in ranked[:2]], [2, 6])
        self.assertEqual(set(source["page"] for source in ranked), {2, 6, 12, 67, 99, 115})
        # The move changes only prompt order; it keeps every retrieved source
        # and refreshes IDs so citations still point at their actual passages.
        self.assertEqual(
            [source["source_id"] for source in ranked],
            ["S1", "S2", "S3", "S4", "S5", "S6"],
        )

    def test_open_topic_questions_expand_when_only_one_aspect_was_retrieved(self):
        """Broaden vocabulary for open-ended topics such as Aristotle's account of soul."""
        question = "What did Aristotle say about the soul?"
        initial = app.retrieve(question, [])
        self.assertGreaterEqual(len(initial), 3)
        self.assertTrue(app.query_needs_expansion(question, initial))

    def test_expanded_search_keeps_a_direct_match_that_expansion_would_displace(self):
        """A vocabulary suggestion must not erase a strong passage from the original query."""
        question = "Where does Aristotle disagree with Plato?"
        primary = app.retrieve(question, [])
        self.assertIn(115, [source["page"] for source in primary])
        expanded = [
            {"source_id": f"S{index}", "page": 200 + index, "text": "Expanded topic candidate.", "score": 20}
            for index in range(1, 6)
        ]

        merged = app.merge_retrieval_sources(primary, expanded)

        self.assertIn(115, [source["page"] for source in merged])
        self.assertEqual([source["source_id"] for source in merged], [
            f"S{index}" for index in range(1, len(merged) + 1)
        ])

    def test_facet_expansions_cannot_evict_the_direct_top_five(self):
        """Model-generated facet scores may add passages, never replace direct hits."""
        primary = [
            {"source_id": f"S{index}", "page": index, "text": f"Direct passage {index}.", "score": 10-index}
            for index in range(1, 6)
        ]
        # Several expansion groups can accumulate enough reciprocal-rank score
        # to push a lower direct result out under ordinary fusion. The merged
        # context must retain the same direct candidates regardless of the
        # selected Ollama model's generated vocabulary.
        facet_sources = [
            [
                {"source_id": f"F{group}-{rank}", "page": 100 + group * 10 + rank,
                 "text": f"Facet {group} candidate {rank}.", "score": 100-rank}
                for rank in range(1, 6)
            ]
            for group in range(1, 4)
        ]

        merged = app.merge_retrieval_sources(primary, [], facet_sources=facet_sources)

        self.assertEqual({source["page"] for source in merged[:5]}, {1, 2, 3, 4, 5})
        self.assertEqual(len(merged), 7)
        self.assertEqual([source["source_id"] for source in merged], [
            f"S{index}" for index in range(1, len(merged) + 1)
        ])

    def test_facet_retrieval_provenance_is_visible_in_evidence_context(self):
        """Show which independently searched question part found each source."""
        primary = [
            {"source_id": "S1", "page": 67, "text": "A direct combined-query passage.", "score": 10}
        ]
        facet_sources = [
            [{"source_id": "F1", "page": 2, "text": "The highest good is happiness.", "score": 9}],
            [{"source_id": "F2", "page": 6, "text": "The human function is rational activity.", "score": 8}],
        ]

        merged = app.merge_retrieval_sources(primary, [], facet_sources=facet_sources)
        page_two = next(source for source in merged if source["page"] == 2)
        page_six = next(source for source in merged if source["page"] == 6)
        parts = [
            "What is the highest human good",
            "how does Aristotle argue for it",
        ]
        context = app.format_evidence_context([page_two, page_six], parts)

        self.assertEqual(page_two["question_part_matches"], [1])
        self.assertEqual(page_six["question_part_matches"], [2])
        self.assertIn('question_parts="1"', context)
        self.assertIn('question_parts="2"', context)
        self.assertNotIn("What is the highest human good", context)
        self.assertNotIn("how does Aristotle argue for it", context)

    def test_opt_in_diagnostic_source_list_preserves_rank_and_passage_text(self):
        """The troubleshooting view must expose the exact evidence candidates."""
        sources = [{"source_id": "S1", "page": 72, "score": 12.5, "text": "Virtue aims at the right mark."}]
        self.assertEqual(app.diagnostic_source_list(sources), [{
            "source_id": "S1", "page": 72, "score": 12.5, "text": "Virtue aims at the right mark."
        }])


class DiagnosticSummaryTests(unittest.TestCase):
    """Keep the final diagnostic cause distinct from repaired retry errors."""

    def test_summary_uses_final_reason_and_keeps_retry_history_separate(self):
        trace = {
            "evidence_check": {
                "status": "partial",
                "reason": "the answer must separately identify its conclusion, premise, and reasoning; missing: reasoning",
                "attempts": [
                    {"attempt": 1, "status": "rejected", "reason": "quote was too long (54 words; maximum 45)"},
                    {"attempt": 2, "status": "rejected", "reason": "the answer must separately identify conclusion, premise, and reasoning; missing: reasoning"},
                ],
            },
            "retrieval": {
                "primary": [{"page": 2}, {"page": 67}],
                "merged": [{"page": 2}, {"page": 6}],
                "expansion": {"triggered": True},
            },
        }

        summary = app.summarize_diagnostics(trace)

        self.assertEqual(summary["outcome"], "partial")
        self.assertEqual(summary["final_stage"], "argument structure")
        self.assertIn("connect textual support to its conclusion", summary["final_issue"])
        self.assertEqual(summary["attempt_history"][0]["stage"], "quote length")
        self.assertEqual(summary["attempt_history"][1]["stage"], "argument structure")
        self.assertEqual(summary["retrieval"]["direct_pages"], [2, 67])
        self.assertEqual(summary["retrieval"]["final_pages"], [2, 6])
        self.assertTrue(summary["retrieval"]["expansion_triggered"])

    def test_verified_outcome_does_not_mislabel_a_repaired_quote_error(self):
        summary = app.summarize_diagnostics({
            "evidence_check": {
                "status": "verified",
                "attempts": [
                    {"attempt": 1, "status": "rejected", "reason": "quote was too long (54 words; maximum 45)"},
                    {"attempt": 2, "status": "accepted"},
                ],
            },
            "retrieval": {"primary": [], "merged": [], "expansion": {"triggered": False}},
        })

        self.assertEqual(summary["final_stage"], "none")
        self.assertEqual(summary["final_issue"], "No unresolved issue.")
        self.assertEqual(summary["attempt_history"][0]["stage"], "quote length")
        self.assertEqual(summary["attempt_history"][1]["status"], "accepted")

    def test_long_source_copy_is_classified_as_answer_synthesis(self):
        summary = app.classify_diagnostic_issue(
            "the answer repeats a long source passage instead of synthesizing it"
        )
        self.assertEqual(summary["stage"], "answer synthesis")
        self.assertEqual(summary["issue"], "The answer copied a passage instead of giving a concise synthesis.")


class GroundingTests(unittest.TestCase):
    """Check citation validation, answer checking, and final display formatting."""

    def setUp(self):
        # Keep a tiny evidence set so every expected citation and claim is clear.
        self.sources = [
            {
                "source_id": "S1",
                "page": 123,
                "text": "Human contemplation needs external prosperity, a healthy body, food, and other care.",
            },
            {
                "source_id": "S2",
                "page": 12,
                "text": "Happiness is an activity of soul in accordance with perfect virtue.",
            },
        ]

    @staticmethod
    def evidence(source_id, quote):
        """Build one exact passage excerpt for the evidence-checker schema."""
        return [{"source_id": source_id, "quote": quote}]

    def test_long_verbatim_answer_is_rejected_but_direct_quote_requests_allow_it(self):
        """Keep a pasted passage out of normal answers while honoring quote requests."""
        source_text = (
            "All knowledge and every pursuit aims at some good, and the highest of all goods "
            "achievable by action is happiness, because both ordinary people and thoughtful people "
            "identify living and doing well with being happy, although they differ about what happiness "
            "itself is, and some regard it as pleasure, wealth, or honor."
        )
        source = [{"source_id": "S1", "page": 2, "text": source_text}]
        answer_item = {
            "text": source_text,
            "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
        }
        issues = []

        self.assertTrue(app.is_long_verbatim_answer(source_text, source))
        self.assertIsNone(app.format_cited_sentences([answer_item], source, validation_issues=issues))
        self.assertIn("repeats a long source passage instead of synthesizing", issues[0])
        self.assertTrue(app.question_requests_direct_quote("Quote Aristotle's exact wording about happiness."))
        self.assertFalse(app.question_requests_direct_quote("How does Aristotle define happiness?"))
        self.assertEqual(
            app.format_cited_sentences(
                [answer_item], source, allow_verbatim_answer=True
            ),
            source_text[:-1] + " [S1].",
        )

    def test_long_verbatim_answer_retries_from_sources_and_accepts_a_synthesis(self):
        """A copied passage triggers one clean source-only reconstruction."""
        source_text = (
            "All knowledge and every pursuit aims at some good, and the highest of all goods "
            "achievable by action is happiness, because both ordinary people and thoughtful people "
            "identify living and doing well with being happy, although they differ about what happiness "
            "itself is, and some regard it as pleasure, wealth, or honor."
        )
        sources = [{"source_id": "S1", "page": 2, "text": source_text}]
        copied = {"message": {"content": json.dumps({"sentences": [{
            "text": source_text,
            "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
        }]})}}
        synthesis = {"message": {"content": json.dumps({"sentences": [{
            "text": "The highest good achievable by action is happiness.",
            "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
        }]})}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(copied), FakeResponse(copied), FakeResponse(synthesis)],
        ) as mocked_urlopen:
            answer = app.verify_answer("What is the highest good?", sources, "draft", "qwen3:4b", diagnostics)

        self.assertEqual(answer, "The highest good achievable by action is happiness [S1].")
        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertIn(
            "repeats a long source passage instead of synthesizing",
            diagnostics["attempts"][0]["reason"],
        )
        final_prompt = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))["messages"][-1]["content"]
        self.assertIn("Start over from the passages below", final_prompt)
        self.assertIn("concise synthesis", final_prompt)
        self.assertNotIn("Fresh candidate to repair", final_prompt)

    def test_evidence_checker_budget_scales_with_items_and_truncated_json(self):
        """Reserve more output for multi-item checks and bounded JSON recovery."""
        self.assertGreater(
            app.evidence_checker_output_budget(3),
            app.evidence_checker_output_budget(2),
        )
        self.assertEqual(app.evidence_checker_output_budget(3), 780)
        self.assertEqual(
            app.evidence_checker_output_budget(3, attempt=1, previous_failure="model returned invalid JSON"),
            1080,
        )
        self.assertLessEqual(
            app.evidence_checker_output_budget(4, attempt=2, previous_failure="model returned invalid JSON"),
            1400,
        )
        self.assertEqual(
            app.evidence_checker_output_budget(2, attempt=2, json_truncation_seen=True),
            1040,
        )

    def test_checker_retry_adds_output_room_after_truncated_json(self):
        """Use a larger bounded retry when the first structured response is cut off."""
        valid = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue."
                ),
            }],
        })}}
        responses = [
            FakeResponse({"message": {"content": '{"sentences": ['}}),
            FakeResponse(valid),
        ]
        payloads = []

        def capture_request(request, timeout):
            payloads.append(json.loads(request.data.decode("utf-8")))
            return responses[len(payloads) - 1]

        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            result = app.verify_answer(
                "What is happiness?", self.sources, "draft", "qwen3:4b", diagnostics
            )

        self.assertIn("Happiness is an activity", result)
        self.assertEqual(payloads[0]["options"]["num_predict"], 580)
        self.assertEqual(payloads[1]["options"]["num_predict"], 880)
        self.assertEqual(diagnostics["attempts"][0]["num_predict"], 580)
        self.assertEqual(diagnostics["attempts"][1]["num_predict"], 880)
        # Ordinary sentence items keep their own concise answer limit, while
        # exact evidence remains wide enough for the existing 45-word rule.
        ordinary_item_schema = payloads[0]["format"]["properties"]["sentences"]["items"]
        self.assertEqual(
            ordinary_item_schema["properties"]["text"]["maxLength"],
            app.MAX_CHECKER_ANSWER_CHARS,
        )
        self.assertEqual(
            ordinary_item_schema["properties"]["evidence"]["items"]["properties"]["quote"]["maxLength"],
            app.MAX_EVIDENCE_QUOTE_CHARS,
        )

    def test_checker_keeps_added_output_room_after_intervening_quote_failure(self):
        """A quote failure between truncated responses must not reset repair capacity."""
        valid = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue."
                ),
            }],
        })}}
        invalid_quote = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence("S2", "Happiness is a good activity"),
            }],
        })}}
        responses = [
            FakeResponse({"message": {"content": '{"sentences": ['}}),
            FakeResponse(invalid_quote),
            FakeResponse(valid),
        ]
        payloads = []

        def capture_request(request, timeout):
            payloads.append(json.loads(request.data.decode("utf-8")))
            return responses[len(payloads) - 1]

        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            result = app.verify_answer(
                "What is happiness?", self.sources, "draft", "llama3.2:3b", diagnostics
            )

        self.assertIn("Happiness is an activity", result)
        self.assertEqual(
            [payload["options"]["num_predict"] for payload in payloads],
            [580, 880, 1040],
        )
        self.assertEqual(
            [attempt["num_predict"] for attempt in diagnostics["attempts"]],
            [580, 880, 1040],
        )
        self.assertEqual(diagnostics["attempts"][1]["status"], "rejected")
        self.assertIn("not an exact passage match", diagnostics["attempts"][1]["reason"])
        self.assertEqual(diagnostics["attempts"][2]["status"], "accepted")

    def test_evidence_quote_must_be_an_exact_contiguous_source_excerpt(self):
        """Allow PDF whitespace/case differences, but reject paraphrases and tiny quotes."""
        self.assertTrue(app.evidence_quote_matches(
            "ACTIVITY of soul in accordance\nwith perfect virtue",
            self.sources[1]["text"],
        ))
        self.assertTrue(app.evidence_quote_matches(
            "activity-of-soul in accordance with perfect virtue",
            self.sources[1]["text"],
        ))
        self.assertTrue(app.evidence_quote_matches(
            "the one determines the end and the other makes us do the things",
            "the one deter, mines the end and the other makes us do the things",
        ))
        self.assertFalse(app.evidence_quote_matches(
            "Happiness is a good activity of the soul", self.sources[1]["text"]
        ))
        self.assertFalse(app.evidence_quote_matches("perfect virtue", self.sources[1]["text"]))
        long_quote = " ".join(f"long{index}" for index in range(46))
        self.assertFalse(app.evidence_quote_matches(long_quote, long_quote))

    def test_quote_with_one_extra_article_is_corrected_to_exact_source_text(self):
        """Repair a single inserted article without relaxing exact quotation checks."""
        source_text = (
            "Thus, in one word, states of character arise out of like activities. "
            "This is why the activities we exhibit must be of a certain kind."
        )
        source = [{"source_id": "S1", "page": 14, "text": source_text}]
        quote = "the states of character arise out of like activities"
        item = {
            "text": "States of character arise out of like activities.",
            "evidence": self.evidence("S1", quote),
        }
        trace = []

        answer = app.format_cited_sentences([item], source, quote_repair_trace=trace)

        self.assertEqual(answer, "States of character arise out of like activities [S1].")
        self.assertEqual(
            item["evidence"][0]["quote"],
            "states of character arise out of like activities",
        )
        self.assertTrue(app.evidence_quote_matches(item["evidence"][0]["quote"], source_text))
        self.assertEqual(trace[0]["outcome"], "removed_one_extra_article")

        # A content-word change or an added negation cannot be normalized into
        # a source quote; only one redundant article is eligible for repair.
        self.assertIsNone(app.repair_quote_with_one_extra_article(
            "the claims of character arise out of like activities", source_text
        ))
        self.assertIsNone(app.repair_quote_with_one_extra_article(
            "not states of character arise out of like activities", source_text
        ))

    def test_short_exact_quote_expands_only_to_context_that_covers_its_claim(self):
        """A narrow exact quote may gain adjacent exact wording from its passage."""
        source_text = (
            "By behaving in the appropriate circumstances, some men become temperate and good-tempered, "
            "others self-indulgent and irascible. Thus, in one word, states of character arise out of like activities."
        )
        source = [{"source_id": "S1", "page": 14, "text": source_text}]
        claim = (
            "By behaving in appropriate circumstances, some people become temperate or self-indulgent, "
            "and states of character arise out of like activities."
        )
        item = {
            "text": claim,
            "evidence": self.evidence("S1", "states of character arise out of like activities"),
        }
        trace = []

        answer = app.format_cited_sentences([item], source, quote_repair_trace=trace)

        self.assertEqual(answer, claim[:-1] + " [S1].")
        expanded = item["evidence"][0]["quote"]
        self.assertIn("appropriate circumstances", expanded)
        self.assertIn("some men become temperate", expanded)
        self.assertIn("states of character arise out of like activities", expanded)
        self.assertTrue(app.evidence_quote_matches(expanded, source_text))
        self.assertLessEqual(len(app.TOKEN_RE.findall(expanded)), app.MAX_EVIDENCE_QUOTE_WORDS)
        self.assertEqual(trace[0]["outcome"], "expanded_exact_quote_for_claim_context")

    def test_short_exact_quote_does_not_expand_to_unrelated_source_words(self):
        """Context repair must not make an unsupported sentence pass by proximity."""
        source_text = (
            "States of character arise out of like activities. "
            "The philosopher also speaks about the weather and ships at sea."
        )
        source = [{"source_id": "S1", "page": 14, "text": source_text}]
        item = {
            "text": "The weather causes ships to become virtuous.",
            "evidence": self.evidence("S1", "States of character arise out of like activities"),
        }
        issues = []

        answer = app.format_cited_sentences([item], source, validation_issues=issues)

        self.assertIsNone(answer)
        self.assertTrue(any("could not tie every claim clause" in issue for issue in issues))

    def test_quote_with_retrieval_metadata_gets_actionable_validation_feedback(self):
        """Tell the repair model to remove copied page and window labels."""
        quote = (
            "PDF page 12, retrieved for part 1, sentence 1: "
            "Happiness is an activity of soul in accordance with perfect virtue."
        )
        issues = []

        result = app.format_cited_sentences(
            [{
                "text": "Happiness is an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence("S2", quote),
            }],
            self.sources,
            validation_issues=issues,
        )

        self.assertIsNone(result)
        self.assertEqual(len(issues), 1)
        self.assertIn("includes passage locator metadata", issues[0])
        self.assertIn("only exact book wording", issues[0])

    def test_claim_clause_cannot_add_terms_missing_from_its_cited_passage(self):
        """Reject a supported base clause with a new, unevidenced add-on."""
        cited = [
            {
                "source_id": "S1",
                "page": 6,
                "text": "The human good turns out to be activity of soul in accordance with virtue.",
            }
        ]
        claim = (
            "Happiness is activity of the soul in accordance with virtue, "
            "which requires moral excellence and practical wisdom."
        )
        self.assertFalse(app.evidence_covers_claim_vocabulary(claim, cited))
        self.assertTrue(app.evidence_covers_claim_vocabulary(
            "Happiness is activity of the soul in accordance with virtue.", cited
        ))
        relationship = "Practical wisdom determines the end while moral virtue determines the means."
        ambiguous_excerpt = "the one determines the end and the other makes us do the things that lead to the end"
        explicit_excerpt = "virtue makes us aim at the right mark, and practical wisdom makes us take the right means"
        self.assertFalse(app.evidence_covers_claim_vocabulary(
            relationship, cited, [ambiguous_excerpt]
        ))
        self.assertTrue(app.evidence_covers_claim_vocabulary(
            relationship, cited, [explicit_excerpt]
        ))

    def test_multi_concept_claim_requires_each_question_concept_in_quoted_evidence(self):
        """Do not let a quote about one named idea support a claim about two."""
        question = "What would Aristotle think of God and the soul?"
        # This reproduces the shape of the Build 87 false positive: a passage
        # mentions the good man, measure, and soul, but not God. Those shared
        # generic words were enough for the old two-term overlap threshold.
        excerpt = (
            "the good man seem, as has been said, to be the measure of every class of things; "
            "for his opinions are harmonious, and he desires the same things with all his soul"
        )
        claim = "Aristotle thinks God and the good soul are the measure of all things."
        topic_terms = app.question_topic_anchor_terms(question)

        self.assertEqual(topic_terms, {"god", "soul"})
        self.assertTrue(app.evidence_covers_claim_vocabulary(claim, [], [excerpt]))
        self.assertFalse(app.evidence_covers_claim_vocabulary(
            claim, [], [excerpt], required_topic_terms=topic_terms
        ))
        self.assertIn(
            "god",
            app.claim_vocabulary_gaps(claim, [excerpt], topic_terms)[0],
        )

        source = [{"source_id": "S1", "page": 12, "text": excerpt}]
        issues = []
        result = app.format_cited_sentences(
            [{"text": claim, "evidence": self.evidence("S1", excerpt)}],
            source,
            validation_issues=issues,
            required_topic_terms=topic_terms,
        )
        self.assertIsNone(result)
        self.assertIn("missing wording includes: god", issues[0])

    def test_checker_retries_when_a_clause_adds_unsupported_content(self):
        """A valid quote cannot carry a separate claim absent from that passage."""
        source = [{
            "source_id": "S1",
            "page": 6,
            "text": "The human good turns out to be activity of soul in accordance with virtue.",
        }]
        unsupported = {"message": {"content": json.dumps({
            "sentences": [{
                "text": (
                    "Happiness is activity of the soul in accordance with virtue, "
                    "which requires moral excellence and practical wisdom."
                ),
                "evidence": self.evidence("S1", "activity of soul in accordance with virtue"),
            }],
        })}}
        corrected = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is activity of the soul in accordance with virtue.",
                "evidence": self.evidence("S1", "activity of soul in accordance with virtue"),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(unsupported), FakeResponse(corrected)],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What is happiness?", source, "UNSUPPORTED_DRAFT_SENTINEL", "qwen3:4b", diagnostics
            )

        self.assertEqual(result, "Happiness is activity of the soul in accordance with virtue [S1].")
        self.assertEqual(diagnostics["attempts"][0]["status"], "rejected")
        self.assertIn("key terms absent", diagnostics["attempts"][0]["reason"])
        self.assertIn("missing wording includes", diagnostics["attempts"][0]["reason"])
        self.assertIn("practical", diagnostics["attempts"][0]["reason"])
        self.assertIn("wisdom", diagnostics["attempts"][0]["reason"])
        # The retry should see the actual gap so it can remove the unsupported
        # add-on, while rebuilding from passages instead of copying the draft.
        retry_payload = json.loads(mocked_urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        retry_instruction = retry_payload["messages"][-1]["content"]
        self.assertIn("selected excerpt", retry_instruction)
        self.assertIn("practical", retry_instruction)
        self.assertIn("wisdom", retry_instruction)
        self.assertIn("Do not reuse or repeat their wording", retry_instruction)
        self.assertIn("Available passages and citation IDs", retry_instruction)
        self.assertNotIn("UNSUPPORTED_DRAFT_SENTINEL", retry_instruction)
        self.assertNotIn("Draft answer to check", retry_instruction)
        self.assertEqual(diagnostics["attempts"][1]["status"], "accepted")

    def test_retry_receives_all_uncovered_sentences_not_only_the_first(self):
        """A first gap must not hide another unsupported claim from the retry."""
        source = [{
            "source_id": "S1",
            "page": 6,
            "text": "Human good turns out to be activity of soul in accordance with virtue.",
        }]
        first_check = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "The good depends on practical wisdom.",
                    "evidence": self.evidence("S1", "human good turns out to be activity of soul"),
                },
                {
                    "text": "This requires moral excellence.",
                    "evidence": self.evidence("S1", "activity of soul in accordance with virtue"),
                },
            ],
        })}}
        empty_retry = {"message": {"content": json.dumps({"sentences": []})}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(first_check), FakeResponse(empty_retry)],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "How is human good defined?", source, "draft", "qwen3:4b", diagnostics
            )

        self.assertTrue(result.startswith("I couldn't verify"))
        findings = diagnostics["attempts"][0]["issues"]
        self.assertEqual(len(findings), 2)
        self.assertIn("answer item 1", findings[0])
        self.assertIn("answer item 2", findings[1])
        self.assertIn("practical", findings[0])
        self.assertIn("excellence", findings[1])
        # Both failed claims reach the retry, so it can repair the whole answer
        # instead of fixing only whichever sentence was checked first.
        retry_payload = json.loads(mocked_urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        retry_instruction = retry_payload["messages"][-1]["content"]
        self.assertIn("Address every numbered validation finding", retry_instruction)
        self.assertIn("answer item 1", retry_instruction)
        self.assertIn("answer item 2", retry_instruction)
        self.assertNotIn("The good depends on practical wisdom", retry_instruction)
        self.assertNotIn("This requires moral excellence", retry_instruction)

    def test_checker_rejects_ambiguous_reversed_roles_then_accepts_explicit_evidence(self):
        """Resolve end/means claims from named evidence, despite OCR punctuation."""
        sources = [
            {
                "source_id": "S1",
                "page": 72,
                "text": (
                    "Again, the work of man is achieved only in accordance with practical wisdom "
                    "as well as with moral virtue; for virtue makes us aim at the right mark, "
                    "and practical wisdom makes us take the right means."
                ),
            },
            {
                "source_id": "S5",
                "page": 73,
                "text": (
                    "The choice will not be right without practical wisdom any more than without "
                    "virtue; for the one deter, mines the end and the other makes us do the things "
                    "that lead to the end."
                ),
            },
        ]
        reversed_roles = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Practical wisdom determines the end while moral virtue determines the means.",
                "evidence": self.evidence(
                    "S5",
                    "the one determines the end and the other makes us do the things that lead to the end",
                ),
            }],
        })}}
        corrected = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Moral virtue aims at the right mark, while practical wisdom chooses the means.",
                "evidence": self.evidence(
                    "S1",
                    "achieved only in accordance with practical wisdom as well as with moral virtue; "
                    "for virtue makes us aim at the right mark, and practical wisdom makes us take the right means",
                ),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(reversed_roles), FakeResponse(corrected)],
        ):
            result = app.verify_answer(
                "What is the relation between practical wisdom and moral virtue?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(
            result,
            "Moral virtue aims at the right mark, while practical wisdom chooses the means [S1].",
        )
        self.assertEqual(diagnostics["attempts"][0]["status"], "rejected")
        self.assertIn("key terms absent", diagnostics["attempts"][0]["reason"])
        self.assertEqual(diagnostics["attempts"][1]["status"], "accepted")

    def test_valid_inline_citations_are_moved_to_sentence_ends(self):
        """Allow citation placement variants but reject missing or unknown IDs."""
        self.assertTrue(app.answer_has_valid_citations("Happiness accords with virtue [S2].", self.sources))
        self.assertTrue(app.answer_has_valid_citations("The body needs care [S1, S2].", self.sources))
        self.assertFalse(app.answer_has_valid_citations("Happiness accords with virtue.", self.sources))
        self.assertFalse(app.answer_has_valid_citations("Happiness [S9].", self.sources))
        self.assertEqual(
            app.normalize_citations("Happiness [S2] is an activity.", self.sources),
            "Happiness is an activity [S2].",
        )
        self.assertEqual(
            app.normalize_citations("Happiness is activity. [S2] The body needs care. [S1]", self.sources),
            "Happiness is activity [S2]. The body needs care [S1].",
        )
        self.assertIsNone(app.normalize_citations("First claim [S2]. Second claim.", self.sources))

    def test_evidence_check_can_correct_a_contradictory_draft(self):
        """A checker should keep supported material and remove the false claim."""
        corrected = {
            "sentences": [
                {
                    "text": "Aristotle defines happiness as activity of the soul in accordance with perfect virtue.",
                    "evidence": self.evidence("S2", "activity of soul in accordance with perfect virtue"),
                },
                {
                    "text": "He also says human contemplation needs external goods such as food and care.",
                    "evidence": self.evidence("S1", "external prosperity, a healthy body, food, and other care"),
                },
            ],
        }
        payload = {"message": {"content": json.dumps(corrected)}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer(
                "What is happiness?",
                self.sources,
                "Happiness is permanent and independent of external fortune [S2].",
                "qwen3:4b",
            )
        self.assertIn("external goods", result)
        self.assertNotIn("independent of external fortune", result)

    def test_evidence_checker_prompt_preserves_argument_attribution(self):
        """Keep the checker instruction that separates reported views from conclusions."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "The passage presents a reported view.", "evidence": self.evidence("S2", "activity of soul in accordance with perfect virtue")}],
        })}}
        captured = {}

        def capture_request(request, timeout):
            # Inspect the actual prompt sent to Ollama while keeping this test offline.
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(payload)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b")

        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("distinguish that reported view from", system_prompt)
        self.assertIn("preserve any objection or qualification", system_prompt)
        self.assertIn("do not swap which concept", system_prompt)
        self.assertIn("says only 'the one' and 'the other'", system_prompt)
        self.assertIn("addresses every part of the question", system_prompt)
        self.assertIn("explain the connection the author makes", system_prompt)
        self.assertIn("Do not make book-wide absence claims", system_prompt)
        self.assertIn("the book does not discuss this subject", system_prompt)
        self.assertIn("the passage that explicitly establishes those roles", system_prompt)
        self.assertIn("short, exact, continuous quotation", system_prompt)
        self.assertIn("3 to 45 words", system_prompt)
        self.assertIn("Split a sentence that combines separate factual claims", system_prompt)
        self.assertIn("direction of any relationship", system_prompt)
        self.assertIn("Keep that inference modest", system_prompt)
        self.assertIn("do not invent claims about modern society", system_prompt)
        self.assertIn("who advances each argument and who evaluates or rejects it", system_prompt)
        self.assertIn("do not transfer an argument across adjacent sentences", system_prompt)
        self.assertIn("The source context is divided into passage blocks", system_prompt)
        self.assertIn("Never copy source IDs, page numbers", system_prompt)
        self.assertIn("Do not copy a whole sentence when it exceeds this limit", system_prompt)
        self.assertIn("same source_id may appear twice", system_prompt)
        self.assertIn('"quote"', json.dumps(captured["payload"]["format"]))
        self.assertGreaterEqual(captured["payload"]["options"]["num_predict"], 580)
        self.assertIn('<passage source_id="S1" page="123"', captured["payload"]["messages"][-1]["content"])
        self.assertIn("TEXT: Human contemplation needs external prosperity", captured["payload"]["messages"][-1]["content"])

    def test_evidence_check_rejects_a_paraphrase_as_its_quote(self):
        """A plausible paraphrase cannot pass the app's exact excerpt check."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is a good activity of the soul.",
                "evidence": self.evidence("S2", "Happiness is a good activity of the soul"),
            }],
        })}}
        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b", diagnostics)
        self.assertTrue(result.startswith("I couldn't verify"))
        self.assertEqual(diagnostics["status"], "fallback")
        self.assertEqual(
            diagnostics["attempts"][0]["reason"],
            "answer item 1, evidence 1: the quoted excerpt for S2 was too short or not an exact passage match",
        )
        self.assertIn("checker_sentences", diagnostics["attempts"][0])

    def test_evidence_check_rejects_a_long_quote_without_claim_matching_windows(self):
        """Do not accept a long quote when it cannot be shortened precisely."""
        quote = (
            "Human contemplation needs external prosperity, a healthy body, food, and other care, "
            "and a solitary person without friends is not likely to be happy. These conditions and "
            "resources can support noble activities and the full course of a person's life, although "
            "their value depends on the uses people make of them in particular circumstances."
        )
        source = {"source_id": "S1", "page": 123, "text": quote}
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Human happiness needs many different conditions.", "evidence": self.evidence("S1", quote)}],
        })}}
        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What does happiness need?", [source], "draft", "qwen3:4b", diagnostics)
        self.assertTrue(result.startswith("I couldn't verify"))
        self.assertIn("maximum 45", diagnostics["attempts"][0]["reason"])
        self.assertIn("could not be safely shortened", diagnostics["attempts"][0]["reason"])

    def test_oversized_argument_quote_becomes_two_exact_claim_matching_excerpts(self):
        """Recover a supported argument when a model quotes a whole paragraph."""
        first_claim_part = (
            "The function of man is an activity of soul which follows or implies a rational principle"
        )
        filler = (
            "A person may consider many examples before reaching the point of the discussion. "
            "The passage compares skilled work with excellence and describes how actions are performed. "
            "These details explain why the argument moves from a function to a good performance."
        )
        conclusion = "Human good turns out to be activity of soul in accordance with virtue."
        quote = f"{first_claim_part}. {filler} {conclusion}"
        source = [{"source_id": "S1", "page": 6, "text": quote}]
        answer_item = {
            "text": (
                "Because the function of man is an activity of soul with a rational principle, "
                "human good is activity of soul in accordance with virtue."
            ),
            "evidence": self.evidence("S1", quote),
        }

        answer = app.format_cited_sentences([answer_item], source)

        self.assertIsNotNone(answer)
        self.assertIn("Because the function of man", answer)
        self.assertEqual(len(answer_item["evidence"]), 2)
        for excerpt in answer_item["evidence"]:
            quote_text = excerpt["quote"]
            self.assertLessEqual(len(app.TOKEN_RE.findall(quote_text)), app.MAX_EVIDENCE_QUOTE_WORDS)
            self.assertTrue(app.evidence_quote_matches(quote_text, source[0]["text"]))

    def test_oversized_exact_quote_can_recover_adjacent_claim_context(self):
        """Use a nearby source phrase when a model's exact quote starts too late."""
        source_text = (
            "Let us resume our inquiry and state, in view of the fact that all knowledge and every pursuit aims at some good, "
            "what it is that we say political science aims at and what is the highest of all goods achievable by action. "
            "Verbally there is very general agreement; for both the general run of men and people of superior refinement "
            "say that it is happiness, and identify living well and doing well with being happy; but with regard to what "
            "happiness is they differ, and the many do not give the same account as the wise. For the former think it is "
            "some plain and obvious thing, like pleasure, wealth, or honor."
        )
        # The model quotes an exact but overlong segment beginning after the
        # sentence that identifies the highest good. A short exact window from
        # the same cited paragraph can add that missing context while retaining
        # substantial overlap with the words the model selected.
        oversized_quote = (
            "Verbally there is very general agreement; for both the general run of men and people of superior refinement "
            "say that it is happiness, and identify living well and doing well with being happy; but with regard to what "
            "happiness is they differ, and the many do not give the same account as the wise. For the former think it is "
            "some plain and obvious thing, like pleasure, wealth, or honor."
        )
        claim = (
            "Happiness is the highest good achievable by action, though people differ about what happiness is."
        )
        source = [{"source_id": "S1", "page": 2, "text": source_text}]
        answer_item = {
            "text": claim,
            "evidence": self.evidence("S1", oversized_quote),
        }

        quote_repair_trace = []
        answer = app.format_cited_sentences(
            [answer_item], source, quote_repair_trace=quote_repair_trace
        )

        self.assertEqual(answer, claim[:-1] + " [S1].")
        self.assertGreaterEqual(len(answer_item["evidence"]), 1)
        for evidence in answer_item["evidence"]:
            excerpt = evidence["quote"]
            self.assertLessEqual(
                len(app.TOKEN_RE.findall(excerpt)), app.MAX_EVIDENCE_QUOTE_WORDS
            )
            self.assertTrue(app.evidence_quote_matches(excerpt, source_text))
        self.assertTrue(any("highest of all goods achievable by action" in e["quote"] for e in answer_item["evidence"]))
        self.assertEqual(len(quote_repair_trace), 1)
        self.assertEqual(quote_repair_trace[0]["outcome"], "compacted")
        self.assertTrue(quote_repair_trace[0]["source_context_available"])
        self.assertTrue(quote_repair_trace[0]["added_source_context"])

    def test_oversized_quote_can_compact_against_its_sibling_evidence(self):
        """Keep two-point comparisons when each exact excerpt supports one side."""
        practical_quote = (
            "it is to that which observes well the various matters concerning itself "
            "that one ascribes practical wisdom"
        )
        philosophic_quote = (
            "It is evident also that philosophic wisdom and the art of politics cannot be the same; "
            "for if the state of mind concerned with a man's own interests is to be called philosophic "
            "wisdom, there will be many philosophic wisdoms; there will not be one concerned with the "
            "good of all animals any more than there is one art of medicine for all existing things "
            "but a different philosophic wisdom about the good of each species."
        )
        source_text = f"{practical_quote}. {philosophic_quote}"
        source = [{"source_id": "S1", "page": 67, "text": source_text}]
        claim = "Aristotle distinguishes practical wisdom from philosophic wisdom by their objects of knowledge."
        answer_item = {
            "text": claim,
            "evidence": (
                self.evidence("S1", practical_quote)
                + self.evidence("S1", philosophic_quote)
            ),
        }

        answer = app.format_cited_sentences([answer_item], source)

        self.assertEqual(answer, claim[:-1] + " [S1].")
        self.assertEqual(len(answer_item["evidence"]), 2)
        self.assertIn("practical wisdom", answer_item["evidence"][0]["quote"])
        self.assertIn("philosophic wisdom", answer_item["evidence"][1]["quote"])
        self.assertLessEqual(
            len(app.TOKEN_RE.findall(answer_item["evidence"][1]["quote"])),
            app.MAX_EVIDENCE_QUOTE_WORDS,
        )

    def test_exact_quote_under_model_tolerant_cap_can_be_displayed(self):
        """A real model-sized excerpt should not trigger the old short-quote fallback."""
        words = [
            "Happiness", "is", "an", "activity", "of", "soul", "in", "accordance", "with", "virtue",
            "and", "it", "requires", "the", "proper", "equipment", "for", "noble", "acts", "including",
            "friends", "riches", "and", "political", "power", "in", "many", "actions", "and", "some",
            "things", "that", "lack", "their", "luster", "from", "happiness",
        ]
        quote = " ".join(words)
        source = [{"source_id": "S1", "page": 8, "text": quote}]
        result = app.format_cited_sentences(
            [{"text": "Happiness is an activity of soul in accordance with virtue.",
              "evidence": self.evidence("S1", quote)}],
            source,
        )

        self.assertEqual(result, "Happiness is an activity of soul in accordance with virtue [S1].")

    def test_exact_quote_slightly_above_legacy_cap_can_be_displayed(self):
        """Accept a supported near-limit excerpt instead of failing by a few words."""
        quote = (
            "by doing the acts that we do in our transactions with other men we become just or unjust, "
            "and by doing the acts that we do in the presence of danger, and being habituated to feel "
            "fear or confidence, we become brave or cowardly."
        )
        self.assertEqual(len(app.TOKEN_RE.findall(quote)), 44)
        source = [{"source_id": "S1", "page": 14, "text": quote}]
        claim = (
            "By doing acts with other men, we become just or unjust; by being habituated to fear or "
            "confidence in danger, we become brave or cowardly."
        )
        result = app.format_cited_sentences(
            [{"text": claim, "evidence": self.evidence("S1", quote)}],
            source,
        )

        self.assertEqual(result, claim.rstrip(".") + " [S1].")

    def test_validator_collects_quote_errors_from_all_answer_items(self):
        """A first oversized quote must not hide a later item's failure."""
        sources = [
            {
                "source_id": "S1",
                "page": 1,
                "text": " ".join(f"alpha{index}" for index in range(46)),
            },
            {
                "source_id": "S2",
                "page": 2,
                "text": " ".join(f"beta{index}" for index in range(46)),
            },
        ]
        items = [
            {"text": "Alpha0 and alpha1 are discussed.", "evidence": self.evidence("S1", sources[0]["text"])},
            {"text": "Beta0 and beta1 are discussed.", "evidence": self.evidence("S2", sources[1]["text"])},
        ]
        issues = []

        self.assertIsNone(app.format_cited_sentences(items, sources, validation_issues=issues))
        self.assertEqual(len(issues), 2)
        self.assertIn("answer item 1, evidence 1", issues[0])
        self.assertIn("answer item 2, evidence 1", issues[1])
        self.assertTrue(all("maximum 45" in issue for issue in issues))

    def test_final_repair_receives_structural_findings_and_fresh_candidate(self):
        """Repair a fresh answer's bad quote without replaying the original draft."""
        source = [{
            "source_id": "S1",
            "page": 8,
            "text": (
                "Human contemplation needs external prosperity, a healthy body, food, and other care, "
                "and a solitary person without friends is not likely to be happy. These conditions and "
                "resources can support noble activities and the full course of a person's life, although "
                "their value depends on the uses people make of them in particular circumstances."
            ),
        }]
        paraphrase = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Human contemplation requires prosperity.",
                "evidence": self.evidence("S1", "Human contemplation requires prosperity"),
            }],
        })}}
        oversized = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Contemplation requires practical wisdom.",
                    "evidence": self.evidence("S1", source[0]["text"]),
                },
                {
                    # Deliberately unsupported wording keeps this item invalid
                    # even after the formatter can compact oversized quotes.
                    "text": "Courage depends on practical wisdom.",
                    "evidence": self.evidence("S1", source[0]["text"]),
                },
            ],
        })}}
        repaired = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Human contemplation needs external prosperity.",
                "evidence": self.evidence("S1", "contemplation needs external prosperity"),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(paraphrase), FakeResponse(oversized), FakeResponse(repaired)],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What does contemplation need?", source, "ORIGINAL_DRAFT_SENTINEL", "qwen3:4b", diagnostics
            )

        self.assertEqual(result, "Human contemplation needs external prosperity [S1].")
        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(
            [entry["status"] for entry in diagnostics["attempts"]],
            ["rejected", "rejected", "accepted"],
        )
        self.assertEqual(len(diagnostics["attempts"][1]["quote_repairs"]), 2)
        self.assertTrue(all(
            repair["outcome"] == "no_safe_window"
            for repair in diagnostics["attempts"][1]["quote_repairs"]
        ))
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        self.assertIn("Fresh candidate to repair", repair_prompt)
        self.assertIn("answer item 1, evidence 1", repair_prompt)
        self.assertIn("answer item 2, evidence 1", repair_prompt)
        self.assertIn("maximum 45", repair_prompt)
        self.assertIn("Contemplation requires practical wisdom", repair_prompt)
        self.assertNotIn("ORIGINAL_DRAFT_SENTINEL", repair_prompt)

    def test_final_repair_can_add_a_second_excerpt_for_a_supported_paraphrase(self):
        """A valid cross-passage explanation should survive a too-narrow first quote.

        This reproduces the build 30 failure pattern: the semantic checker has a
        sound claim, but its first short excerpt omits vocabulary stated in a
        second passage. The repair prompt must ask it to find that second piece
        of evidence, while the formatter still validates every quote exactly.
        """
        highest_good_passage = (
            "Let us resume our inquiry and state what is the highest of all goods achievable by action. "
            "Verbally there is very general agreement; both the general run of men and people of superior "
            "refinement say that it is happiness."
        )
        function_passage = (
            "If we state the function of man to be a certain kind of life, and this to be an activity or "
            "actions of the soul implying a rational principle; if any action is well performed when it is "
            "performed in accordance with the appropriate excellence: if this is the case, human good turns "
            "out to be activity of soul in accordance with virtue."
        )
        sources = [
            {"source_id": "S1", "page": 2, "text": highest_good_passage},
            {"source_id": "S7", "page": 6, "text": function_passage},
        ]
        unsupported_by_excerpt = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "He argues that happiness is achieved through a life of virtue.",
                "evidence": self.evidence("S7", "human good turns out to be activity of soul in accordance with virtue"),
            }],
        })}}
        still_narrow = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "He argues that happiness is achieved through a life of virtue.",
                "evidence": self.evidence("S7", "human good turns out to be activity of soul in accordance with virtue"),
            }],
        })}}
        repaired = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Aristotle identifies happiness as the highest good achievable by action.",
                    "evidence": self.evidence(
                        "S1",
                        "what is the highest of all goods achievable by action. Verbally there is very general "
                        "agreement; both the general run of men and people of superior refinement say that it is happiness",
                    ),
                },
                {
                    "text": (
                        "His argument begins from the human function, an activity of soul implying a rational "
                        "principle; a function is performed well in accordance with appropriate excellence, "
                        "so human good is activity of soul in accordance with virtue."
                    ),
                    "evidence": [
                        {
                            "source_id": "S7",
                            "quote": "function of man to be a certain kind of life, and this to be an activity or actions of the soul implying a rational principle",
                        },
                        {
                            "source_id": "S7",
                            "quote": "if any action is well performed when it is performed in accordance with the appropriate excellence: if this is the case, human good turns out to be activity of soul in accordance with virtue",
                        },
                    ],
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[
                FakeResponse(unsupported_by_excerpt),
                FakeResponse(still_narrow),
                FakeResponse(repaired),
            ],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What does he identify as the highest human good?",
                sources,
                "ORIGINAL_DRAFT_SENTINEL",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(
            result,
            "Aristotle identifies happiness as the highest good achievable by action [S1]. "
            "His argument begins from the human function, an activity of soul implying a rational principle; "
            "a function is performed well in accordance with appropriate excellence, so human good is activity "
            "of soul in accordance with virtue [S7].",
        )
        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(
            [entry["status"] for entry in diagnostics["attempts"]],
            ["rejected", "rejected", "accepted"],
        )
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        self.assertIn("another passage directly supports the missing part", repair_prompt)
        self.assertIn("second short exact excerpt", repair_prompt)
        # The original draft remains excluded from the bounded repair context.
        self.assertNotIn("ORIGINAL_DRAFT_SENTINEL", repair_prompt)

    def test_argument_question_retries_a_cited_answer_that_only_states_the_result(self):
        """Do not accept a supported definition as a substitute for requested reasoning."""
        source = [
            {
                "source_id": "S1",
                "page": 2,
                "text": "The highest of all goods achievable by action is happiness.",
            },
            {
                "source_id": "S7",
                "page": 6,
                "text": (
                    "The function of man is activity of soul implying a rational principle. "
                    "If an action is well performed in accordance with appropriate excellence, "
                    "human good turns out to be activity of soul in accordance with virtue."
                ),
            },
        ]
        conclusion_only = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Aristotle identifies happiness as the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            },
            "reasoning": {
                "text": "Human good is activity of soul in accordance with virtue.",
                "evidence": self.evidence("S7", "human good turns out to be activity of soul in accordance with virtue"),
            },
        })}}
        reasoned_answer = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Aristotle identifies happiness as the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            },
            "reasoning": {
                "text": (
                    "Since a function is well performed in accordance with appropriate excellence, "
                    "Aristotle identifies human good with activity of soul in accordance with virtue."
                ),
                "evidence": self.evidence(
                    "S7",
                    "If an action is well performed in accordance with appropriate excellence, human good "
                    "turns out to be activity of soul in accordance with virtue",
                ),
            },
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[
                FakeResponse(conclusion_only),
                FakeResponse(conclusion_only),
                FakeResponse(reasoned_answer),
            ],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What is the highest good, and how does Aristotle argue for it?",
                source,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(diagnostics["attempts"][0]["status"], "rejected")
        self.assertIn("explicitly connect textual support", diagnostics["attempts"][0]["reason"])
        self.assertEqual(diagnostics["attempts"][1]["status"], "rejected")
        self.assertEqual(diagnostics["attempts"][2]["status"], "accepted")
        self.assertIn("Since a function is well performed", result)
        self.assertIn("Since", result)
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        initial_payload = json.loads(mocked_urlopen.call_args_list[0].args[0].data.decode("utf-8"))
        self.assertEqual(set(initial_payload["format"]["required"]), {"conclusion", "reasoning"})
        self.assertIn("conclusion", initial_payload["format"]["properties"])
        self.assertIn("reasoning", initial_payload["format"]["properties"])
        # Fixed argument roles get the tighter text ceiling; their exact quote
        # fields keep the shared quote ceiling and are still checked by words.
        argument_properties = initial_payload["format"]["properties"]["conclusion"]["properties"]
        self.assertEqual(argument_properties["text"]["maxLength"], app.MAX_ARGUMENT_FIELD_CHARS)
        self.assertEqual(
            argument_properties["evidence"]["items"]["properties"]["quote"]["maxLength"],
            app.MAX_EVIDENCE_QUOTE_CHARS,
        )
        self.assertIn("state the inference itself in the source's terms", initial_payload["messages"][0]["content"])
        self.assertIn("Do not narrate the answer structure", initial_payload["messages"][0]["content"])
        self.assertIn("separate conclusion and reasoning fields", repair_prompt)
        self.assertIn("Start over from the passages below", repair_prompt)
        self.assertIn("reasoning field may state a textual starting point", repair_prompt)
        self.assertIn("do not repeat the conclusion as its own support", repair_prompt)
        self.assertNotIn("Fresh candidate to repair", repair_prompt)
        self.assertNotIn("Aristotle identifies happiness as the highest good achievable by action", repair_prompt)

    def test_malformed_fresh_argument_json_gets_one_source_only_repair(self):
        """Use the final bounded call to rebuild after an invalid fresh response."""
        sources = [
            {
                "source_id": "S1",
                "page": 2,
                "text": "The highest of all goods achievable by action is happiness.",
            },
            {
                "source_id": "S7",
                "page": 6,
                "text": (
                    "If an action is well performed in accordance with appropriate excellence, "
                    "human good turns out to be activity of soul in accordance with virtue."
                ),
            },
        ]
        incomplete = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Happiness is the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            },
            "reasoning": {
                "text": "Human good is activity of soul in accordance with virtue.",
                "evidence": self.evidence("S7", "human good turns out to be activity of soul in accordance with virtue"),
            },
        })}}
        final_answer = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Happiness is the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            },
            "reasoning": {
                "text": (
                    "Since an action is well performed through appropriate excellence, Aristotle identifies "
                    "human good with virtuous activity of the soul."
                ),
                "evidence": self.evidence(
                    "S7",
                    "If an action is well performed in accordance with appropriate excellence, human good "
                    "turns out to be activity of soul in accordance with virtue",
                ),
            },
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[
                FakeResponse(incomplete),
                FakeResponse({"message": {"content": "{malformed fresh reconstruction"}}),
                FakeResponse(final_answer),
            ],
        ) as mocked_urlopen:
            answer = app.verify_answer(
                "What is the highest good, and how does Aristotle argue for it?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(diagnostics["attempts"][0]["status"], "rejected")
        self.assertIn("invalid JSON", diagnostics["attempts"][1]["reason"])
        self.assertEqual(diagnostics["attempts"][2]["status"], "accepted")
        self.assertIn("virtuous activity", answer)
        final_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        final_prompt = final_payload["messages"][-1]["content"]
        self.assertIn("Start over from the passages below", final_prompt)
        self.assertNotIn("Fresh candidate to repair", final_prompt)
        self.assertNotIn("malformed fresh reconstruction", final_prompt)

    def test_argument_reasoning_may_cite_a_different_passage_from_conclusion(self):
        """Do not require premise and inference to occupy the conclusion's passage."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        answer = "The highest human good is happiness. Since people identify happiness with living well, Aristotle explains the good through human activity."
        items = [
            {"role": "conclusion", "text": "The highest human good is happiness.", "evidence": self.evidence("S1", "highest good")},
            {"role": "reasoning", "text": "Since people identify happiness with living well, Aristotle explains the good through human activity.", "evidence": self.evidence("S6", "happiness as a sort of good life and good action")},
        ]

        issue = app.argument_coverage_issue(question, answer, items)
        self.assertIsNone(issue)

        # A causal word alone still cannot connect unrelated claims.
        items[1]["text"] = "Since this passage is important, Aristotle describes a different argument about virtue."
        answer = "The highest human good is happiness. Since this passage is important, Aristotle describes a different argument about virtue."
        issue = app.argument_coverage_issue(question, answer, items)
        self.assertIn("key concepts from the conclusion", issue)

    def test_argument_roles_allow_two_distinct_contributions(self):
        """Allow a concise conclusion and reasoning pair without weakening distinctness."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        repeated_items = [
            {
                "role": "conclusion",
                "text": "The highest human good is happiness, an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence("S7", "activity of soul in accordance with virtue"),
            },
            {
                "role": "reasoning",
                "text": "Aristotle connects the highest human good to virtue because it is an activity of soul in accordance with perfect virtue.",
                "evidence": self.evidence("S7", "activity of soul in accordance with virtue"),
            },
        ]
        repeated_answer = " ".join(item["text"] for item in repeated_items)
        issue = app.argument_coverage_issue(question, repeated_answer, repeated_items)
        self.assertIn("repeats the conclusion", issue)

        distinct_items = [
            {
                "role": "conclusion",
                "text": "Happiness is the highest human good.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            },
            {
                "role": "reasoning",
                "text": "Since political science seeks the highest good action can achieve, Aristotle identifies happiness as that end.",
                "evidence": self.evidence("S1", "political science aims at the highest good achievable by action"),
            },
        ]
        distinct_answer = " ".join(item["text"] for item in distinct_items)
        self.assertIsNone(app.argument_coverage_issue(question, distinct_answer, distinct_items))

    def test_argument_role_paragraph_is_rebuilt_as_concise_fields(self):
        """Stop one role field from hiding a long bundle of answer claims."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        source = [{
            "source_id": "S1",
            "page": 2,
            "text": (
                "The highest good achievable by action is happiness. Political science aims at "
                "the highest good achievable by action."
            ),
        }]
        long_response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": (
                    "Happiness is the highest good achievable by action. "
                    "It is the end sought by political science. "
                    "It is also the most complete human good."
                ),
                "evidence": self.evidence("S1", "highest good achievable by action is happiness"),
            },
            "reasoning": {
                "text": "Since political science aims at the highest good achievable by action, happiness is that end.",
                "evidence": self.evidence("S1", "Political science aims at the highest good achievable by action"),
            },
        })}}
        concise_response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Happiness is the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest good achievable by action is happiness"),
            },
            "reasoning": {
                "text": "Since political science aims at the highest good achievable by action, happiness is that end.",
                "evidence": self.evidence("S1", "Political science aims at the highest good achievable by action"),
            },
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(long_response), FakeResponse(concise_response)],
        ) as mocked_urlopen:
            answer = app.verify_answer(
                question, source, "draft", "llama3.2:3b", diagnostics
            )

        self.assertEqual(mocked_urlopen.call_count, 2)
        self.assertIn("Happiness is the highest good achievable by action [S1].", answer)
        self.assertIn("contains 3 sentences", diagnostics["attempts"][0]["reason"])
        self.assertEqual(diagnostics["attempts"][1]["status"], "accepted")
        self.assertNotIn("quote_repairs", diagnostics["attempts"][0])

    def test_argument_paragraph_recovery_checks_sentences_and_returns_partial(self):
        """Recover only independently supported conclusion and reasoning lines."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        source_text = (
            "The highest good achievable by action is happiness. Political science aims at the highest good "
            "achievable by action. Happiness is the end of political science. People agree that living well "
            "and doing well are happiness, but they differ about what happiness is. The many think happiness "
            "is some plain and obvious thing like pleasure, wealth, or honor."
        )
        source = [{"source_id": "S1", "page": 2, "text": source_text}]
        response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": (
                    "Happiness is the highest good achievable by action. "
                    "Political science aims at the highest good achievable by action. "
                    "This is the final purpose of every human activity."
                ),
                "evidence": self.evidence("S1", source_text),
            },
            "reasoning": {
                "text": (
                    "Since political science aims at the highest good achievable by action, happiness is that end. "
                    "The source connects this pursuit with happiness. "
                    "This proves why happiness matters most."
                ),
                "evidence": self.evidence("S1", source_text),
            },
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(response), FakeResponse(response), FakeResponse(response)],
        ) as mocked_urlopen:
            answer = app.verify_answer(
                question, source, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertIn("Happiness is the highest good achievable by action [S1].", answer)
        self.assertIn("Since political science aims at the highest good achievable by action", answer)
        self.assertIn("not the complete argument", answer)
        self.assertEqual(diagnostics["status"], "partial")
        self.assertTrue(diagnostics.get("recovery_quote_repairs"))
        self.assertTrue(any(
            item["outcome"] == "compacted"
            for item in diagnostics["recovery_quote_repairs"]
        ))
        # Deterministic recovery shows at most one sentence per argument role;
        # later, even seemingly related sentences remain omitted and the
        # answer is explicitly marked incomplete.
        self.assertNotIn("final purpose", answer)
        self.assertNotIn("proves why", answer)

    def test_argument_recovery_names_when_reasoning_did_not_survive(self):
        """A recovered conclusion must not imply its argument was verified."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        source_text = (
            "The highest good achievable by action is happiness. Political science aims at the highest good "
            "achievable by action. Happiness is the end of political science."
        )
        source = [{"source_id": "S1", "page": 2, "text": source_text}]
        response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": (
                    "Happiness is the highest good achievable by action. "
                    "The moon is made of cheese. The sun is cold."
                ),
                "evidence": self.evidence("S1", source_text),
            },
            "reasoning": {
                "text": "Cats are philosophers. The moon is made of cheese. The sun is cold.",
                "evidence": self.evidence("S1", source_text),
            },
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(response), FakeResponse(response), FakeResponse(response)],
        ):
            answer = app.verify_answer(
                question, source, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(diagnostics["status"], "partial")
        self.assertIn("Happiness is the highest good achievable by action [S1].", answer)
        self.assertIn("I could verify a point about the conclusion", answer)
        self.assertIn("not the complete argument requested", answer)

    def test_argument_recovery_does_not_trust_reasoning_role_without_a_link(self):
        """A supported summary labeled reasoning is not an argument link."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        source_text = (
            "Happiness is the highest good achievable by action. "
            "The text discusses the nature of happiness."
        )
        source = [{"source_id": "S1", "page": 2, "text": source_text}]
        response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": (
                    "Happiness is the highest good achievable by action. "
                    "The moon is made of cheese. The sun is cold."
                ),
                "evidence": self.evidence("S1", source_text),
            },
            "reasoning": {
                "text": (
                    "The text discusses the nature of happiness. "
                    "The moon is made of cheese. The sun is cold."
                ),
                "evidence": self.evidence("S1", source_text),
            },
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(response), FakeResponse(response), FakeResponse(response)],
        ):
            answer = app.verify_answer(
                question, source, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(diagnostics["status"], "partial")
        self.assertIn("Happiness is the highest good achievable by action [S1].", answer)
        self.assertIn("evidence did not establish a reasoning link", answer)
        self.assertIn("The text discusses the nature of happiness [S1].", answer)
        self.assertNotIn("argument components", answer)

    def test_partial_recovery_keeps_supported_sentences_from_a_mixed_item(self):
        """A bad sentence must not erase a separate, independently supported point."""
        question = "What is the highest human good, and how does Aristotle argue for it?"
        sources = [
            {
                "source_id": "S1",
                "page": 2,
                "text": "The highest good achievable by action is happiness.",
            },
            {
                "source_id": "S2",
                "page": 6,
                "text": "The function of man is an activity of soul implying a rational principle.",
            },
        ]
        response = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "Happiness is the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest good achievable by action is happiness"),
            },
            "reasoning": {
                "text": (
                    "Aristotle rejects pleasure as the highest good. "
                    "The function of man is activity of soul implying a rational principle."
                ),
                "evidence": self.evidence(
                    "S2", "function of man is an activity of soul implying a rational principle"
                ),
            },
        })}}
        diagnostics = {}

        # Keep all bounded model attempts invalid so the test exercises the
        # app's deterministic, sentence-by-sentence partial recovery path.
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(response), FakeResponse(response), FakeResponse(response)],
        ) as mocked_urlopen:
            answer = app.verify_answer(question, sources, "draft", "qwen3:4b", diagnostics)

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertIn("Happiness is the highest good achievable by action [S1].", answer)
        self.assertIn(
            "The function of man is activity of soul implying a rational principle [S2].",
            answer,
        )
        self.assertNotIn("rejects pleasure", answer)
        self.assertIn("not the complete argument", answer)

    def test_argument_answer_missing_inference_is_rebuilt_without_candidate(self):
        """Rebuild a conclusion-only explanation instead of anchoring final repair to it."""
        sources = [
            {
                "source_id": "S1",
                "page": 2,
                "text": "The highest of all goods achievable by action is happiness.",
            },
            {
                "source_id": "S7",
                "page": 6,
                "text": (
                    "The function of man is activity of soul implying a rational principle. "
                    "A good function is performed in accordance with appropriate excellence. "
                    "Therefore human good is activity of soul in accordance with virtue."
                ),
            },
        ]
        unsupported = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "role": "conclusion",
                    "text": "Aristotle identifies happiness as the highest good achievable by action.",
                    "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
                },
                {
                    "role": "reasoning",
                    "text": (
                        "Human good is activity of soul in accordance with virtue."
                    ),
                    "evidence": self.evidence(
                        "S7", "Therefore human good is activity of soul in accordance with virtue"
                    ),
                },
            ],
        })}}
        supported = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "role": "conclusion",
                    "text": "Aristotle identifies happiness as the highest good achievable by action.",
                    "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
                },
                {
                    "role": "reasoning",
                    "text": (
                        "Since a good function is performed in accordance with appropriate excellence, "
                        "Aristotle connects human good with virtuous activity of the soul."
                    ),
                    "evidence": self.evidence(
                        "S7",
                        "A good function is performed in accordance with appropriate excellence. Therefore "
                        "human good is activity of soul in accordance with virtue",
                    ),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(unsupported), FakeResponse(unsupported), FakeResponse(supported)],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What is the highest good, and how does Aristotle argue for it?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(diagnostics["attempts"][2]["status"], "accepted")
        self.assertIn("virtuous activity", result)
        self.assertIn("Since", result)
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        self.assertIn("Start over from the passages below", repair_prompt)
        self.assertIn("Prefer the author's terms", repair_prompt)
        self.assertNotIn("Fresh candidate to repair", repair_prompt)
        self.assertNotIn("practical wisdom", repair_prompt)

    def test_multipart_answer_rebuilds_when_one_part_is_repeated(self):
        """Require distinct answer items for each clause of a compound question."""
        question = (
            "What does Aristotle mean by practical wisdom, and how does it relate to moral virtue?"
        )
        sources = [
            {
                "source_id": "S1",
                "page": 71,
                "text": (
                    "Practical wisdom is the quality of mind concerned with things just and noble "
                    "and good for man."
                ),
            },
            {
                "source_id": "S2",
                "page": 72,
                "text": (
                    "Again, the work of man is achieved only in accordance with practical wisdom as well as "
                    "with moral virtue; for virtue makes us aim at the right mark, and practical wisdom makes "
                    "us take the right means."
                ),
            },
        ]
        repeated_part = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "question_part": 1,
                    "text": "Practical wisdom is the quality of mind concerned with things just and noble and good for man.",
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom is the quality of mind concerned with things just and noble and good for man",
                    ),
                },
                {
                    "question_part": 1,
                    "text": "Practical wisdom helps people act well with moral virtue.",
                    "evidence": self.evidence(
                        "S2",
                        "in accordance with practical wisdom as well as with moral virtue",
                    ),
                },
            ],
        })}}
        corrected = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "question_part": 1,
                    "text": "Practical wisdom is the quality of mind concerned with things just and noble and good for man.",
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom is the quality of mind concerned with things just and noble and good for man",
                    ),
                },
                {
                    "question_part": 2,
                    "text": "Moral virtue makes us aim at the right mark, while practical wisdom makes us take the right means.",
                    "evidence": self.evidence(
                        "S2",
                        "with moral virtue; for virtue makes us aim at the right mark, and practical wisdom makes us take the right means",
                    ),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(repeated_part), FakeResponse(corrected)],
        ) as mocked_urlopen:
            result = app.verify_answer(question, sources, "draft", "qwen3:4b", diagnostics)

        self.assertEqual(mocked_urlopen.call_count, 2)
        self.assertEqual([item["status"] for item in diagnostics["attempts"]], ["rejected", "accepted"])
        self.assertIn("Practical wisdom is the quality of mind", result)
        self.assertIn("right mark", result)
        self.assertIn("right means", result)
        retry_payload = json.loads(mocked_urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        self.assertIn("Return exactly one distinct answer item for each numbered question part", retry_payload["messages"][-1]["content"])
        self.assertNotIn("Fresh candidate to repair", retry_payload["messages"][-1]["content"])

    def test_multipart_fallback_keeps_an_individually_verified_part(self):
        """Show a supported answer part when another part cannot be verified."""
        question = (
            "What does Aristotle mean by practical wisdom, and how does it relate to moral virtue?"
        )
        sources = [
            {
                "source_id": "S1",
                "page": 71,
                "text": "Practical wisdom is the quality of mind concerned with things just and noble and good for man.",
            },
            {
                "source_id": "S2",
                "page": 72,
                "text": "Moral virtue and practical wisdom work together to guide action.",
            },
        ]
        partly_supported = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "question_part": 1,
                    "text": "Practical wisdom is the quality of mind concerned with things just and noble and good for man.",
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom is the quality of mind concerned with things just and noble and good for man",
                    ),
                },
                {
                    "question_part": 2,
                    "text": "Practical wisdom sets the end and moral virtue supplies the means.",
                    "evidence": self.evidence("S2", "Practical wisdom determines the end and moral virtue directs means"),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(partly_supported)] * 3,
        ):
            result = app.verify_answer(question, sources, "draft", "qwen3:4b", diagnostics)

        self.assertIn("Practical wisdom is the quality of mind", result)
        self.assertIn("[S1]", result)
        self.assertIn("couldn't verify the remaining part", result)
        self.assertEqual(diagnostics["status"], "partial")

    def test_single_question_fallback_recovers_a_supported_sentence_and_excerpt(self):
        """Keep one grounded statement when a sibling claim or quote fails."""
        source_text = (
            "Practical wisdom is the reasoned capacity to act with regard to things good or bad for man."
        )
        sources = [{"source_id": "S1", "page": 66, "text": source_text}]
        partly_supported = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Practical wisdom is the reasoned capacity to act with regard to things good or bad for man.",
                    # The first excerpt supports the sentence. A second bad
                    # excerpt makes the full item fail but should not erase the
                    # independently verifiable part during final recovery.
                    "evidence": [
                        *self.evidence("S1", "Practical wisdom is the reasoned capacity to act with regard to things good or bad for man"),
                        *self.evidence("S1", "this wording does not occur in the passage"),
                    ],
                },
                {
                    "text": (
                        "Practical wisdom is a reasoned capacity to act, because it guarantees "
                        "immortality through divine revelation."
                    ),
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom is the reasoned capacity to act",
                    ),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(partly_supported)] * 3,
        ):
            result = app.verify_answer(
                "What does Aristotle mean by practical wisdom?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertIn("Practical wisdom is the reasoned capacity", result)
        self.assertIn("[S1]", result)
        self.assertIn("couldn't verify the full answer", result)
        self.assertNotIn("immortality", result)
        self.assertEqual(diagnostics["status"], "partial")

    def test_argument_fallback_labels_a_verified_fragment_as_incomplete(self):
        """A sourced premise may help without masquerading as a full argument."""
        sources = [{
            "source_id": "S1",
            "page": 12,
            "text": "Happiness is an activity of the soul in accordance with perfect virtue.",
        }]
        failed_argument = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "role": "conclusion",
                    "text": "Happiness is an activity of the soul in accordance with perfect virtue.",
                    "evidence": self.evidence(
                        "S1", "Happiness is an activity of the soul in accordance with perfect virtue"
                    ),
                },
                {
                    "role": "reasoning",
                    "text": "Virtue is described as perfect.",
                    "evidence": self.evidence("S1", "in accordance with perfect virtue"),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(failed_argument)] * 3,
        ):
            result = app.verify_answer(
                "What is the highest good, and how does Aristotle argue for it?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertIn("Happiness is an activity of the soul", result)
        self.assertIn("not the complete argument", result)
        self.assertNotIn("highest human good is happiness", result)
        self.assertEqual(diagnostics["status"], "partial")

    def test_comparison_recovery_still_requires_both_sides_in_evidence(self):
        """Do not return a one-sided fact as a partial comparison answer."""
        sources = [{
            "source_id": "S1",
            "page": 66,
            "text": "Practical wisdom is a reasoned and true state of capacity to act with regard to human goods.",
        }]
        one_sided = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Practical wisdom is a reasoned and true state of capacity to act with regard to human goods.",
                "evidence": self.evidence(
                    "S1",
                    "Practical wisdom is a reasoned and true state of capacity to act with regard to human goods",
                ),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(one_sided)] * 3,
        ):
            result = app.verify_answer(
                "How does Aristotle distinguish practical wisdom from philosophic wisdom?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertIn("couldn't verify a reliable answer", result)
        self.assertEqual(diagnostics["status"], "fallback")

    def test_comparison_claim_failure_rebuilds_without_rejected_candidate(self):
        """A failed comparison should receive a source-only final repair."""
        sources = [
            {
                "source_id": "S1",
                "page": 66,
                "text": (
                    "For while making has an end other than itself, action cannot; for good action itself "
                    "is its end. Practical wisdom, then, "
                    "must be a reasoned and true state of capacity to act with regard to human goods."
                ),
            },
            {
                "source_id": "S3",
                "page": 68,
                "text": (
                    "Now practical wisdom is concerned with action; therefore one should have both forms "
                    "of it, or the latter in preference to the former."
                ),
            },
            {
                "source_id": "S2",
                "page": 71,
                "text": (
                    "For philosophic wisdom will contemplate none of the things that will make a man happy "
                    "(for it is not concerned with any coming into being), and though practical wisdom has "
                    "this merit, practical wisdom is concerned with things just and noble and good for man."
                ),
            },
            {
                "source_id": "S4",
                "page": 73,
                "text": (
                    "Virtues are forms of practical wisdom, and why Socrates in one respect was on the right "
                    "track while in another he went astray."
                ),
            },
        ]
        rejected = {"message": {"content": json.dumps({
            "sentences": [{
                "text": (
                    "Practical wisdom is concerned with action, while philosophical wisdom is discussed "
                    "alongside virtue."
                ),
                "evidence": [
                    {
                        "source_id": "S3",
                        "quote": "practical wisdom is concerned with action",
                    },
                    {
                        "source_id": "S4",
                        "quote": "virtues are forms of practical wisdom, and why Socrates in one respect "
                        "was on the right track while in another he went astray",
                    },
                ],
            }],
        })}}
        corrected = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "comparison_concept": "practical wisdom",
                    "text": "Practical wisdom is a reasoned capacity to act for human goods.",
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom, then, must be a reasoned and true state of capacity to act with regard to human goods",
                    ),
                },
                {
                    "comparison_concept": "philosophic wisdom",
                    "text": "Philosophic wisdom is not concerned with any coming into being.",
                    "evidence": self.evidence(
                        "S2",
                        "philosophic wisdom will contemplate none of the things that will make a man happy "
                        "(for it is not concerned with any coming into being)",
                    ),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(rejected), FakeResponse(rejected), FakeResponse(corrected)],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "How does Aristotle distinguish practical wisdom from philosophic wisdom?",
                sources,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(
            result,
            "Practical wisdom is a reasoned capacity to act for human goods [S1]. "
            "Philosophic wisdom is not concerned with any coming into being [S2].",
        )
        self.assertEqual([entry["status"] for entry in diagnostics["attempts"]], [
            "rejected", "rejected", "accepted",
        ])
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        self.assertIn("Prefer the author's terms", repair_prompt)
        self.assertIn("comparison_concept: one for practical wisdom", repair_prompt)
        self.assertIn("one for philosophic wisdom", repair_prompt)
        self.assertIn("abstract", repair_prompt)
        self.assertNotIn("Fresh candidate to repair", repair_prompt)
        self.assertNotIn("theoretical knowledge", repair_prompt)
        schema_item = repair_payload["format"]["properties"]["sentences"]["items"]
        self.assertEqual(schema_item["properties"]["comparison_concept"]["enum"], ["practical wisdom", "philosophic wisdom"])

    def test_comparison_items_keep_each_concepts_claim_and_evidence_together(self):
        """Comparison claims and each exact excerpt stay bound to one side."""
        question = "How does Aristotle distinguish practical wisdom from philosophic wisdom?"
        valid_items = [
            {
                "comparison_concept": "practical wisdom",
                "text": "Practical wisdom is concerned with action.",
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action"),
            },
            {
                "comparison_concept": "philosophic wisdom",
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S2", "philosophic wisdom concerns the highest objects"),
            },
        ]
        self.assertIsNone(app.comparison_evidence_issue(question, valid_items))
        # The named slot, rather than an ambiguous ordinal, keeps the correct
        # claim attached to its concept even if the model emits the two items
        # in reverse order.
        self.assertIsNone(app.comparison_evidence_issue(question, list(reversed(valid_items))))

        borrowed_evidence = [
            valid_items[0],
            {
                "comparison_concept": "philosophic wisdom",
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action"),
            },
        ]
        issue = app.comparison_evidence_issue(question, borrowed_evidence)
        self.assertIn("comparison item 2", issue)
        self.assertIn("philosophic wisdom", issue)

        # A sentence that discusses both ideas still mixes their properties,
        # even when the model attaches the sentence to just one side and
        # supplies quotes containing words from both ideas.
        mixed_claim = [
            {
                "comparison_concept": "practical wisdom",
                "text": (
                    "Practical wisdom concerns action, while philosophic wisdom concerns "
                    "the highest objects."
                ),
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action")
                + self.evidence("S2", "philosophic wisdom concerns the highest objects"),
            },
            valid_items[1],
        ]
        issue = app.comparison_evidence_issue(question, mixed_claim)
        self.assertIn("explicit distinction phrase", issue)

        # A short relational cross-reference can keep the distinction clear
        # without moving the second concept's properties into this item. Both
        # sides remain separately assigned and must still have their own
        # directly named evidence.
        relational_reference = [
            {
                "comparison_concept": "practical wisdom",
                "text": (
                    "Practical wisdom is a reasoned capacity to act with regard to human goods, "
                    "distinct from philosophic wisdom."
                ),
                "evidence": self.evidence(
                    "S1",
                    "Practical wisdom is a reasoned and true state of capacity to act with regard to human goods",
                ),
            },
            {
                "comparison_concept": "philosophic wisdom",
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S2", "philosophic wisdom concerns the highest objects"),
            },
        ]
        self.assertIsNone(app.comparison_evidence_issue(question, relational_reference))

        # A passage can name an idea in one excerpt and describe a distinct
        # property nearby in another. Build 62 keeps that useful pattern when
        # the property excerpt independently carries the claim wording.
        split_but_supported = [
            valid_items[0],
            {
                "comparison_concept": "philosophic wisdom",
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S2", "philosophic wisdom is distinct from the art of politics")
                + self.evidence("S3", "Of the highest objects, we say"),
            },
        ]
        self.assertIsNone(app.comparison_evidence_issue(question, split_but_supported))

        # But merely joining the vocabulary of a concept-naming excerpt and an
        # unrelated excerpt must not cover a broader attribute claim.
        pooled_quotes = [
            {
                "comparison_concept": "practical wisdom",
                "text": (
                    "Practical wisdom concerns variable human actions and individual matters."
                ),
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action")
                + self.evidence("S3", "Scientific knowledge is universal and necessary"),
            },
            valid_items[1],
        ]
        issue = app.comparison_evidence_issue(question, pooled_quotes)
        self.assertIn("any one exact excerpt", issue)

        # This reproduces Build 60's accepted Qwen wording: the exact quote
        # names philosophic wisdom but says first principles are *not* its
        # objects. Its other wording about universal and necessary truths is
        # chiefly drawn from a nearby statement about scientific knowledge.
        misattributed_property = [
            valid_items[0],
            {
                "comparison_concept": "philosophic wisdom",
                "text": (
                    "Philosophic wisdom focuses on universal principles and necessary truths "
                    "that can be demonstrated, as it is the mark of the philosopher to have "
                    "demonstration about some things."
                ),
                "evidence": self.evidence(
                    "S3",
                    "Nor are these first principles the objects of philosophic wisdom, for it is a mark "
                    "of the philosopher to have demonstration about some things",
                ),
            },
        ]
        issue = app.comparison_evidence_issue(question, misattributed_property)
        self.assertIn("any one exact excerpt", issue)

    def test_evidence_check_retries_once_after_an_invalid_excerpt(self):
        """A first bad quote gets one repair attempt before the safe fallback."""
        invalid = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is a good activity of the soul.",
                "evidence": self.evidence("S2", "Happiness is a good activity of the soul"),
            }],
        })}}
        valid = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is activity of the soul.",
                "evidence": self.evidence("S2", "activity of soul in accordance with perfect virtue"),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(invalid), FakeResponse(valid)],
        ) as mock_urlopen:
            result = app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b", diagnostics)
        self.assertEqual(result, "Happiness is activity of the soul [S2].")
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual([entry["status"] for entry in diagnostics["attempts"]], ["rejected", "accepted"])
        self.assertEqual(diagnostics["status"], "verified")

    def test_evidence_checker_prompt_consolidates_repeated_points(self):
        """Ask the checker to merge paraphrases instead of echoing one fact."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Virtue is activity of the soul.", "evidence": self.evidence("S2", "activity of soul in accordance with perfect virtue")}],
        })}}
        captured = {}

        def capture_request(request, timeout):
            # Inspect the prompt without depending on a live local model.
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(payload)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            app.verify_answer("How does virtue relate to habit?", self.sources, "draft", "qwen3:4b")

        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("state the same claim in different words", system_prompt)
        self.assertIn("distinct, useful qualification", system_prompt)

    def test_answer_prompt_tracks_who_holds_each_view(self):
        """Give the drafting pass the same attribution rule as the checker."""
        payload = {"message": {"content": json.dumps({"answer": "A short answer [S1]."})}}
        captured = {}

        def capture_request(request, timeout):
            # Keep model calls mocked; the assertion is about prompt construction.
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(payload)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            app.call_ollama("What is happiness?", self.sources, [], "qwen3:4b")

        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("Track who holds each view", system_prompt)
        self.assertIn("do not attribute the reported position to the author", system_prompt)
        self.assertIn("do not swap roles such as end and means", system_prompt)
        self.assertIn("Answer every part of a multi-part question", system_prompt)
        self.assertIn("summarize the distinct aspects the passages support", system_prompt)
        self.assertIn("Do not claim that the book never discusses a requested subject", system_prompt)
        self.assertIn("careful reading companion for", system_prompt)
        self.assertIn("keep each view attached to the person who advances it", system_prompt)
        self.assertIn("Never transfer an argument from one thinker to another", system_prompt)
        self.assertIn("Keep each property attached to the grammatical subject", system_prompt)
        self.assertIn("explain the reasoning chain", system_prompt)
        self.assertIn("relevant starting point or premises", system_prompt)
        self.assertIn('<passage source_id="S1" page="123"', captured["payload"]["messages"][-1]["content"])
        self.assertIn("TEXT: Human contemplation needs external prosperity", captured["payload"]["messages"][-1]["content"])
        self.assertEqual(captured["payload"]["options"]["temperature"], 0)

    def test_evidence_check_rejects_missing_citations(self):
        """A structured answer with no source IDs must not be shown as grounded."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Happiness is activity.", "evidence": []}],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b")
        self.assertTrue(result.startswith("I couldn't verify"))

    def test_evidence_check_rejects_overbroad_citation_lists(self):
        """Reject a sentence that cites more passages than the app's evidence cap."""
        sources = self.sources + [{"source_id": "S3", "page": 25, "text": "A third passage."}]
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is activity of the soul.",
                "evidence": [
                    {"source_id": "S1", "quote": "external prosperity, a healthy body, food"},
                    {"source_id": "S2", "quote": "activity of soul in accordance with perfect virtue"},
                    {"source_id": "S3", "quote": "third passage"},
                ],
            }],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is happiness?", sources, "draft", "qwen3:4b")
        self.assertTrue(result.startswith("I couldn't verify"))

    def test_evidence_check_formats_structured_source_ids(self):
        """The app, rather than the model, places the final citation marker."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is activity of the soul.",
                "evidence": self.evidence("S2", "activity of soul in accordance with perfect virtue"),
            }],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b")
        self.assertEqual(result, "Happiness is activity of the soul [S2].")

    def test_evidence_check_rejects_a_question_echo_and_retries(self):
        """A cited copy of the prompt is still not a user-facing answer."""
        echoed_question = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "What is happiness?",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue"
                ),
            }],
        })}}
        answer = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is activity of soul.",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue"
                ),
            }],
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(echoed_question), FakeResponse(answer)],
        ) as mock_urlopen:
            result = app.verify_answer(
                "What is happiness?", self.sources, "draft", "llama3.2:3b", diagnostics
            )

        self.assertEqual(result, "Happiness is activity of soul [S2].")
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertEqual(
            [attempt["status"] for attempt in diagnostics["attempts"]],
            ["rejected", "accepted"],
        )
        self.assertIn("repeated a question", diagnostics["attempts"][0]["reason"])

    def test_one_source_can_support_a_claim_with_two_distinct_excerpts(self):
        """A short quote need not omit one side of a linked definition."""
        source = [{
            "source_id": "S1",
            "page": 2,
            "text": (
                "This is the highest of all goods achievable by action. "
                "Many people say that it is happiness."
            ),
        }]
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is the highest human good.",
                "evidence": [
                    {"source_id": "S1", "quote": "highest of all goods achievable by action"},
                    {"source_id": "S1", "quote": "say that it is happiness"},
                ],
            }],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is the highest good?", source, "draft", "qwen3:4b")

        self.assertEqual(result, "Happiness is the highest human good [S1].")

    def test_author_hypothetical_answers_are_labeled_as_inference(self):
        """Add an inference label when a model states an author's hypothetical view."""
        source = {
            "source_id": "S2",
            "page": 12,
            "text": "Children need guidance as they learn to choose well.",
        }
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Aristotle would say children need guidance.",
                "evidence": self.evidence("S2", "Children need guidance as they"),
            }],
        })}}
        question = "What would Aristotle say about raising children?"
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer(question, [source], "draft", "qwen3:4b")
        self.assertEqual(
            result,
            "As an inference from the cited ideas: Aristotle would say children need guidance [S2].",
        )

    def test_evidence_check_adds_sentence_punctuation(self):
        """Ensure fragments from the checker become readable finished sentences."""
        self.assertEqual(
            app.format_cited_sentences(
                [{"text": "Happiness is activity", "evidence": self.evidence("S2", "Happiness is an activity of soul")}],
                self.sources,
            ),
            "Happiness is activity [S2].",
        )

    def test_evidence_check_capitalizes_sentence_text(self):
        """Repair lower-case sentence starts without changing citation assignment."""
        source = [{
            "source_id": "S1",
            "page": 8,
            "text": "Moral virtue comes from habit and practice.",
        }]
        self.assertEqual(
            app.format_cited_sentences(
                [{"text": "moral virtue comes from habit", "evidence": self.evidence("S1", "Moral virtue comes from habit")}],
                source,
            ),
            "Moral virtue comes from habit [S1].",
        )

    def test_inline_citation_attribution_does_not_leave_broken_prose(self):
        """Remove an attribution wrapper before the app adds its own citation."""
        source = [{
            "source_id": "S1",
            "page": 8,
            "text": "Virtue is a state of character.",
        }]
        result = app.format_cited_sentences(
            [{
                "text": "According to [S1], virtue is a state of character.",
                "evidence": self.evidence("S1", "Virtue is a state of character"),
            }],
            source,
        )

        # Without the cleanup, removing [S1] leaves "According to ," in the
        # browser. The citation is then reattached in the app-controlled spot.
        self.assertEqual(result, "Virtue is a state of character [S1].")

    def test_simple_answer_is_limited_to_two_unique_sentences(self):
        """Enforce the concise-answer cap and remove exact repeated sentences."""
        source = [{
            "source_id": "S1",
            "page": 8,
            "text": "Virtue is a state of character. It lies in a mean.",
        }]
        result = app.format_cited_sentences(
            [
                {
                    "text": "Virtue is a state of character. Virtue is a state of character.",
                    "evidence": self.evidence("S1", "Virtue is a state of character"),
                },
                {
                    "text": "It lies in a mean.",
                    "evidence": self.evidence("S1", "It lies in a mean"),
                },
                {
                    "text": "A further detail.",
                    "evidence": self.evidence("S1", "Virtue is a state of character"),
                },
            ],
            source,
            max_sentences=2,
        )
        self.assertEqual(result, "Virtue is a state of character [S1]. It lies in a mean [S1].")

    def test_simple_question_detection_preserves_explanation_requests(self):
        """Short factual prompts are concise; explicit how-questions can expand."""
        self.assertTrue(app.is_simple_question("What does Aristotle mean by happiness?"))
        self.assertFalse(app.is_simple_question("How does virtue relate to habit?"))
        self.assertTrue(app.expects_explanatory_answer("What does Aristotle mean by practical wisdom?"))
        self.assertFalse(app.requires_multiple_explanatory_points(
            "What does Aristotle mean by practical wisdom?"
        ))
        self.assertTrue(app.expects_explanatory_answer("How does virtue relate to habit?"))
        self.assertTrue(app.requires_multiple_explanatory_points("How does virtue relate to habit?"))
        self.assertFalse(app.expects_explanatory_answer("How many virtues are there?"))
        self.assertIsNone(app.explanatory_depth_issue(
            "What does Aristotle mean by practical wisdom?",
            "Practical wisdom is a reasoned capacity to act with regard to human goods [S1].",
        ))
        self.assertIsNotNone(app.explanatory_depth_issue(
            "How does virtue relate to habit?", "Virtue is connected with habit [S1]."
        ))
        self.assertIsNone(app.explanatory_depth_issue(
            "How does virtue relate to habit?",
            "Virtue is formed through habit [S1]. Repeated actions establish a stable state [S2].",
        ))

    def test_checker_retries_a_vague_one_sentence_explanation(self):
        """Do not let evidence review erase the requested relation mechanism."""
        question = "How do moral virtue and practical wisdom work together?"
        source = [{
            "source_id": "S1",
            "page": 72,
            "text": (
                "Moral virtue and practical wisdom work together to guide action. "
                "Moral virtue makes us aim at the right mark, while practical wisdom "
                "makes us take the right means."
            ),
        }]
        too_short = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Moral virtue and practical wisdom work together to guide action.",
                "evidence": self.evidence(
                    "S1", "Moral virtue and practical wisdom work together to guide action"
                ),
            }],
        })}}
        explanatory = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Moral virtue and practical wisdom work together to guide action.",
                    "evidence": self.evidence(
                        "S1", "Moral virtue and practical wisdom work together to guide action"
                    ),
                },
                {
                    "text": (
                        "Moral virtue makes us aim at the right mark, while practical wisdom "
                        "makes us take the right means."
                    ),
                    "evidence": self.evidence(
                        "S1", "Moral virtue makes us aim at the right mark, while practical wisdom makes us take the right means"
                    ),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(too_short), FakeResponse(explanatory)],
        ) as mocked_urlopen:
            answer = app.verify_answer(question, source, "draft", "llama3.2:3b", diagnostics)

        self.assertEqual(mocked_urlopen.call_count, 2)
        self.assertEqual([item["status"] for item in diagnostics["attempts"]], ["rejected", "accepted"])
        self.assertIn("right mark", answer)
        self.assertIn("right means", answer)

    def test_author_inference_detection_is_not_book_specific(self):
        """Recognize hypothetical author questions without hardcoding Aristotle."""
        self.assertTrue(app.asks_for_author_inference("What would Plato think about AI?"))
        self.assertFalse(app.asks_for_author_inference("How does Aristotle define virtue?"))
        self.assertEqual(
            app.author_inference_topic_terms("What would Aristotle think about Christianity?"),
            {"christianity"},
        )

    def test_author_inference_cannot_recover_a_judgment_about_an_uncited_topic(self):
        """Do not infer a view about an absent topic from a merely adjacent passage."""
        question = "What would Aristotle think about Christianity?"
        source = [{
            "source_id": "S1",
            "page": 44,
            "text": (
                "We blame both the ambitious man at honor more than is right and from wrong sources, "
                "and the unambitious man as not willing to be honored even for noble reasons."
            ),
        }]
        unsupported_inference = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Aristotle would not consider Christianity a virtue in the context of honor.",
                "evidence": self.evidence(
                    "S1",
                    "We blame both the ambitious man at honor more than is right and from wrong sources, "
                    "and the unambitious man as not willing to be honored even for noble reasons",
                ),
            }],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[
                FakeResponse(unsupported_inference),
                FakeResponse(unsupported_inference),
                FakeResponse(unsupported_inference),
            ],
        ) as mocked_urlopen:
            answer = app.verify_answer(
                question,
                source,
                "draft",
                "qwen3:4b",
                diagnostics,
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertNotIn("Christianity", answer)
        self.assertIn("couldn't verify", answer)
        self.assertEqual(diagnostics["status"], "fallback")
        self.assertTrue(any(
            "requested hypothetical topic" in issue
            for issue in diagnostics["attempts"][0]["issues"]
        ))

    def test_only_sources_cited_in_answer_are_returned_to_the_ui(self):
        """Keep the clickable source list aligned with visible answer citations."""
        cited = app.sources_cited_by_answer("The claim is supported [S2].", self.sources)
        self.assertEqual([source["source_id"] for source in cited], ["S2"])


class InterfaceTests(unittest.TestCase):
    """Protect the paired regression runner and its fixed prompt set."""

    def test_batch_runner_uses_core_prompts_and_collects_full_chat_diagnostics(self):
        html = (APP_PATH.parent / "index.html").read_text(encoding="utf-8")

        self.assertEqual(html.count('<button type="button">'), 5)
        self.assertIn("How does habituation help someone become virtuous?", html)
        self.assertIn("What does Aristotle think about God and the soul?", html)
        self.assertIn("Run all five questions", html)
        self.assertIn('id="run-regression"', html)
        self.assertIn('id="download-regression"', html)
        self.assertIn("fetch('/api/chat'", html)
        self.assertIn("history:[], model, diagnostics:true", html)
        self.assertIn("latestRegressionReport", html)
        self.assertIn("downloadRegressionReport", html)
        self.assertIn('id="batch-results"', html)
        self.assertIn("Results by model and question", html)
        self.assertIn("schema_version:2", html)
        self.assertIn("entry.summary = data.diagnostics?.summary", html)


if __name__ == "__main__":
    unittest.main()
