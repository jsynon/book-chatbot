Warning: truncated output (original token count: 66998)
Total output lines: 5558

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

    def test_shared_corpus_resolver_accepts_another_catalog_id(self):
        """Resolve a non-pilot book shard through configuration, not code edits."""
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "book-chatbot"
            library = pathlib.Path(temporary) / "antilogicalism-library-data"
            alternate_shard = library / "data-v48" / "book-42.json.gz"
            alternate_shard.parent.mkdir(parents=True)
            alternate_shard.touch()

            resolved = app.resolve_book_file(root, {
                "BOOK_CHATBOT_LIBRARY_DATA": str(library),
                "BOOK_CHATBOT_DATA_VERSION": "v48",
                "BOOK_CHATBOT_BOOK_ID": "42",
            })

        self.assertEqual(resolved, alternate_shard)

    def test_alternate_catalog_id_uses_the_matching_local_fallback(self):
        """Keep alternate shard selection consistent in standalone test folders."""
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "book-chatbot"
            fallback = root / "data" / "book-42.json.gz"
            fallback.parent.mkdir(parents=True)
            fallback.touch()

            resolved = app.resolve_book_file(root, {
                "BOOK_CHATBOT_LIBRARY_DATA": str(pathlib.Path(temporary) / "missing-library"),
                "BOOK_CHATBOT_DATA_VERSION": "v48",
                "BOOK_CHATBOT_BOOK_ID": "42",
            })

        self.assertEqual(resolved, fallback)

    def test_corpus_resolver_rejects_non_numeric_catalog_ids(self):
        """Reject path-like IDs before composing a corpus shard path."""
        with self.assertRaisesRegex(ValueError, "numeric library catalog ID"):
            app.resolve_book_file(settings={"BOOK_CHATBOT_BOOK_ID": "../42"})

    def test_indexes_short_passages_across_the_book(self):
        """Guard against accidentally bundling an empty or partial text corpus."""
        self.assertEqual(len(app.PAGES), 127)
        self.assertGreater(len(app.CHUNKS), 500)
        self.assertEqual(min(chunk["page"] for chunk in app.CHUNKS), 1)
        self.assertEqual(max(chunk["page"] for chunk in app.CHUNKS), 127)

    def test_reconstructs_a_sentence_that_continues_across_adjacent_pages(self):
        """Join only a clear lower-case continuation and retain both page IDs."""
        pages = [
            {"page": 44, "text": "A paragraph with enough words to index this passage. "
             "The mean being without a"},
            {"page": 45, "text": "name, the extremes seem to dispute for its place. "
             "A separate new paragraph starts here."},
        ]

        chunks = app.build_page_bridge_chunks(pages)

        joined = next(chunk for chunk in chunks if "The mean being without a name" in chunk["text"])
        self.assertEqual(joined["pages"], [44, 45])
        self.assertFalse(any(
            "A paragraph with enough words to index this passage. name" in chunk["text"]
            for chunk in chunks
        ))

    def test_page_boundary_reconstruction_is_conservative(self):
        """Do not join completed sentences or a new capitalized paragraph."""
        completed = app.build_page_bridge_chunks([
            {"page": 10, "text": "A complete sentence ends here."},
            {"page": 11, "text": "A new sentence begins with a capital letter."},
        ])
        self.assertFalse(completed)

        self.assertTrue(app.likely_page_continuation("The argument ends with a", "name."))
        self.assertFalse(app.likely_page_continuation("The argument ends here.", "name."))
        self.assertFalse(app.likely_page_continuation("The argument ends with a", "A new paragraph."))

    def test_pilot_source_page_44_to_45_fragment_is_reconstructed(self):
        """Retrieve the real continuation without prescribing any answer text."""
        pilot_pages = [page for page in app.PAGES if page["page"] in {44, 45}]
        chunks = app.build_page_bridge_chunks(pilot_pages)

        joined = [
            chunk for chunk in chunks
            if "The mean being without a name, the extremes" in chunk["text"]
        ]
        self.assertTrue(joined)
        self.assertTrue(any(chunk["pages"] == [44, 45] for chunk in joined))

        retrieved = app.retrieve("What does Aristotle mean by the mean without a name?", [])
        source = next(source for source in retrieved if source.get("pages") == [44, 45])
        self.assertIn("The mean being without a name", source["text"])

    def test_source_text_review_flags_are_non_mutating_and_conservative(self):
        """Flag conspicuous extraction artifacts but leave source words untouched."""
        original = "The source contains � and the the repeated word."
        self.assertEqual(
            app.source_text_review_flags(original),
            ["replacement_character", "repeated_adjacent_word"],
        )
        self.assertEqual(original, "The source contains � and the the repeated word.")
        self.assertEqual(app.source_text_review_flags("Ordinary clean source wording."), [])

    def test_tokenizer_matches_common_uation_inflections(self):
        """Let a query's derived form match the corresponding verb in the book."""
        expected = "habituate"
        self.assertIn(expected, app.tokenize("habituation"))
        self.assertIn(expected, app.tokenize("habituated"))
        self.assertIn(expected, app.tokenize("habituating"))

    def test_direct_search_uses_shared_lemma_for_habituation(self):
        """Retrieve the formation-of-character passage without model expansion."""
        results = app.retrieve("How does habituation help someone become virtuous?", [])
        self.assertTrue(results)
        self.assertIn(14, [source["page"] for source in results[:5]])

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

    def test_cross_page_evidence_context_exposes_all_physical_pages(self):
        """Keep sentence references and locators aligned for stitched text."""
        context = app.format_evidence_context([{
            "source_id": "S1",
            "page": 44,
            "pages": [44, 45],
            "text": "The mean being without a name, the extremes dispute for its place.",
        }])

        self.assertIn('source_id="S1" page="44" sentence="1" pages="44,45"', context)
        self.assertIn("The mean being without a name", context)

    def test_sentence_reference_resolves_to_the_exact_displayed_window(self):
        """Let the app, rather than a small model, copy exact source wording."""
        source = {
            "source_id": "S4",
            "page": 66,
            "text": "Scientific knowledge concerns universal and necessary things.\n"
                    "Philosophic wisdom concerns the highest objects.",
        }
        checked = {
            "sentences": [{
                "text": "Scientific knowledge concerns universal and necessary things.",
                "evidence": [{"source_id": "S4", "quote": "", "sentence_number": 1}],
            }]
        }

        bound = app.bind_sentence_evidence_references(checked, [source])
        answer = app.format_cited_sentences(
            checked["sentences"], [source], question="What does scientific knowledge concern?"
        )

        self.assertEqual(bound, 1)
        self.assertEqual(
            checked["sentences"][0]["evidence"][0]["quote"],
            "Scientific knowledge concerns universal and necessary things.",
        )
        self.assertIn("[S4]", answer)

    def test_sentence_reference_rejects_invalid_source_or_number(self):
        """Never turn a missing sentence locator into invented evidence."""
        checked = {"sentences": [
            {"text": "Claim.", "evidence": [
                {"source_id": "S1", "quote": "", "sentence_number": 99},
                {"source_id": "S9", "quote": "", "sentence_number": 1},
            ]}
        ]}
        source = {"source_id": "S1", "page": 1, "text": "Only one sentence."}

        bound = app.bind_sentence_evidence_references(checked, [source])

        self.assertEqual(bound, 0)
        self.assertEqual(checked["sentences"][0]["evidence"][0]["quote"], "")
        self.assertEqual(checked["sentences"][0]["evidence"][1]["quote"], "")

    def test_long_evidence_sentences_become_bounded_exact_windows(self):
        """Keep selected source windows under the quote ceiling without editing text."""
        first = " ".join(f"alpha{i}" for i in range(1, 24)) + ";"
        second = " ".join(f"beta{i}" for i in range(1, 27)) + "."
        third = " ".join(f"gamma{i}" for i in range(1, 91)) + "."
        text = f"{first} {second} {third}"

        windows = app.evidence_sentence_windows(text)

        self.assertGreater(len(windows), 3)
        self.assertTrue(all(len(app.TOKEN_RE.findall(window)) <= 40 for window in windows))
        self.assertEqual(" ".join(windows), text)
        self.assertTrue(any(window.endswith(";") for window in windows))

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

    def test_checker_focus_prefers_topic_passages_and_keeps_specialized_sets(self):
        """Focus ordinary checks without hiding evidence for complex requests."""
        sources = [
            {"source_id": "S1", "page": 12,
             "text": "Happiness is an activity of soul in accordance with perfect virtue."},
            {"source_id": "S2", "page": 14,
             "text": "Virtue is formed through habituation and repeated actions."},
            {"source_id": "S3", "page": 67,
             "text": "Philosophic wisdom concerns the highest things and divine objects."},
            {"source_id": "S4", "page": 79,
             "text": "Continence and temperance concern appetites and bodily pleasures."},
            {"source_id": "S5", "page": 92,
             "text": "Wealth and honor are external goods sought by many people."},
        ]

        focused = app.focus_checker_sources(
            "What does happiness mean?",
            "Happiness is activity of the soul in accordance with virtue.",
            sources,
        )

        self.assertEqual(len(focused), 3)
        self.assertIn("S1", [source["source_id"] for source in focused])
        self.assertNotIn("S5", [source["source_id"] for source in focused])
        # Argument and multi-part checks must retain every candidate so the
        # focus optimization cannot make one requested role or topic vanish.
        self.assertEqual(
            app.focus_checker_sources("Why?", "draft", sources, preserve_all=True),
            sources,
        )
        self.assertEqual(
            app.focus_checker_sources(
                "What does Aristotle think about God and the soul?", "draft", sources
            ),
            sources,
        )

    def test_checker_cannot_verify_with_a_retrieved_but_hidden_off_topic_source(self):
        """A valid quote is insufficient when its passage was outside checker context."""
        # Model a common retrieval shape: several candidates concern the asked
        # subject, while a lower-ranked candidate is a real passage about a
        # different subject. The checker receives only the focused three, and
        # validation must enforce that same boundary even though the complete
        # retrieval list remains available for quote lookup and source links.
        sources = [
            {"source_id": "S1", "page": 12,
             "text": "Insomnia is a disorder of sleeping and waking."},
            {"source_id": "S2", "page": 14,
             "text": "Quiet rest is a remedy for sleeplessness."},
            {"source_id": "S3", "page": 16,
             "text": "Rest helps restore ordinary sleep."},
            {"source_id": "S4", "page": 80,
             "text": "Friendship is founded on mutual goodwill."},
        ]
        focused = app.focus_checker_sources(
            "What remedy does the text propose for insomnia?",
            "Quiet rest is suggested for insomnia.",
            sources,
        )
        allowed_ids = {source["source_id"] for source in focused}
        self.assertEqual(allowed_ids, {"S1", "S2", "S3"})

        issues = []
        rejected = app.format_cited_sentences(
            [{
                "text": "Friendship is founded on mutual goodwill.",
                "evidence": [{
                    "source_id": "S4",
                    "quote": "Friendship is founded on mutual goodwill",
                }],
            }],
            sources,
            validation_issues=issues,
            allowed_source_ids=allowed_ids,
        )

        self.assertIsNone(rejected)
        self.assertTrue(any("not supplied to the checker" in issue for issue in issues))

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
        # Promotion changes ordering but never discards a page from the actual
        # direct result set, even if a general tokenizer improvement changes
        # which page occupies a particular rank.
        combined_pages = [source["page"] for source in combined]
        self.assertTrue(all(source["page"] in combined_pages for source in direct))

    def test_unmatched_parenthetical_alias_triggers_query_expansion(self):
        """Do not let generic overlap hide a missed term and its plain gloss.

        This synthetic example is deliberately unrelated to the Aristotle
        pilot. A passage can share enough broad words with a detailed question
        to pass the ordinary overlap threshold even though it matches neither
        the named concept nor the explanation in parentheses. Expansion is
        useful in that case, while a top passage that covers either side of
        the alias should not trigger this additional check by itself.
        """
        question = (
            "What is ataraxia (freedom from disturbance), and how does this "
            "concept shape a person's good life?"
        )
        generic_sources = [{
            "text": "A person shapes a good life through wise choices and activity.",
        }]

        # The passages share enough generic wording to meet ordinary overlap
        # thresholds, but neither side of the explicit alias is represented.
        self.assertTrue(app.has_unmatched_parenthetical_alias(question, generic_sources))
        self.assertTrue(app.query_needs_expansion(question, generic_sources))

        named_term_covered = [{
            "text": "Ataraxia shapes a good life through wise activity.",
        }]
        gloss_covered = [{
            "text": "Freedom from disturbance shapes a good life through wise activity.",
        }]
        incidental_gloss_word = [{
            "text": "Freedom shapes a good life through wise activity.",
        }]
        self.assertFalse(app.has_unmatched_parenthetical_alias(question, named_term_covered))
        self.assertFalse(app.has_unmatched_parenthetical_alias(question, gloss_covered))
        self.assertTrue(app.has_unmatched_parenthetical_alias(question, incidental_gloss_word))

    def test_unmatched_single_topic_wording_uses_a_general_source_vocabulary_signal(self):
        """Detect partial topic-label mismatch without naming a pilot question."""
        question = "What does the author mean by tranquil virtue?"
        translated_wording = [{
            "text": "Quiet virtue is a settled state of character.",
        }]
        self.assertTrue(app.has_unmatched_single_topic_wording(question, translated_wording))

        fully_matched_wording = [{
            "text": "Tranquil virtue is a settled state of character.",
        }]
        self.assertFalse(app.has_unmatched_single_topic_wording(question, fully_matched_wording))

        # Each side of an explicit multi-topic question keeps its own coverage
        # requirements; the single-label hint must not blur them together.
        multipart = "What does the author think about justice and friendship?"
        self.assertFalse(app.has_unmatched_single_topic_wording(
            multipart,
            [{"text": "Justice guides fair distribution."}],
        ))

    def test_single_topic_evidence_anchors_follow_the_book_wording_when_label_is_absent(self):
        """Do not demand an absent reader label from a source-language quote."""
        question = "What does the author mean by tranquil virtue?"
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": "Quiet virtue is a settled state of character.",
        }]
        self.assertEqual(
            app.evidence_topic_anchor_terms(question, source),
            {"virtue"},
        )
        self.assertEqual(
            app.unmatched_single_topic_claim_terms(question, source),
            {"tranquil"},
        )

        # A one-word reader label can also be absent because the book uses a
        # different expression (for example, "happiness" and "the human
        # good"). Keep it out of the exact-topic rule so source-worded
        # paraphrases remain possible; the generic claim/evidence floor still
        # applies to every cited sentence.
        self.assertEqual(
            app.evidence_topic_anchor_terms(
                "What is happiness?",
                [{"text": "The human good is activity in accordance with virtue."}],
            ),
            set(),
        )

        # The source still has to supply a genuine lexical foothold for the
        # claim; this only removes the absent question label from the stricter
        # multi-anchor check. Exact quote matching remains mandatory.
        issues = []
        answer = app.format_cited_sentences(
            [{
                "text": "Tranquil virtue is a settled state of character.",
                "evidence": [{
                    "source_id": "S1",
                    "quote": "Quiet virtue is a settled state of character",
                }],
            }],
            source,
            required_topic_terms=app.evidence_topic_anchor_terms(question, source),
            validation_issues=issues,
            question=question,
        )
        self.assertIsNotNone(answer)
        self.assertEqual(issues, [])

        # Multipart topic coverage is still strict: evidence about soul alone
        # must not erase the separately requested God topic.
        god_and_soul = "What does the author think about God and the soul?"
        soul_only_source = [{
            "source_id": "S1",
            "page": 2,
            "text": "The soul is an activity of life.",
        }]
        self.assertEqual(
            app.evidence_topic_anchor_terms(god_and_soul, soul_only_source),
            app.question_topic_anchor_terms(god_and_soul),
        )
        self.assertEqual(
            app.unmatched_single_topic_claim_terms(god_and_soul, soul_only_source),
            set(),
        )

    def test_source_wording_can_support_a_claim_with_an_absent_single_topic_label(self):
        """Ignore only an absent reader label, retaining exact quote checks."""
        question = "What does the author mean by tranquil virtue?"
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": "Quiet virtue is a settled state of character.",
        }]
        issues = []
        answer = app.format_cited_sentences(
            [{
                "text": "Tranquil virtue; it is a settled state of character.",
                "evidence": [{
                    "source_id": "S1",
                    "quote": "Quiet virtue is a settled state of character",
                }],
            }],
            source,
            validation_issues=issues,
            question=question,
            required_topic_terms=app.evidence_topic_anchor_terms(question, source),
        )
        self.assertEqual(
            answer,
            "Tranquil virtue; it is a settled state of character [S1].",
        )
        self.assertEqual(issues, [])

        # This exception cannot make a paraphrase count as an exact quotation.
        issues = []
        rejected = app.format_cited_sentences(
            [{
                "text": "Tranquil virtue; it is a settled state of character.",
                "evidence": [{
                    "source_id": "S1",
                    "quote": "Calm virtue is a settled state of character",
                }],
            }],
            source,
            validation_issues=issues,
            question=question,
            required_topic_terms=app.evidence_topic_anchor_terms(question, source),
        )
        self.assertIsNone(rejected)
        self.assertTrue(any("not an exact passage match" in issue for issue in issues))

    def test_draft_prompt_uses_source_vocabulary_for_partly_unmatched_topic_label(self):
        """Guide a model toward source terminology when one label is absent."""
        question = "What does the author mean by tranquil virtue?"
        captured = {}
        response = {"message": {"content": json.dumps({
            "answer": "The text uses quiet virtue to describe a settled state of character.",
        })}}

        def record_request(request, timeout=0):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(response)

        with patch.object(app.urllib.request, "urlopen", side_effect=record_request):
            app.call_ollama(
                question,
                [{"source_id": "S1", "page": 1,
                  "text": "Quiet virtue is a settled state of character."}],
                [],
                "qwen3:4b",
            )

        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("single-topic wording only partly appears", system_prompt)
        self.assertIn("answer with that source term", system_prompt)
        self.assertIn("Keep every evidence quote copied exactly", system_prompt)

    def test_counted_list_draft_uses_compact_structured_candidate_plan(self):
        """Create complete list candidates before separate evidence validation."""
        question = "What are the three kinds of friendship Aristotle describes?"
        captured = {}
        response = {"message": {"content": json.dumps({
            "candidates": [
                "friendship based on utility",
                "friendship based on pleasure",
                "friendship of the good",
            ],
        })}}

        def record_request(request, timeout=0):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(response)

        sources = [{
            "source_id": "S1",
            "page": 90,
            "text": (
                "There are three kinds of friendship. Those who love each other for utility "
                "do not love each other for themselves. Those who love for pleasure find "
                "each other pleasant. Friendship of the good is complete."
            ),
        }]
        with patch.object(app.urllib.request, "urlopen", side_effect=record_request):
            plan = app.call_ollama(question, sources, [], "qwen3:4b")

        self.assertEqual(
            plan,
            "1. friendship based on utility\n"
            "2. friendship based on pleasure\n"
            "3. friendship of the good",
        )
        payload = captured["payload"]
        self.assertEqual(payload["format"], app.list_candidate_plan_schema(3))
        self.assertIn("internal evidence-first plan", payload["messages"][0]["content"])
        self.assertIn("parenthetical details", payload["messages"][0]["content"])
        self.assertIn("return an empty candidates array", payload["messages"][-1]["content"])
        self.assertEqual(payload["options"]["num_predict"], 320)

    def test_incomplete_or_repeated_candidate_plan_never_becomes_a_locked_list(self):
        """Only a full, distinct plan may activate candidate-focused checks."""
        self.assertIsNone(app.render_list_candidate_plan(
            {"candidates": ["utility friendship", "pleasure friendship"]}, 3
        ))
        self.assertIsNone(app.render_list_candidate_plan(
            {"candidates": ["utility friendship", "pleasure friendship", "utility friendship"]}, 3
        ))
        self.assertIsNone(app.render_list_candidate_plan(
            {"candidates": ["utility friendship", "", "friendship of the good"]}, 3
        ))
        self.assertIsNone(app.render_list_candidate_plan(
            {"candidates": ["S2", "S3", "S4"]}, 3
        ))
        self.assertEqual(
            app.render_list_candidate_plan(
                {"candidates": ["utility friendship", "pleasure friendship", "friendship of the good"]}, 3
            ),
            "1. utility friendship\n2. pleasure friendship\n3. friendship of the good",
        )

    def test_counted_list_needs_distinctive_membership_in_list_context(self):
        """Related mentions and the question topic alone cannot prove membership."""
        question = "What are the three kinds of friendship Aristotle describes?"
        sources = [
            {
                "source_id": "S1",
                "text": (
                    "There are three kinds of friendship. Friendship for utility "
                    "is based on usefulness, and friendship for pleasure is based "
                    "on enjoyment."
                ),
            },
            {
                "source_id": "S5",
                "text": "Friendship and justice concern the same objects in communities.",
            },
        ]
        items = [
            {
                "list_item_label": "friendship",
                "evidence": [{"source_id": "S1", "quote": "There are three kinds of friendship"}],
            },
            {
                "list_item_label": "justice",
                "evidence": [{"source_id": "S5", "quote": "Friendship and justice concern the same objects"}],
            },
            {
                "list_item_label": "utility friendship",
                "evidence": [{"source_id": "S1", "quote": "Friendship for utility is based on usefulness"}],
            },
        ]

        issues = app.counted_list_membership_witness_issues(question, items, sources)

        self.assertEqual(len(issues), 2)
        self.assertIn("list item 1", issues[0])
        self.assertIn("list item 2", issues[1])
        # A genuinely different list remains governed by reusable list nouns,
        # explicit overview wording, and the candidate's exact quoted term.
        stages_question = "Which three stages does the handbook describe?"
        stages_source = [{
            "source_id": "S1",
            "text": "The handbook describes three stages: planning, review, and revision.",
        }]
        self.assertEqual(
            app.counted_list_membership_witness_issues(
                stages_question,
                [{
                    "list_item_label": "planning",
                    "evidence": [{"source_id": "S1", "quote": "three stages: planning"}],
                }],
                stages_source,
            ),
            [],
        )

    def test_checker_prompt_keeps_alias_guidance_and_exact_quotes_together(self):
        """The validation pass gets source-term guidance without weaker checks."""
        question = "What does the author mean by tranquil virtue?"
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": "Quiet virtue is a settled state of character.",
        }]
        response = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Quiet virtue is a settled state of character.",
                "evidence": [{
                    "source_id": "S1",
                    "quote": "Quiet virtue is a settled state of character",
                }],
            }],
        })}}
        captured = {}

        def record_request(request, timeout=0):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(response)

        with patch.object(app.urllib.request, "urlopen", side_effect=record_request):
            answer = app.verify_answer(
                question, source, "Quiet virtue is a settled state of character.", "qwen3:4b"
            )

        self.assertIn("Quiet virtue", answer)
        system_prompt = captured["payload"]["messages"][0]["content"]
        self.assertIn("single-topic wording only partly appears", system_prompt)
        self.assertIn("answer with that source term", system_prompt)
        self.assertIn("Keep every evidence quote copied exactly", system_prompt)

    def test_parenthetical_alias_expansion_prompt_asks_for_book_wording(self):
        """Search wording from the text instead of echoing a reader's labels."""
        question = "What does Aristotle mean by eudaimonia (human flourishing)?"
        response = {"message": {"content": json.dumps({
            "search_terms": "happiness; activity of soul",
            "facet_1": "happiness; activity in accordance with virtue",
        })}}
        captured = {}

        def record_request(request, timeout=0):
            captured["payload"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse(response)

        with patch.object(app.urllib.request, "urlopen", side_effect=record_request):
            expanded = app.expand_query(question, [], "qwen3:4b")

        prompt = captured["payload"]["messages"][-1]["content"]
        self.assertIn("search for the source book's own wording", prompt)
        self.assertIn("Do not merely repeat the technical term", prompt)
        self.assertIn("happiness", expanded["search_terms"])

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

    def test_cross_page_citation_payload_links_each_physical_page(self):
        """Expose both source pages while preserving the original Drive URL field."""
        payload = app.citation_source_payload({
            "source_id": "S2",
            "page": 44,
            "pages": [44, 45],
        })

        self.assertEqual(payload["id"], "S2")
        self.assertEqual(payload["pages"], [44, 45])
        self.assertTrue(payload["url"].endswith("#page=44"))
        self.assertEqual(
            [item["url"].rsplit("#page=", 1)[1] for item in payload["page_urls"]],
            ["44", "45"],
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

    def test_question_facets_split_explicit_named_topic_lists(self):
        """Give each explicitly listed subject its own retrieval and answer slot."""
        self.assertEqual(
            app.question_facets("What does the text say about courage and friendship?"),
            [
                "What does the text say about courage",
                "What does the text say about friendship",
            ],
        )
        self.assertEqual(
            app.question_facets("What does the text say about courage, friendship, and pleasure?"),
            [
                "What does the text say about courage",
                "What does the text say about friendship",
                "What does the text say about pleasure",
            ],
        )

    def test_question_facets_keep_shared_head_concepts_together(self):
        """Do not split adjectives that modify one shared topic noun."""
        question = "What does Aristotle think about practical and philosophic wisdom?"
        self.assertEqual(app.question_facets(question), [question.rstrip("?")])

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
            "source_id": "S1", "page": 72, "pages": [72], "score": 12.5,
            "text": "Virtue aims at the right mark.", "text_review_flags": []
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
            "the answer copies source wording instead of synthesizing it"
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

    def test_named_topic_coverage_is_general_and_requires_each_topic_citation(self):
        """Catch a fully supported answer that quietly omits one named subject."""
        # Use an unrelated synthetic question and domain so this regression
        # protects the coverage rule itself rather than one pilot prompt.
        question = "What does the text say about courage and friendship?"
        self.assertEqual(
            app.question_named_topic_groups(question),
            [{"courage"}, {"friendship"}],
        )

        courage_only = [{
            "text": "Courage guides action.",
            "evidence": self.evidence("S1", "Courage guides action"),
        }]
        issue = app.named_topic_coverage_issue(question, courage_only)
        self.assertIn("every explicitly named topic", issue)

    def test_explicit_list_count_is_general_and_requires_one_item_per_entry(self):
        """List completeness follows the requested count, not a pilot answer."""
        question = "Which four stages does the handbook describe?"
        self.assertTrue(app.is_explicit_list_question(question))
        self.assertEqual(app.explicit_list_answer_count(question), 4)
        self.assertIsNone(app.explicit_list_answer_count("What does the handbook say about planning?"))

        three_items = [
            {
                "text": "Planning organizes the work.",
                "list_item_label": "planning",
                "evidence": self.evidence("S1", "planning organizes the work"),
            },
            {
                "text": "Review checks the result.",
                "list_item_label": "review",
                "evidence": self.evidence("S1", "review checks the result"),
            },
            {
                "text": "Revision corrects its weaknesses.",
                "list_item_label": "revision",
                "evidence": self.evidence("S1", "revision corrects its weaknesses"),
            },
        ]
        issue = app.explicit_list_item_count_issue(question, three_items)
        self.assertIn("requests 4 separately evidenced list items", issue)
        self.assertIsNone(
            app.explicit_list_item_count_issue(
                question,
                three_items + [{
                    "text": "Delivery completes the work.",
                    "list_item_label": "delivery",
                    "evidence": self.evidence("S1", "delivery completes the work"),
                }],
            )
        )
        repeated_item = three_items + [
            {
                "text": "Planning is the fourth stage.",
                "list_item_label": "planning",
                "evidence": self.evidence("S1", "planning organizes the work"),
            },
        ]
        self.assertIn("distinct labels", app.explicit_list_item_count_issue(question, repeated_item))
        mislabeled_item = dict(
            three_items[0],
            list_item_label="delivery",
            text="Delivery completes the work.",
        )
        self.assertIn(
            "exact excerpt that names",
            app.list_item_label_issue(mislabeled_item),
        )

    def test_checker_builds_separate_evidenced_items_for_an_explicit_list(self):
        """Keep each requested list member attached to its own exact support."""
        question = "Which three stages does the handbook describe?"
        source_text = (
            "The handbook names three stages. First, planning organizes the work. "
            "Next, review checks the result. Finally, revision corrects its weaknesses."
        )
        source = [{"source_id": "S1", "page": 1, "text": source_text}]
        response = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Planning organizes the work.",
                    "list_item_label": "planning",
                    "evidence": self.evidence("S1", "planning organizes the work"),
                },
                {
                    "text": "Review checks the result.",
                    "list_item_label": "review",
                    "evidence": self.evidence("S1", "review checks the result"),
                },
                {
                    "text": "Revision corrects its weaknesses.",
                    "list_item_label": "revision",
                    "evidence": self.evidence("S1", "revision corrects its weaknesses"),
                },
            ],
        })}}
        payloads = []

        def capture_request(request, timeout):
            payloads.append(json.loads(request.data.decode("utf-8")))
            return FakeResponse(response)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            answer = app.verify_answer(question, source, "draft", "qwen3:4b")

        self.assertIn("Planning organizes the work", answer)
        self.assertIn("Review checks the result", answer)
        self.assertIn("Revision corrects its weaknesses", answer)
        self.assertEqual(answer.count("[S1]"), 3)
        schema = payloads[0]["format"]["properties"]["sentences"]
        self.assertEqual(schema["minItems"], 3)
        self.assertEqual(schema["maxItems"], 3)
        item_schema = schema["items"]
        self.assertIn("list_item_label", item_schema["required"])
        self.assertIn("one actual list member per object", payloads[0]["messages"][0]["content"])

    def test_numbered_draft_list_locks_candidate_text_and_checks_each_member(self):
        """The checker maps evidence to fixed candidates instead of rewriting list prose."""
        question = "Which three stages does the handbook describe?"
        draft = "The stages are: 1) planning, 2) review, and 3) revision."
        self.assertEqual(
            app.numbered_list_draft_candidates(draft, 3),
            ["planning", "review", "revision"],
        )
        self.assertIsNone(app.numbered_list_draft_candidates(
            "The stages are planning, review, and revision.", 3
        ))
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": (
                "Planning is the first stage. Review is the second stage. "
                "Revision is the final stage."
            ),
        }, {
            "source_id": "S2",
            "page": 2,
            "text": "An unrelated passage that was retrieved for the broad question.",
        }]
        payloads = []
        evidence_by_candidate = {
            1: {"source_id": "S1", "sentence_number": 1},
            2: {"source_id": "S1", "sentence_number": 2},
            3: {"source_id": "S1", "sentence_number": 3},
        }
        labels = {1: "planning", 2: "review", 3: "revision"}

        def capture_request(request, timeout):
            payload = json.loads(request.data.decode("utf-8"))
            payloads.append(payload)
            candidate_index = payload["format"]["properties"]["sentences"]["items"]["properties"]["candidate_index"]["enum"][0]
            response = {"message": {"content": json.dumps({
                "sentences": [{
                    "candidate_index": candidate_index,
                    "is_list_member": True,
                    "list_item_label": labels[candidate_index],
                    "evidence": [evidence_by_candidate[candidate_index]],
                }],
            })}}
            return FakeResponse(response)

        candidate_source_ids = {1: {"S1"}, 2: {"S1"}, 3: {"S1"}}
        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            answer = app.verify_answer(
                question,
                source,
                draft,
                "qwen3:4b",
                candidate_source_ids=candidate_source_ids,
            )

        self.assertEqual(answer.count("One stage is"), 3)
        self.assertIn("One stage is planning [S1].", answer)
        self.assertIn("One stage is review [S1].", answer)
        self.assertIn("One stage is revision [S1].", answer)
        self.assertEqual(len(payloads), 3)
        for candidate_index, payload in enumerate(payloads, start=1):
            item_schema = payload["format"]["properties"]["sentences"]["items"]
            self.assertNotIn("text", item_schema["properties"])
            self.assertEqual(item_schema["properties"]["candidate_index"]["enum"], [candidate_index])
            self.assertIn("is_list_member", item_schema["required"])
            self.assertEqual(
                item_schema["properties"]["evidence"]["items"]["properties"]["source_id"]["enum"],
                ["S1"],
            )
            prompt = payload["messages"][-1]["content"]
            self.assertIn(f"Review only fixed candidate {candidate_index}:", prompt)
            self.assertNotIn("unrelated passage", prompt)
            self.assertIn("Do not assess, restate, or provide evidence for any other candidate", payload["messages"][0]["content"])

    def test_numbered_list_cannot_verify_related_mentions_as_members(self):
        """The evidence pipeline rejects a complete-looking but false list."""
        question = "What are the three kinds of friendship Aristotle describes?"
        draft = "The kinds are: 1) friendship, 2) justice, and 3) utility."
        sources = [{
            "source_id": "S1",
            "page": 90,
            "text": (
                "There are three kinds of friendship. This kind exists for utility, "
                "and those who pursue utility benefit from one another."
            ),
        }, {
            "source_id": "S5",
            "page": 96,
            "text": "Friendship and justice concern the same objects in communities.",
        }]
        labels = {1: "friendship", 2: "justice", 3: "utility"}
        references = {
            1: {"source_id": "S1", "sentence_number": 1},
            2: {"source_id": "S5", "sentence_number": 1},
            3: {"source_id": "S1", "sentence_number": 2},
        }

        def answer_candidate(request, timeout):
            payload = json.loads(request.data.decode("utf-8"))
            candidate_index = payload["format"]["properties"]["sentences"]["items"]["properties"]["candidate_index"]["enum"][0]
            return FakeResponse({"message": {"content": json.dumps({
                "sentences": [{
                    "candidate_index": candidate_index,
                    "is_list_member": True,
                    "list_item_label": labels[candidate_index],
                    "evidence": [references[candidate_index]],
                }],
            })}})

        diagnostics = {}
        candidate_source_ids = {1: {"S1"}, 2: {"S5"}, 3: {"S1"}}
        with patch.object(app.urllib.request, "urlopen", side_effect=answer_candidate):
            answer = app.verify_answer(
                question,
                sources,
                draft,
                "qwen3:4b",
                diagnostics,
                candidate_source_ids=candidate_source_ids,
            )

        self.assertNotEqual(diagnostics["status"], "verified")
        self.assertNotIn("One kind is justice", answer)

    def test_isolated_list_checks_do_not_restore_a_rejected_candidate(self):
        """Independent evidence calls preserve the model's rejection through partial recovery."""
        question = "Which three stages does the handbook describe?"
        draft = "The stages are: 1) planning, 2) review, and 3) coffee."
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": "Planning is the first stage. Review is the second stage. Revision is the final stage.",
        }]
        diagnostics = {}
        seen = []

        def candidate_response(request, timeout):
            payload = json.loads(request.data.decode("utf-8"))
            index = payload["format"]["properties"]["sentences"]["items"]["properties"]["candidate_index"]["enum"][0]
            seen.append(index)
            is_member = index < 3
            return FakeResponse({"message": {"content": json.dumps({
                "sentences": [{
                    "candidate_index": index,
                    "is_list_member": is_member,
                    "list_item_label": ["planning", "review", "revision"][index - 1],
                    "evidence": [{"source_id": "S1", "sentence_number": index}],
                }],
            })}})

        with patch.object(app.urllib.request, "urlopen", side_effect=candidate_response):
            answer = app.verify_answer(
                question,
                source,
                draft,
                "qwen3:4b",
                diagnostics,
                candidate_source_ids={1: {"S1"}, 2: {"S1"}, 3: {"S1"}},
            )

        self.assertEqual(diagnostics["status"], "partial")
        self.assertIn("planning", answer)
        self.assertIn("review", answer)
        self.assertNotIn("coffee", answer.casefold())
        self.assertEqual(seen[:3], [1, 2, 3])
        first_attempt_items = diagnostics["attempts"][0]["checker_sentences"]
        self.assertEqual(first_attempt_items[2]["_list_member_confirmed"], False)

    def test_numbered_list_does_not_require_app_generated_noun_in_evidence(self):
        """Candidate evidence need not repeat the app's grammatical list connector."""
        question = "Which three kinds of friendship does Aristotle describe?"
        draft = (
            "The kinds are: 1) friendship based on utility, "
            "2) friendship based on pleasure, and 3) friendship based on virtue."
        )
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": (
                "Friendship based on utility serves gain. "
                "Friendship based on pleasure brings enjoyment. "
                "Friendship based on virtue belongs to good people."
            ),
        }]
        sentence_numbers = {1: 1, 2: 2, 3: 3}
        labels = {1: "utility", 2: "pleasure", 3: "virtue"}

        def response_for_candidate(request, timeout):
            payload = json.loads(request.data.decode("utf-8"))
            index = payload["format"]["properties"]["sentences"]["items"]["properties"]["candidate_index"]["enum"][0]
            return FakeResponse({"message": {"content": json.dumps({
                "sentences": [{
                    "candidate_index": index,
                    "is_list_member": True,
                    "list_item_label": labels[index],
                    "evidence": [{"source_id": "S1", "sentence_number": sentence_numbers[index]}],
                }],
            })}})
        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", side_effect=response_for_candidate):
            answer = app.verify_answer(
                question,
                source,
                draft,
                "qwen3:4b",
                diagnostics,
                candidate_source_ids={1: {"S1"}, 2: {"S1"}, 3: {"S1"}},
            )

        self.assertEqual(diagnostics["status"], "verified")
        self.assertEqual(answer.count("One kind is"), 3)
        self.assertIn("One kind is friendship based on utility [S1].", answer)
        self.assertIn("One kind is friendship based on pleasure [S1].", answer)
        self.assertIn("One kind is friendship based on virtue [S1].", answer)

    def test_candidate_pool_checker_context_excludes_unfocused_sources(self):
        """List repairs see only pages found by the independent candidate searches."""
        sources = [
            {"source_id": "S1", "page": 1, "text": "Focused candidate evidence."},
            {"source_id": "S2", "page": 2, "text": "Broad question-level distractor."},
            {"source_id": "S3", "page": 3, "text": "Focused evidence for another candidate."},
        ]

        focused = app.candidate_pool_checker_sources(
            sources,
            {1: {"S1"}, 2: {"S3"}},
        )

        self.assertEqual([source["source_id"] for source in focused], ["S1", "S3"])
        self.assertEqual([source["source_id"] for source in sources], ["S1", "S2", "S3"])

    def test_numbered_list_retrieval_builds_bounded_candidate_source_pools(self):
        """List candidates get their own retrieval without renumbering existing citations."""
        sources = [{
            "source_id": "S1",
            "page": 10,
            "text": "The handbook groups its stages into a sequence.",
            "score": 1.0,
        }]
        search_results = {
            "planning": [
                {"source_id": "S1", "page": 20, "text": "Planning is the opening stage.", "score": 2.0},
                {"source_id": "S1", "page": 21, "text": "Planning sets the goal before review.", "score": 1.5},
            ],
            "review": [
                {"source_id": "S1", "page": 10, "text": "Review follows the initial stage.", "score": 2.2},
                {"source_id": "S1", "page": 22, "text": "Review checks the completed work.", "score": 1.8},
            ],
        }

        def candidate_search(query, history, search_terms=None, limit=5):
            return search_results[query][:limit]

        with patch.object(app, "retrieve", side_effect=candidate_search):
            source_pools, trace = app.retrieve_numbered_list_candidate_sources(
                "Which two stages does the handbook describe?",
                ["planning", "review"],
                [],
                sources,
            )

        self.assertEqual(sources[0]["source_id"], "S1")
        self.assertEqual(sources[0]["page"], 10)
        self.assertEqual(len(sources), 3)
        self.assertIn("S2", source_pools[1])
        self.assertIn("S1", source_pools[2])
        self.assertTrue(source_pools[1].isdisjoint(source_pools[2]))
        self.assertEqual([entry["candidate_index"] for entry in trace], [1, 2])
        self.assertEqual(trace[0]["searched_pages"], [20, 21])
        self.assertIn("Planning sets the goal", next(
            source["text"] for source in sources if source["page"] == 21
        ))

    def test_numbered_list_pools_share_only_matching_overview_passages(self):
        """A passage naming the requested count and topic can anchor every candidate."""
        question = "Which three kinds of friendship does Aristotle describe?"
        sources = [
            {
                "source_id": "S1",
                "page": 90,
                "text": "There are three kinds of friendship: utility, pleasure, and virtue.",
            },
            {
                "source_id": "S2",
                "page": 91,
                "text": "There are three kinds of courage, each with distinct traits.",
            },
        ]
        candidates = ["utility", "pleasure", "virtue"]

        with patch.object(app, "retrieve", return_value=[]):
            pools, trace = app.retrieve_numbered_list_candidate_sources(
                question,
                candidates,
                [],
                sources,
            )

        self.assertEqual(pools, {1: {"S1"}, 2: {"S1"}, 3: {"S1"}})
        self.assertTrue(all(
            row["shared_list_overview_source_ids"] == ["S1"]
            for row in trace
        ))
        self.assertTrue(all(
            row["candidate_search_source_ids"] == []
            for row in trace
        ))

    def test_candidate_evidence_context_groups_exact_windows_by_list_item(self):
        """A list checker sees item-matched sentences with stable source references."""
        sources = [{
            "source_id": "S1",
            "page": 90,
            "text": (
                "There are three kinds of friendship. "
                "Those who love each other for utility do not love for themselves. "
                "Those who love for pleasure find each other pleasant. "
                "Friendship of the good is the complete form."
            ),
        }]
        candidates = ["utility", "pleasure", "the good"]
        pools = {1: {"S1"}, 2: {"S1"}, 3: {"S1"}}

        context = app.format_candidate_evidence_context(
            candidates,
            sources,
            pools,
            "What are the three kinds of friendship?",
        )

        utility_section, pleasure_section, good_section = context.split("\n\n")
        self.assertIn('candidate="1" source_id="S1" page="90" sentence="2"', utility_section)
        self.assertIn("love each other for utility", utility_section)
        self.assertIn('candidate="2" source_id="S1" page="90" sentence="3"', pleasure_section)
        self.assertIn("love for pleasure", pleasure_section)
        self.assertIn('candidate="3" source_id="S1" page="90" sentence="4"', good_section)
        self.assertIn("Friendship of the good", good_section)

    def test_candidate_evidence_context_has_bounded_fallback_for_no_lexical_match(self):
        """A missed candidate term keeps topical context available without inventing evidence."""
        sources = [{
            "source_id": "S2",
            "page": 4,
            "text": "There are two stages in this process. The next phase follows the first.",
        }]
        context = app.format_candidate_evidence_context(
            ["revision"],
            sources,
            {1: {"S2"}},
            "What are the two stages in this process?",
            max_windows_per_candidate=1,
        )
        self.assertIn("Candidate 1: revision", context)
        self.assertIn('source_id="S2" page="4" sentence="1"', context)
        self.assertNotIn("revision is", context.casefold())

    def test_isolated_candidate_schema_and_context_use_only_that_item_pool(self):
        """One candidate request cannot cite or inspect another item's passage."""
        sources = [
            {"source_id": "S1", "page": 1, "text": "Planning is the first stage."},
            {"source_id": "S2", "page": 2, "text": "Review is the second stage."},
        ]
        messages, schema = app.isolated_list_candidate_check(
            "Which two stages does the handbook describe?",
            "planning",
            1,
            2,
            sources,
            {1: {"S1"}, 2: {"S2"}},
            "Evidence checker system rules.",
        )

        item_schema = schema["properties"]["sentences"]["items"]
        self.assertEqual(item_schema["properties"]["candidate_index"]["enum"], [1])
        self.assertEqual(
            item_schema["properties"]["evidence"]["items"]["properties"]["source_id"]["enum"],
            ["S1"],
        )
        self.assertIn("Planning is the first stage", messages[1]["content"])
        self.assertNotIn("Review is the second stage", messages[1]["content"])

    def test_numbered_list_evidence_must_use_its_candidate_retrieval_pool(self):
        """A list candidate cannot borrow another item's newly retrieved source."""
        candidates = ["planning", "review"]
        checker_items = [
            {
                "candidate_index": 1,
                "is_list_member": True,
                "list_item_label": "planning",
                "evidence": self.evidence("S2", "Planning is the opening stage"),
            },
            {
                "candidate_index": 2,
                "is_list_member": True,
                "list_item_label": "review",
                # This passage is valid for candidate 1 but was not returned
                # by candidate 2's separate local search.
                "evidence": self.evidence("S2", "Planning is the opening stage"),
            },
        ]

        bound, issue = app.bind_numbered_list_evidence(
            "Which two stages does the handbook describe?",
            candidates,
            checker_items,
            candidate_source_ids={1: {"S2"}, 2: {"S3"}},
        )

        self.assertEqual(bound[0]["_list_member_confirmed"], True)
        self.assertEqual(bound[1]["_list_member_confirmed"], False)
        self.assertIn("outside its candidate-focused retrieval set", issue)

    def test_numbered_draft_list_does_not_recover_checker_rejected_candidate(self):
        """A candidate the checker rejects as a member cannot leak through partial recovery."""
        question = "Which three stages does the handbook describe?"
        draft = "The stages are: 1) planning, 2) review, and 3) coffee."
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": (
                "Planning is the first stage. Review is the second stage. "
                "Revision is the final stage."
            ),
        }]
        rejected_list = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "candidate_index": 1,
                    "is_list_member": True,
                    "list_item_label": "planning",
                    "evidence": self.evidence("S1", "Planning is the first stage"),
                },
                {
                    "candidate_index": 2,
                    "is_list_member": True,
                    "list_item_label": "review",
                    "evidence": self.evidence("S1", "Review is the second stage"),
                },
                {
                    "candidate_index": 3,
                    "is_list_member": False,
                    "list_item_label": "coffee",
                    "evidence": self.evidence("S1", "Revision is the final stage"),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(rejected_list)] * 3,
        ):
            answer = app.verify_answer(question, source, draft, "qwen3:4b", diagnostics)

        self.assertEqual(diagnostics["status"], "partial")
        self.assertIn("One stage is planning", answer)
        self.assertIn("One stage is review", answer)
        self.assertNotIn("coffee", answer.casefold())
        self.assertIn("couldn't verify every requested item in the list", answer)

    def test_list_retry_keeps_original_candidate_members_after_copied_text_fails(self):
        """A failed evidence pass should repair a list without replacing its members with source prose."""
        question = "Which three stages does the handbook describe?"
        source_text = (
            "First, planning organizes the work by assigning each task to a responsible member before the team begins. "
            "Next, review checks completed work for accuracy. Finally, revision corrects identified weaknesses."
        )
        source = [{"source_id": "S1", "page": 1, "text": source_text}]
        copied_response = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "First, planning organizes the work by assigning each task to a responsible member before the team begins.",
                    "list_item_label": "planning",
                    "evidence": self.evidence("S1", "planning organizes the work by assigning each task"),
                },
                {
                    "text": "Review checks completed work for accuracy.",
                    "list_item_label": "review",
                    "evidence": self.evidence("S1", "review checks completed work for accuracy"),
                },
                {
                    "text": "Revision corrects identified weaknesses.",
                    "list_item_label": "revision",
                    "evidence": self.evidence("S1", "revision corrects identified weaknesses"),
                },
            ],
        })}}
        corrected_response = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Planning assigns tasks before the work begins.",
                    "list_item_label": "planning",
                    "evidence": self.evidence("S1", "planning organizes the work by assigning each task"),
                },
                {
                    "text": "Review checks completed work for accuracy.",
                    "list_item_label": "review",
                    "evidence": self.evidence("S1", "review checks completed work for accuracy"),
                },
                {
                    "text": "Revision addresses identified weaknesses.",
                    "list_item_label": "revision",
                    "evidence": self.evidence("S1", "revision corrects identified weaknesses"),
                },
            ],
        })}}
        draft = "The stages are planning, review, and revision."
        diagnostics = {}
        payloads = []

        def capture_request(request, timeout):
            payloads.append(json.loads(request.data.decode("utf-8")))
            response = copied_response if len(payloads) == 1 else corrected_response
            return FakeResponse(response)

        with patch.object(app.urllib.request, "urlopen", side_effect=capture_request):
            answer = app.verify_answer(question, source, draft, "qwen3:4b", diagnostics)

        self.assertEqual(diagnostics["status"], "verified")
        self.assertIn("Planning assigns tasks", answer)
        self.assertIn("Review checks completed work", answer)
        self.assertIn("Revision addresses identified weaknesses", answer)
        self.assertEqual(len(payloads), 2)
        retry_prompt = payloads[1]["messages"][-1]["content"]
        self.assertIn("Original draft to check (not assumed correct)", retry_prompt)
        self.assertIn(draft, retry_prompt)
        self.assertIn("instead of replacing them with copied passage sentences", retry_prompt)
        self.assertIn("Do not put exact source wording in the answer sentence", retry_prompt)

    def test_checker_does_not_verify_an_incomplete_requested_list(self):
        """Individually supported entries remain partial when a requested item is absent."""
        question = "Which three stages does the handbook describe?"
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": (
                "The handbook names three stages. First, planning organizes the work. "
                "Next, review checks the result. Finally, revision corrects its weaknesses."
            ),
        }]
        incomplete = {"message": {"content": json.dumps({
            "sentences": [
                {
                    "text": "Planning organizes the work.",
                    "list_item_label": "planning",
                    "evidence": self.evidence("S1", "planning organizes the work"),
                },
                {
                    "text": "Review checks the result.",
                    "list_item_label": "review",
                    "evidence": self.evidence("S1", "review checks the result"),
                },
            ],
        })}}
        diagnostics = {}
        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(incomplete)] * 3,
        ):
            answer = app.verify_answer(
                question, source, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(diagnostics["status"], "partial")
        self.assertIn("Planning organizes the work", answer)
        self.assertIn("Review checks the result", answer)
        self.assertIn("couldn't verify every requested item in the list", answer)

        both_topics = [
            {
                "text": "Courage guides action.",
                "evidence": self.evidence("S1", "Courage guides action"),
            },
            {
                "text": "Friendship supports shared activity.",
                "evidence": self.evidence("S2", "Friendship supports shared activity"),
            },
        ]
        self.assertIsNone(app.named_topic_coverage_issue(question, both_topics))

    def test_definition_answer_must_add_supported_content_beyond_the_term(self):
        """A citation cannot make a bare repetition count as a definition."""
        # Use a synthetic topic so this guards definition requests generally,
        # rather than encoding the pilot's practical-wisdom question.
        question = "What does civic excellence mean?"
        source = [{
            "source_id": "S1",
            "page": 1,
            "text": "Civic excellence is practiced public judgment for shared civic choices.",
        }]
        issues = []
        bare_term = app.format_cited_sentences(
            [{
                "text": "Civic excellence.",
                "evidence": self.evidence("S1", "Civic excellence is practiced public judgment"),
            }],
            source,
            validation_issues=issues,
            question=question,
        )
        self.assertIsNone(bare_term)
        self.assertIn("only repeats the requested term", " ".join(issues))

        substantive_definition = app.format_cited_sentences(
            [{
                "text": "Civic excellence is practiced public judgment for shared civic choices.",
                "evidence": self.evidence(
                    "S1", "Civic excellence is practiced public judgment for shared civic choices"
                ),
            }],
            source,
            question=question,
        )
        self.assertEqual(
            substantive_definition,
            "Civic excellence is practiced public judgment for shared civic choices [S1].",
        )
        self.assertIsNone(app.definition_completeness_issue(
            "Who wrote Civic Excellence?", "Civic excellence."
        ))

    def test_definition_with_parenthetical_alias_can_use_the_book_term(self):
        """Ground the answer in the book's label when the user's label is absent."""
        question = "What does Aristotle mean by eudaimonia (human flourishing)?"
        answer = "The book calls happiness an activity of soul in accordance with perfect virtue."
        source = [self.sources[1]]
        result = app.format_cited_sentences(
            [{
                "text": answer,
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue"
                ),
            }],
            source,
            question=question,
        )

        self.assertEqual(
            result,
            "The book calls happiness an activity of soul in accordance with perfect virtue [S2].",
        )

    def test_draft_prompt_uses_source_wording_for_unmatched_parenthetical_alias(self):
        """Tell the answer model not to repeat labels absent from its passages."""
        question = "What does Aristotle mean by eudaimonia (human flourishing)?"
        captured …16998 tokens truncated…"
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

    def test_oversized_quote_with_localized_error_uses_only_exact_source_anchor(self):
        """Recover nearby context from an exact long run, never from fuzzy wording."""
        source_text = (
            "Friendship based on utility is not for the person's character but for the good they get from one another. "
            "For the sake of utility, people love one another only for what is good for themselves, and their affection "
            "ends when that benefit no longer remains. These friendships are useful only while a benefit is shared by "
            "both parties, and they change as circumstances change."
        )
        source_words = list(app.TOKEN_RE.finditer(source_text))
        quote_start = next(
            index for index, token in enumerate(source_words)
            if token.group(0).casefold() == "based"
        )
        # Keep a long exact run, then introduce a model-word substitution at
        # the end. The whole checker quote is no longer contiguous in the
        # passage, but an exact source window can still add the nearby word
        # "Friendship" and support the concise claim below.
        oversized_quote = source_text[
            source_words[quote_start].start():source_words[quote_start + 46 - 1].end()
        ]
        oversized_quote = oversized_quote.rsplit(" ", 1)[0] + "humans"
        claim = "Friendship based on utility seeks good for oneself."
        source = [{"source_id": "S1", "page": 90, "text": source_text}]
        answer_item = {
            "text": claim,
            "evidence": self.evidence("S1", oversized_quote),
        }
        trace = []

        answer = app.format_cited_sentences(
            [answer_item], source, quote_repair_trace=trace
        )

        self.assertEqual(answer, claim[:-1] + " [S1].")
        self.assertEqual(trace[0]["source_context_available"], False)
        self.assertEqual(trace[0]["outcome"], "compacted")
        self.assertTrue(trace[0]["added_source_context"])
        self.assertTrue(any("Friendship based on utility" in item["quote"] for item in answer_item["evidence"]))
        for item in answer_item["evidence"]:
            self.assertLessEqual(
                len(app.TOKEN_RE.findall(item["quote"])),
                app.MAX_EVIDENCE_QUOTE_WORDS,
            )
            self.assertTrue(app.evidence_quote_matches(item["quote"], source_text))

        # Matching topic words alone cannot authorize a source search. The
        # model must preserve one exact, contiguous source anchor of the
        # configured overlap length before neighboring words can be added.
        unrelated_quote = " ".join(
            ["Friendship", "based", "on", "utility"]
            + [f"invented{index}" for index in range(42)]
        )
        self.assertIsNone(app.compact_exact_evidence_quotes(
            unrelated_quote, source_text, claim
        ))

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
        self.assertIn("aim for 12 to 25", repair_prompt.lower())
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
            "conclusion": [{
                "text": "Aristotle identifies happiness as the highest good achievable by action.",
                "evidence": self.evidence("S1", "highest of all goods achievable by action is happiness"),
            }],
            "reasoning": [{
                "text": (
                    "Since a function is well performed in accordance with appropriate excellence, "
                    "Aristotle identifies human good with activity of soul in accordance with virtue."
                ),
                "evidence": self.evidence(
                    "S7",
                    "If an action is well performed in accordance with appropriate excellence, human good "
                    "turns out to be activity of soul in accordance with virtue",
                ),
            }],
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
        role_schema = initial_payload["format"]["properties"]["conclusion"]
        self.assertEqual(role_schema["type"], "object")
        argument_properties = role_schema["properties"]
        # The live trace showed argument responses receiving only 580 tokens,
        # too little for two role objects and their exact evidence fields.
        self.assertEqual(initial_payload["options"]["num_predict"], 980)
        self.assertEqual(argument_properties["text"]["maxLength"], app.MAX_ARGUMENT_FIELD_CHARS)
        evidence_schema = argument_properties["evidence"]["items"]
        self.assertEqual(evidence_schema["required"], ["source_id", "sentence_number"])
        self.assertNotIn("quote", evidence_schema["properties"])
        self.assertEqual(app.MAX_EVIDENCE_QUOTE_WORDS, 45)
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

    def test_two_malformed_checker_responses_still_get_final_source_only_attempt(self):
        """Do not stop early when two JSON failures leave no answer candidate."""
        final_answer = {"message": {"content": json.dumps({"sentences": [{
            "text": "Happiness is activity of soul.",
            "evidence": self.evidence(
                "S2", "Happiness is an activity of soul in accordance with perfect virtue"
            ),
        }]})}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[
                FakeResponse({"message": {"content": "{malformed first response"}}),
                FakeResponse({"message": {"content": "{malformed fresh response"}}),
                FakeResponse(final_answer),
            ],
        ) as mocked_urlopen:
            answer = app.verify_answer(
                "What is happiness?", self.sources, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(answer, "Happiness is activity of soul [S2].")
        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(
            [attempt["status"] for attempt in diagnostics["attempts"]],
            ["rejected", "rejected", "accepted"],
        )
        final_prompt = json.loads(
            mocked_urlopen.call_args_list[2].args[0].data.decode("utf-8")
        )["messages"][-1]["content"]
        self.assertIn("Start over from the passages below", final_prompt)
        self.assertNotIn("malformed first response", final_prompt)
        self.assertNotIn("malformed fresh response", final_prompt)

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
        self.assertEqual(
            app.argument_item_length_issues(question, [{
                "role": "reasoning",
                "text": "A concise premise appears first. A concise inference follows.",
            }]),
            [],
        )
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

    def test_argument_recovery_falls_back_when_only_reasoning_survives(self):
        """Do not show an unanchored reasoning fragment without a conclusion."""
        question = "What is the expedition's destination, and how do its leaders justify that route?"
        sources = [
            {"source_id": "S1", "page": 1, "text": "The expedition reaches the coast at dawn."},
            {"source_id": "S2", "page": 2, "text": "The captain follows the northern wind to cross the open sea."},
        ]
        reasoning_only = {"message": {"content": json.dumps({
            "conclusion": {
                "text": "The destination is the inland desert.",
                "evidence": self.evidence("S1", "The expedition reaches the coast at dawn"),
            },
            "reasoning": {
                "text": "The captain follows the northern wind to cross the open sea.",
                "evidence": self.evidence("S2", "The captain follows the northern wind to cross the open sea"),
            },
        })}}
        diagnostics = {}

        with patch.object(
            app.urllib.request,
            "urlopen",
            side_effect=[FakeResponse(reasoning_only)] * 3,
        ) as mocked_urlopen:
            answer = app.verify_answer(
                question, sources, "draft", "qwen3:4b", diagnostics
            )

        self.assertEqual(mocked_urlopen.call_count, 3)
        self.assertEqual(diagnostics["status"], "fallback")
        self.assertTrue(answer.startswith("I couldn't verify a reliable answer"))
        self.assertNotIn("The captain follows the northern wind", answer)

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
        user_prompt = captured["payload"]["messages"][-1]["content"]
        self.assertIn("state the same claim in different words", system_prompt)
        self.assertIn("distinct, useful qualification", system_prompt)
        evidence_schema = captured["payload"]["format"]["properties"]["sentences"]["items"]["properties"]["evidence"]["items"]
        self.assertIn("sentence_number", evidence_schema["properties"])
        self.assertNotIn("quote", evidence_schema["properties"])
        self.assertIn("Do not include a quote field", user_prompt)

    def test_checker_can_select_evidence_by_sentence_reference(self):
        """Resolve a model's locator into exact wording before normal checks."""
        response = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness consists in virtuous activity of the soul.",
                "evidence": [{"source_id": "S2", "sentence_number": 1}],
            }],
        })}}
        diagnostics = {}
        with patch.object(app.urllib.request, "urlopen", return_value=FakeResponse(response)):
            answer = app.verify_answer(
                "What is happiness?", self.sources, "draft", "qwen3:4b", diagnostics
            )

        self.assertIn("[S2]", answer)
        self.assertEqual(diagnostics["status"], "verified")
        self.assertEqual(diagnostics["attempts"][0]["sentence_references_bound"], 1)

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

    def test_third_attempt_question_echo_gets_one_source_only_recovery(self):
        """Spend one extra checker call only after the final answer echoes the prompt.

        This models the Build 109 live failure without tying the behavior to
        Aristotle's question set: two unsupported answers are followed by an
        exact question echo, then a concise passage-backed answer. The fourth
        call must start from the question and passages, and its result still
        passes every ordinary claim and quotation check.
        """
        unsupported = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "Happiness is a possession of wealth.",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue"
                ),
            }],
        })}}
        echoed_question = {"message": {"content": json.dumps({
            "sentences": [{
                "text": "What is happiness?",
                "evidence": self.evidence(
                    "S2", "Happiness is an activity of soul in accordance with perfect virtue"
                ),
            }],
        })}}
        supported_answer = {"message": {"content": json.dumps({
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
            side_effect=[
                FakeResponse(unsupported),
                FakeResponse(unsupported),
                FakeResponse(echoed_question),
                FakeResponse(supported_answer),
            ],
        ) as mocked_urlopen:
            result = app.verify_answer(
                "What is happiness?", self.sources, "draft", "llama3.2:3b", diagnostics
            )

        self.assertEqual(result, "Happiness is activity of soul [S2].")
        self.assertEqual(mocked_urlopen.call_count, 4)
        self.assertEqual(
            [attempt["status"] for attempt in diagnostics["attempts"]],
            ["rejected", "rejected", "rejected", "accepted"],
        )
        self.assertIn(
            "repeated a question",
            diagnostics["attempts"][2]["reason"],
        )

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

    def test_batch_runner_uses_five_baseline_and_exploration_prompts(self):
        html = (APP_PATH.parent / "index.html").read_text(encoding="utf-8")
        baseline_prompts = html.split('<details id="aristotle-prompts"', 1)[1].split(
            "</details>", 1
        )[0]

        self.assertEqual(baseline_prompts.count('<button type="button">'), 5)
        self.assertIn("What does Aristotle mean by practical wisdom?", html)
        self.assertIn("What does Aristotle mean by the mean relative to us?", html)
        self.assertIn("What does Aristotle think about God and the soul?", html)
        self.assertIn("What are the three kinds of friendship Aristotle describes?", html)
        self.assertIn("What does Aristotle mean by magnificence?", html)
        self.assertNotIn("What does Aristotle mean by the great-souled person?", html)
        self.assertNotIn("What does Aristotle mean by distributive justice?", html)
        self.assertNotIn("What does Aristotle mean by courage?", html)
        self.assertNotIn("What does Aristotle mean by equity, and how does it correct the law?", html)
        self.assertIn("Five repeatable test questions", baseline_prompts)
        self.assertIn("Run test set", html)
        self.assertIn('id="run-regression"', html)
        self.assertIn('id="download-regression"', html)
        self.assertIn("fetch('/api/chat'", html)
        self.assertIn("history:[], book_id:activeBookId, scope:searchScope.value, model, pipeline, diagnostics:true", html)
        self.assertIn("latestRegressionReport", html)
        self.assertIn("downloadRegressionReport", html)
        self.assertIn('id="batch-results"', html)
        self.assertIn("Results by model and question", html)
        self.assertIn("schema_version:3", html)
        self.assertIn("entry.summary = data.diagnostics?.summary", html)

    def test_local_reader_uses_live_book_lite_controls_without_cloudflare_check(self):
        html = (APP_PATH.parent / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="/book-lite.css"', html)
        self.assertIn("color:#3e454a", html)
        self.assertIn("background:#262b2f; color:#fff", html)
        self.assertIn("border-radius:2px", html)
        self.assertIn("Local Ollama model", html)
        self.assertIn("Local testing: Ollama", html)
        self.assertNotIn("companion-turnstile", html)
        self.assertNotIn("Cloudflare Turnstile", html)


if __name__ == "__main__":
    unittest.main()
