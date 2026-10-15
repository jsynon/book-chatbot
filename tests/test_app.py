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
                    "source_ids": ["S2"],
                },
                {
                    "text": "He also says human contemplation needs external goods such as food and care.",
                    "source_ids": ["S1"],
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
            "sentences": [{"text": "The passage presents a reported view.", "source_ids": ["S2"]}],
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

    def test_evidence_checker_prompt_consolidates_repeated_points(self):
        """Ask the checker to merge paraphrases instead of echoing one fact."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Moral virtue comes from habit.", "source_ids": ["S2"]}],
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

    def test_evidence_check_rejects_missing_citations(self):
        """A structured answer with no source IDs must not be shown as grounded."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{"text": "Happiness is activity.", "source_ids": []}],
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
                "source_ids": ["S1", "S2", "S3"],
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
                "source_ids": ["S2"],
            }],
        })}}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer("What is happiness?", self.sources, "draft", "qwen3:4b")
        self.assertEqual(result, "Happiness is activity of the soul [S2].")

    def test_author_hypothetical_answers_are_labeled_as_inference(self):
        """Add an inference label when a model states an author's hypothetical view."""
        payload = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Aristotle would say children need guidance.",
                "source_ids": ["S2"],
            }],
        })}}
        question = "What would Aristotle say about raising children?"
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            result = app.verify_answer(question, self.sources, "draft", "qwen3:4b")
        self.assertEqual(
            result,
            "As an inference from the cited ideas: Aristotle would say children need guidance [S2].",
        )

    def test_evidence_check_adds_sentence_punctuation(self):
        """Ensure fragments from the checker become readable finished sentences."""
        self.assertEqual(
            app.format_cited_sentences(
                [{"text": "Happiness is activity", "source_ids": ["S2"]}],
                self.sources,
            ),
            "Happiness is activity [S2].",
        )

    def test_evidence_check_capitalizes_sentence_text(self):
        """Repair lower-case sentence starts without changing citation assignment."""
        self.assertEqual(
            app.format_cited_sentences(
                [{"text": "moral virtue comes from habit", "source_ids": ["S1"]}],
                self.sources,
            ),
            "Moral virtue comes from habit [S1].",
        )

    def test_simple_answer_is_limited_to_two_unique_sentences(self):
        """Enforce the concise-answer cap and remove exact repeated sentences."""
        result = app.format_cited_sentences(
            [{
                "text": "Virtue is a state of character. Virtue is a state of character. "
                "It lies in a mean. A further detail.",
                "source_ids": ["S1"],
            }],
            self.sources,
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
