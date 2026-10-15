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

    def test_weak_lexical_match_triggers_query_expansion(self):
        """Verify expansion supplies search terms only and improves retrieval."""
        question = "What does Aristotle say about raising children?"
        initial = app.retrieve(question, [])
        self.assertTrue(app.query_needs_expansion(question, initial))

        payload = {"message": {"content": json.dumps({"search_terms": ["nurture", "education of the young"]})}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            terms = app.expand_query(question, [], "qwen3:4b")
        self.assertIn("nurture", terms)
        expanded = app.retrieve(question, [], search_terms=terms)
        self.assertEqual(expanded[0]["page"], 125)

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
        long_quote = (
            "Human contemplation needs external prosperity, a healthy body, food, and other care, "
            "and a solitary person without friends is not likely to be happy."
        )
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
            result = app.verify_answer("What is happiness?", source, "draft", "qwen3:4b", diagnostics)

        self.assertEqual(result, "Happiness is activity of the soul in accordance with virtue [S1].")
        self.assertEqual(diagnostics["attempts"][0]["status"], "rejected")
        self.assertIn("key terms absent", diagnostics["attempts"][0]["reason"])
        self.assertIn("missing wording includes", diagnostics["attempts"][0]["reason"])
        self.assertIn("practical", diagnostics["attempts"][0]["reason"])
        self.assertIn("wisdom", diagnostics["attempts"][0]["reason"])
        # The retry should see the actual gap so it can remove the unsupported
        # add-on instead of making another generic attempt at the same claim.
        retry_payload = json.loads(mocked_urlopen.call_args_list[1].args[0].data.decode("utf-8"))
        retry_instruction = retry_payload["messages"][-1]["content"]
        self.assertIn("missing wording includes", retry_instruction)
        self.assertIn("practical", retry_instruction)
        self.assertIn("wisdom", retry_instruction)
        self.assertEqual(diagnostics["attempts"][1]["status"], "accepted")

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
        self.assertIn("the passage that explicitly establishes those roles", system_prompt)
        self.assertIn("short, exact, continuous quotation", system_prompt)
        self.assertIn("3 to 18 words", system_prompt)
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
        self.assertEqual(diagnostics["attempts"][0]["reason"], "the quoted excerpt for S2 was too short or not an exact passage match")
        self.assertIn("checker_sentences", diagnostics["attempts"][0])

    def test_evidence_check_rejects_a_long_quote_even_when_it_matches(self):
        """A long passage cannot obscure which short phrase supports a claim."""
        quote = (
            "Human contemplation needs external prosperity, a healthy body, food, and other care, "
            "and a solitary person without friends is not likely to be happy."
        )
        source = {"source_id": "S1", "page": 123, "text": quote}
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Human happiness needs many different conditions.", "evidence": self.evidence("S1", quote)}],
        })}}
        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What does happiness need?", [source], "draft", "qwen3:4b", diagnostics)
        self.assertTrue(result.startswith("I couldn't verify"))
        self.assertIn("maximum 18", diagnostics["attempts"][0]["reason"])

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

    def test_author_inference_detection_is_not_book_specific(self):
        """Recognize hypothetical author questions without hardcoding Aristotle."""
        self.assertTrue(app.asks_for_author_inference("What would Plato think about AI?"))
        self.assertFalse(app.asks_for_author_inference("How does Aristotle define virtue?"))

    def test_only_sources_cited_in_answer_are_returned_to_the_ui(self):
        """Keep the clickable source list aligned with visible answer citations."""
        cited = app.sources_cited_by_answer("The claim is supported [S2].", self.sources)
        self.assertEqual([source["source_id"] for source in cited], ["S2"])


if __name__ == "__main__":
    unittest.main()
