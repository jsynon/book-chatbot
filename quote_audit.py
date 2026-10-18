"""Cautious verbatim-quotation audit for displayed primary-source claims.

Structural citations do not certify meaning. This verifier detects one more
observable error: presented quotation text that is not a continuous phrase
in the ORIGINAL cited passage(s). It cannot tell if a quote is misleading,
translated inaccurately, spoken by a different character, or drawn from a
different edition. It does not rewrite the model's prose or fabricate text.
"""
import re
import unicodedata

# Only complete double-quoted spans that assert a reasonably long quotation.
# Single apostrophes and short scare-quoted concepts are not reliable quotes.
_QUOTATIONS = re.compile(r'“([^”]{20,500})”|"([^"]{20,500})"')


def normalized_words(text):
    text = unicodedata.normalize("NFKC", str(text)).casefold()
    text = text.replace("\u00ad", "")
    # Fold OCR end-of-line word splitting but never change word identity.
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return " ".join(re.findall(r"\w+", text, re.UNICODE))


def audit_quotes(output, selected):
    """Check quoted sequences against only that paragraph's cited passages."""
    by_id = {p["source_id"]: p["text"] for p in selected}
    findings = []
    for position, paragraph in enumerate(output.get("paragraphs", []), 1):
        if not isinstance(paragraph, dict):
            continue
        text = paragraph.get("text", "")
        if not isinstance(text, str):
            continue
        ids = paragraph.get("source_ids")
        if not isinstance(ids, list):
            continue
        sources = [normalized_words(by_id[s])
                   for s in ids if s in by_id]
        for match in _QUOTATIONS.finditer(text):
            original = match.group(1) or match.group(2)
            words = normalized_words(original)
            if len(words.split()) < 6:
                continue
            supported = any(words in source for source in sources)
            findings.append({
                "paragraph": position,
                "quotation": original[:180],
                "source_ids": [s for s in ids if s in by_id],
                "verbatim_found": supported,
            })
    unmatched = [p for p in findings if not p["verbatim_found"]]
    return {
        "status": "unmatched_quote_warning" if unmatched else
                  "no_unmatched_long_quotes",
        "quoted_spans_checked": len(findings),
        "unmatched_count": len(unmatched),
        "unmatched": unmatched,
        "semantic_verification": False,
    }
