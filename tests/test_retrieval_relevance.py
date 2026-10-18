"""Deterministic v1.4.1 relevance regression tests from real failure modes.

These rules operate on actual catalog author fields and source text. There is
no per-book answer table, no invented citation and no extra model call.
"""
import unittest

import app
from retrieval_relevance import (
    canonical_author, content_terms, named_author_groups, passage_topic_score
)
from whole_library import WholeLibraryLocator


def book(book_id, author, title="Example Work"):
    return {"book_id": str(book_id), "author": author,
            "title": title, "work_title": title, "subjects": []}


class QueryRelevanceTests(unittest.TestCase):
    def setUp(self):
        self.entries = {
            "7": book(7, "Aristotle", "Nicomachean Ethics"),
            "12": book(12, "Aristotle", "Politics"),
            "293": book(293, "Aristotle", "The Works of Aristotle"),
            "88": book(88, "Leo Tolstoy", "A Confession"),
            "258": book(258, "Leo Tolstoy", "War and Peace"),
            "493": book(493, "Various authors (edited by F. Max Müller)"),
            "546": book(546, "Various Authors"),
            "283": book(283, "Anonymous"),
        }

    def test_generic_authors_do_not_create_false_named_author_requirement(self):
        query = ("How do different authors in the library approach "
                 "the question of life's meaning?")
        self.assertEqual(named_author_groups(query, self.entries), [])
        self.assertEqual(content_terms(query, app.tokenize), ["life", "meaning"])
        self.assertEqual(canonical_author("Various authors"), "")
        self.assertEqual(canonical_author("Various authors (edited by Someone)"), "")
        self.assertEqual(canonical_author("Anonymous"), "")

    def test_explicit_names_resolve_to_all_works_for_each_author(self):
        groups = named_author_groups(
            "Compare Aristotle and Tolstoy on the good life", self.entries
        )
        self.assertEqual(len(groups), 2)
        by_author = {g["author"]: set(g["book_ids"]) for g in groups}
        self.assertEqual(by_author["aristotle"], {"7", "12", "293"})
        self.assertEqual(by_author["leo tolstoy"], {"88", "258"})
        self.assertEqual(
            content_terms("How do Aristotle and Tolstoy understand happiness "
                          "and the good life?", app.tokenize, groups),
            ["happiness", "good", "life"],
        )

    def test_book_title_and_generic_byline_cannot_impersonate_author(self):
        self.assertEqual(named_author_groups(
            "How do authors approach Aristotle's question?",
            {"493": self.entries["493"]}), [])
        self.assertEqual(canonical_author("Aristotle (edited by W. D. Ross)"),
                         "aristotle")

    def test_surname_collisions_are_not_implicitly_resolved(self):
        entries = {
            "1": book(1, "John Smith"),
            "2": book(2, "Mary Smith"),
        }
        self.assertEqual(named_author_groups("What does Smith say?", entries), [])
        result = named_author_groups("Compare John Smith and Mary Smith", entries)
        self.assertEqual({x["author"] for x in result},
                         {"john smith", "mary smith"})

    def test_new_topic_is_not_limited_to_philosophy_keyword_list(self):
        self.assertEqual(
            content_terms("What do the books say about photosynthesis?",
                          app.tokenize), ["photosynthesis"])
        self.assertEqual(
            content_terms("Compare approaches to parliamentary sovereignty",
                          app.tokenize), ["parliamentary", "sovereignty"])

    def test_close_related_concepts_beat_far_apart_word_occurrences(self):
        close, count = passage_topic_score(
            "The meaning of life involves shared human purposes and action.",
            ["meaning", "life"], app.tokenize)
        far, other = passage_topic_score(
            "This glossary gives the meaning of every term." +
            " Several unrelated observations concern grammar and law." * 25 +
            " Life can also be discussed elsewhere.",
            ["meaning", "life"], app.tokenize)
        self.assertEqual(count, 2)
        self.assertEqual(other, 2)
        self.assertGreater(close, far)
        one, coverage = passage_topic_score(
            "Life is described in detail, but no additional topic occurs.",
            ["meaning", "life"], app.tokenize)
        self.assertEqual(coverage, 1)
        self.assertGreater(close, one)

    def test_two_named_authors_get_balanced_book_slots(self):
        locator = WholeLibraryLocator.__new__(WholeLibraryLocator)
        scored = {
            "293": {"score": 18, "matches": 100, "author": "aristotle",
                    "max_concepts": 3},
            "7": {"score": 16, "matches": 35, "author": "aristotle",
                  "max_concepts": 3},
            "12": {"score": 14, "matches": 33, "author": "aristotle",
                   "max_concepts": 2},
            "258": {"score": 17, "matches": 180, "author": "leo tolstoy",
                    "max_concepts": 3},
            "88": {"score": 12, "matches": 12, "author": "leo tolstoy",
                   "max_concepts": 2},
        }
        groups = [
            {"author": "aristotle", "book_ids": ["7", "12", "293"]},
            {"author": "leo tolstoy", "book_ids": ["88", "258"]},
        ]
        chosen, required = locator._select_books(scored, groups, 4)
        self.assertEqual(set(chosen), {"293", "7", "258", "88"})
        self.assertEqual(len(required), 2)
        self.assertEqual({g["author"] for g in required},
                         {"aristotle", "leo tolstoy"})
        self.assertEqual(sorted(map(len, (g["book_ids"] for g in required))),
                         [2, 2])

    def test_broad_query_favors_distinct_named_authors_over_four_anthologies(self):
        locator = WholeLibraryLocator.__new__(WholeLibraryLocator)
        scored = {
            "493": {"score": 19, "matches": 230, "author": "",
                    "max_concepts": 2},
            "546": {"score": 18, "matches": 180, "author": "",
                    "max_concepts": 2},
            "7": {"score": 17, "matches": 60, "author": "aristotle",
                  "max_concepts": 2},
            "88": {"score": 15, "matches": 15, "author": "leo tolstoy",
                   "max_concepts": 2},
            "10": {"score": 14, "matches": 12, "author": "author three",
                   "max_concepts": 2},
            "11": {"score": 13, "matches": 11, "author": "author four",
                   "max_concepts": 2},
        }
        chosen, groups = locator._select_books(scored, [], 4)
        self.assertEqual(chosen, ["7", "88", "10", "11"])
        self.assertFalse(groups)

    def test_broad_query_prefers_multi_concept_pages(self):
        locator = WholeLibraryLocator.__new__(WholeLibraryLocator)
        scored = {
            "7": {"score": 18, "matches": 35, "author": "aristotle",
                  "max_concepts": 1},
            "88": {"score": 13, "matches": 10, "author": "leo tolstoy",
                   "max_concepts": 2},
            "258": {"score": 12, "matches": 18, "author": "leo tolstoy",
                    "max_concepts": 1}
        }
        chosen, _ = locator._select_books(scored, [], 4)
        self.assertEqual(chosen, ["88"])


if __name__ == "__main__":
    unittest.main()
