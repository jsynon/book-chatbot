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

    def test_opt_in_diagnostic_source_list_preserves_rank_and_passage_text(self):
        """The troubleshooting view must expose the exact evidence candidates."""
        sources = [{"source_id": "S1", "page": 72, "score": 12.5, "text": "Virtue aims at the right mark."}]
        self.assertEqual(app.diagnostic_source_list(sources), [{
            "source_id": "S1", "page": 72, "score": 12.5, "text": "Virtue aims at the right mark."
        }])


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
        long_quote = " ".join(f"long{index}" for index in range(41))
        self.assertFalse(app.evidence_quote_matches(long_quote, long_quote))

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
                    "virtue makes us aim at the right mark, and practical wisdom makes us take the right means",
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
        self.assertIn("the passage that explicitly establishes those roles", system_prompt)
        self.assertIn("short, exact, continuous quotation", system_prompt)
        self.assertIn("3 to 40 words", system_prompt)
        self.assertIn("Split a sentence that combines separate factual claims", system_prompt)
        self.assertIn("direction of any relationship", system_prompt)
        self.assertIn("Keep that inference modest", system_prompt)
        self.assertIn("do not invent claims about modern society", system_prompt)
        self.assertIn("who advances each argument and who evaluates or rejects it", system_prompt)
        self.assertIn("do not transfer an argument across adjacent sentences", system_prompt)
        self.assertIn("same source_id may appear twice", system_prompt)
        self.assertIn('"quote"', json.dumps(captured["payload"]["format"]))

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
        self.assertIn("maximum 40", diagnostics["attempts"][0]["reason"])
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

    def test_validator_collects_quote_errors_from_all_answer_items(self):
        """A first oversized quote must not hide a later item's failure."""
        sources = [
            {
                "source_id": "S1",
                "page": 1,
                "text": " ".join(f"alpha{index}" for index in range(45)),
            },
            {
                "source_id": "S2",
                "page": 2,
                "text": " ".join(f"beta{index}" for index in range(45)),
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
        self.assertTrue(all("maximum 40" in issue for issue in issues))

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
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        self.assertIn("Fresh candidate to repair", repair_prompt)
        self.assertIn("answer item 1, evidence 1", repair_prompt)
        self.assertIn("answer item 2, evidence 1", repair_prompt)
        self.assertIn("maximum 40", repair_prompt)
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
            "sentences": [
                {
                    "role": "conclusion",
                    "text": "Aristotle identifies happiness as the highest good achievable by action.",
                    "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
                },
                {
                    "role": "premise",
                    "text": "The human function is activity of soul implying a rational principle.",
                    "evidence": self.evidence(
                        "S7", "function of man is activity of soul implying a rational principle"
                    ),
                },
                {
                    "role": "reasoning",
                    "text": "Human good is activity of soul in accordance with virtue.",
                    "evidence": self.evidence("S7", "human good turns out to be activity of soul in accordance with virtue"),
                },
            ],
        })}}
        reasoned_answer = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "role": "conclusion",
                    "text": "Aristotle identifies happiness as the highest good achievable by action.",
                    "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
                },
                {
                    "role": "premise",
                    "text": "The human function is activity of soul implying a rational principle.",
                    "evidence": self.evidence(
                        "S7", "function of man is activity of soul implying a rational principle"
                    ),
                },
                {
                    "role": "reasoning",
                    "text": (
                        "Since a function is well performed in accordance with appropriate excellence, "
                        "human good is activity of soul in accordance with virtue."
                    ),
                    "evidence": self.evidence(
                        "S7",
                        "If an action is well performed in accordance with appropriate excellence, human good "
                        "turns out to be activity of soul in accordance with virtue",
                    ),
                },
            ],
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
        self.assertIn("reasoning component", diagnostics["attempts"][0]["reason"])
        self.assertEqual(diagnostics["attempts"][1]["status"], "rejected")
        self.assertEqual(diagnostics["attempts"][2]["status"], "accepted")
        self.assertIn("human function", result)
        self.assertIn("Since", result)
        repair_payload = json.loads(mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8"))
        repair_prompt = repair_payload["messages"][-1]["content"]
        initial_payload = json.loads(mocked_urlopen.call_args_list[0].args[0].data.decode("utf-8"))
        self.assertEqual(initial_payload["format"]["properties"]["sentences"]["minItems"], 3)
        self.assertEqual(initial_payload["format"]["properties"]["sentences"]["maxItems"], 3)
        self.assertIn("exactly three separate answer items", repair_prompt)
        self.assertIn("Start over from the passages below", repair_prompt)
        self.assertIn("premise item states a starting point", repair_prompt)
        self.assertNotIn("Fresh candidate to repair", repair_prompt)
        self.assertNotIn("Aristotle identifies happiness as the highest good achievable by action", repair_prompt)

    def test_argument_premise_and_reasoning_need_shared_evidence_and_concepts(self):
        """A causal word cannot join unrelated cited passages into an argument."""
        question = "What is the highest good, and how does Aristotle argue for it?"
        answer = (
            "The highest human good is happiness. The general run of men identifies living well with being happy. "
            "The author argues that happiness is the highest good because it is the end of human action."
        )
        items = [
            {"role": "conclusion", "text": "The highest human good is happiness.", "evidence": self.evidence("S1", "highest good")},
            {"role": "premise", "text": "The general run of men identifies living well with being happy.", "evidence": self.evidence("S1", "general run of men identify living well and doing well with being happy")},
            {"role": "reasoning", "text": "The author argues that happiness is the highest good because it is the end of human action.", "evidence": self.evidence("S6", "happiness as a sort of good life and good action")},
        ]

        issue = app.argument_coverage_issue(question, answer, items)
        self.assertIn("common passage", issue)

        # Even when both components cite the same passage, unrelated wording
        # should not qualify as a textual connection between premise and step.
        items[2]["evidence"] = self.evidence(
            "S1", "general agreement say that it is happiness and identify living well and doing well"
        )
        items[2]["text"] = "Since the many people agree, Aristotle describes a different argument about virtue."
        answer = answer.rsplit(" ", 1)[0] + " virtue."
        issue = app.argument_coverage_issue(question, answer, items)
        self.assertIn("reuse at least two key concepts", issue)

    def test_argument_claim_with_missing_evidence_is_rebuilt_without_candidate(self):
        """Rebuild an unsupported argument claim instead of anchoring final repair to it."""
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
                    "role": "premise",
                    "text": "The human function is activity of soul implying a rational principle.",
                    "evidence": self.evidence(
                        "S7", "function of man is activity of soul implying a rational principle"
                    ),
                },
                {
                    "role": "reasoning",
                    "text": (
                        "He argues that happiness is achieved through a life of virtue, which requires both "
                        "moral excellence and practical wisdom."
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
                    "role": "premise",
                    "text": "The human function is activity of soul implying a rational principle.",
                    "evidence": self.evidence(
                        "S7", "function of man is activity of soul implying a rational principle"
                    ),
                },
                {
                    "role": "reasoning",
                    "text": (
                        "Since a good function is performed in accordance with appropriate excellence, "
                        "human good is activity of soul in accordance with virtue."
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
        self.assertIn("human function", result)
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
                    "text": "The highest human good is happiness.",
                    "evidence": self.evidence("S1", "Happiness is an activity of the soul"),
                },
                {
                    "role": "premise",
                    "text": "Happiness is an activity of the soul in accordance with perfect virtue.",
                    "evidence": self.evidence(
                        "S1",
                        "Happiness is an activity of the soul in accordance with perfect virtue",
                    ),
                },
                {
                    "role": "reasoning",
                    "text": "Therefore this proves the highest human good.",
                    "evidence": self.evidence("S1", "Happiness is an activity of the soul"),
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
                    "comparison_side": 1,
                    "text": "Practical wisdom is a reasoned capacity to act for human goods.",
                    "evidence": self.evidence(
                        "S1",
                        "Practical wisdom, then, must be a reasoned and true state of capacity to act with regard to human goods",
                    ),
                },
                {
                    "comparison_side": 2,
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
        self.assertIn("comparison_side 1 describes practical wisdom", repair_prompt)
        self.assertIn("comparison_side 2 describes philosophic wisdom", repair_prompt)
        self.assertIn("abstract", repair_prompt)
        self.assertNotIn("Fresh candidate to repair", repair_prompt)
        self.assertNotIn("theoretical knowledge", repair_prompt)
        schema_item = repair_payload["format"]["properties"]["sentences"]["items"]
        self.assertEqual(schema_item["properties"]["comparison_side"]["enum"], [1, 2])

    def test_comparison_items_keep_each_concepts_claim_and_evidence_together(self):
        """One concept's excerpt cannot supply the other concept's evidence."""
        question = "How does Aristotle distinguish practical wisdom from philosophic wisdom?"
        valid_items = [
            {
                "comparison_side": 1,
                "text": "Practical wisdom is concerned with action.",
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action"),
            },
            {
                "comparison_side": 2,
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S2", "philosophic wisdom concerns the highest objects"),
            },
        ]
        self.assertIsNone(app.comparison_evidence_issue(question, valid_items))

        borrowed_evidence = [
            valid_items[0],
            {
                "comparison_side": 2,
                "text": "Philosophic wisdom concerns the highest objects.",
                "evidence": self.evidence("S1", "Practical wisdom is concerned with action"),
            },
        ]
        issue = app.comparison_evidence_issue(question, borrowed_evidence)
        self.assertIn("comparison item 2", issue)
        self.assertIn("philosophic wisdom", issue)

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
        self.assertIn("keep each view attached to the person who advances it", system_prompt)
        self.assertIn("Never transfer an argument from one thinker to another", system_prompt)
        self.assertIn("explain the reasoning chain", system_prompt)
        self.assertIn("relevant starting point or premises", system_prompt)
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

    def test_only_sources_cited_in_answer_are_returned_to_the_ui(self):
        """Keep the clickable source list aligned with visible answer citations."""
        cited = app.sources_cited_by_answer("The claim is supported [S2].", self.sources)
        self.assertEqual([source["source_id"] for source in cited], ["S2"])


class InterfaceTests(unittest.TestCase):
    """Protect the paired regression runner and its fixed prompt set."""

    def test_batch_runner_uses_core_prompts_and_collects_full_chat_diagnostics(self):
        html = (APP_PATH.parent / "index.html").read_text(encoding="utf-8")

        self.assertEqual(html.count('<button type="button">'), 3)
        self.assertIn('id="run-regression"', html)
        self.assertIn('id="download-regression"', html)
        self.assertIn("fetch('/api/chat'", html)
        self.assertIn("history:[], model, diagnostics:true", html)
        self.assertIn("latestRegressionReport", html)
        self.assertIn("downloadRegressionReport", html)


if __name__ == "__main__":
    unittest.main()
