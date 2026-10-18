"""General source-form diagnostics for the Reading Companion.

An exact PDF reference does not make a table of contents an argument, nor a
character's reported speech the author's view. This module only classifies
visible *form*: navigational front matter vs substantial prose, quotation,
reported claims, and clipped starts. It cannot identify a speaker, infer
chronology, verify a claim, or decide whether an author endorses a position.

These flags may downrank **obvious navigation** and may prompt the model to
read context. They never create quotations or replace an original passage.
No book IDs, names, philosophical topic lists, or benchmark answers appear
in this module.
"""
import re

_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
_DOT_LEADERS = re.compile(r"(?:\.\s*){3,}|(?:·\s*){3,}|(?:[_–-]\s*){7,}")
_CHAPTER_LABEL = re.compile(
    r"^\s*(?:[0-9IVXLC]+\s+)?(?:chapter|contents|table of contents|"
    r"index of|section|book\s+[IVXLC\d]+)\b", flags=re.I
)
_REPORTING = re.compile(
    r"\b(?:according to|(?:he|she|they|we|i)\s+(?:said|say|claimed|argued|"
    r"replied|asked|reported|maintained|asserted|stated)|"
    r"said|asked|replied|claimed|argued|reported|maintained|"
    r"asserted|observed|insisted|declared|answered|"
    r"spoke|the speaker|the narrator|the author|the historian)\b",
    flags=re.I,
)
_SPEECH_QUOTES = re.compile(
    r"[\u201c\u201d\u2018]|\u2019(?=\s|[.,!?;:\)\]])|"
    r"(?:^|\s)[\"'](?=\w)"
)
# An explicit TOC listing often joins many unrelated headings by dashes.
# Require *multiple* list boundaries and a lack of ordinary sentences:
# a scientific paragraph with an em dash must not become "navigation".
_LIST_BOUNDARIES = re.compile(r"(?:\s[—–]\s*|\w[—–](?=[A-Z]))")


def source_form(text):
    """Return observable form and a cautious ranking multiplier.

    Reserve a very low weight for *clear* headings, contents lists and page
    furniture. Legitimate short definitions, original dialogue and important
    one-line claims stay fully eligible. Do not use the weight as a factual
    reliability/entailment score.
    """
    text = str(text or "").strip()
    words = _WORD.findall(text)
    count = len(words)
    plain = re.sub(r"\s+", " ", text)
    has_terminal_sentence = bool(re.search(r'[.!?]["”’)\]]?\s*$', plain))
    n_caps = sum(w.isupper() for w in words if len(w) > 1)
    cap_fraction = n_caps / max(1, sum(len(w) > 1 for w in words))
    leader = bool(_DOT_LEADERS.search(plain))
    label = bool(_CHAPTER_LABEL.match(plain))
    # A complete CONTENTS page can be several hundred words long. The
    # passage splitter later produces windows that no longer contain this
    # heading; classify the parent physical page and inherit its form.
    explicit_contents_page = bool(re.match(
        r"^(?:TABLE OF CONTENTS|CONTENTS|"
        r"BOOK\s+[IVXLC\d]+\s+CHAPTER\s+PAGE)\b",
        plain, re.I
    ))
    list_separators = len(_LIST_BOUNDARIES.findall(plain))
    # A contents entry may end in a single period. What distinguishes it
    # from explanatory prose is a sequence of headings WITHOUT sentence
    # boundaries inside the passage, not its final punctuation.
    internal_sentences = len(re.findall(r"[.!?][\u201d\u2019\"']?\s+(?=[A-Z])", plain))
    multi_item_contents = (
        list_separators >= 3 and internal_sentences == 0
        and (count >= 15 or list_separators >= 5)
    )
    # OCR can scatter punctuation through a table-of-contents line:
    # "STRUGGLE FOR ExIstENCE . . «6 6 + +e ... CHAPTER IV".
    # An explicit chapter numeral in a short NONSENTENCE record is strong
    # evidence of page furniture; chapter references in full prose stay.
    embedded_chapter = bool(re.search(
        r"\bchapter\s+(?:[IVXLC]+|\d+)\b", plain, re.I
    ))
    heading = bool(
        count <= 17 and (
            leader or label or (count >= 3 and cap_fraction >= .70)
            or (embedded_chapter and not has_terminal_sentence)
        ) and not (has_terminal_sentence and count >= 9)
    )
    # Isolated running headers/page labels with no full proposition.
    page_furniture = bool(
        count <= 9 and not has_terminal_sentence and (
            re.match(r"^\d+\s+[A-Z]", plain) or cap_fraction >= .8
        )
    )
    navigation = (explicit_contents_page or heading
                  or page_furniture or multi_item_contents)
    reason = (
        "contents_page" if explicit_contents_page
        else "contents_list" if multi_item_contents
        else "heading_or_page_furniture" if navigation else "original_prose"
    )
    return {
        "kind": "navigation" if navigation else "prose",
        "reason": reason,
        "ranking_multiplier": 0.06 if navigation else 1.0,
        "word_count": count,
    }


def discourse_cues(text):
    """Expose possible attribution risks WITHOUT guessing whose view it is."""
    text = str(text or "").strip()
    quoted = bool(_SPEECH_QUOTES.search(text))
    reported = bool(_REPORTING.search(text))
    fragment = bool(
        text and (
            text[0].islower()
            or text.startswith(("…", "...", "—", "–"))
        )
    )
    # A quotation that starts before the current passage, or opens the
    # passage without a visible reporting verb, needs original context.
    opens_in_speech = bool(re.match(r"^[\u2018\u201c\"']", text))
    unresolved_opening = bool(
        opens_in_speech and not _REPORTING.search(text[:210])
    )
    return {
        "quotation_present": quoted,
        "reported_speech_present": reported,
        "opening_fragment": fragment,
        "opening_quotation_without_attribution": unresolved_opening,
    }


def source_kind(passage):
    """Honor original physical-page classification from the index.

    An isolated split fragment can look like prose even when it lives
    entirely on a labeled contents page. Only a reliably classified parent
    page may override the isolated passage's own form.
    """
    return ("navigation" if passage.get("source_form_kind") == "navigation"
            else source_form(passage.get("text", ""))["kind"])


def asks_for_book_structure(question):
    """Allow chapter titles/contents when readers actually request them."""
    return bool(re.search(
        r"\b(?:chapter titles|table of contents|contents page|"
        r"list the chapters|chapter headings|index entries|"
        r"chapter names|section headings)\b", str(question), re.I
    ))


def curate_candidates(candidates, question, max_results=24):
    """Favor substantive original prose but never erase all available text.

    Source IDs are unchanged even if S3 is removed. Do not silently suppress
    the entire book when its available OCR is thin or the reader explicitly
    asks about the table of contents.
    """
    original = list(candidates[:max_results])
    if asks_for_book_structure(question):
        return original, []
    clean = [p for p in original if source_kind(p) == "prose"]
    # Two real prose candidates are already more useful than adding a
    # heading as purported proof. With one or none, preserve thin/OCR
    # retrieval instead of silently suppressing all available evidence.
    if len(clean) < 2:
        return original, []
    removed = [
        {"source_id": p["source_id"],
         "reason": source_form(p["text"])["reason"],
         "pages": p.get("pages", [])}
        for p in original if source_kind(p) == "navigation"
    ]
    return clean, removed
