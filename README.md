# Antilogicalism Book Chatbot Pilot

This local prototype lets you ask questions about Aristotle's *Nicomachean Ethics*. It searches extracted book text, asks a local Ollama model to explain the passages it finds, and links each answer to the cited PDF pages. The larger goal is to make the same retrieval and evidence-checking system work across the Antilogicalism library.

## Start it on Windows

1. Make sure the Ollama app is running. The default model is `qwen3:4b`, which you already use for The Eternal Dialogue. If it is not installed, install it through Ollama first.
2. Extract this ZIP to a folder on your computer. For repository development, keep it beside your `antilogicalism-library-data` checkout when possible.
3. Double-click `start.bat`.
4. The page opens at `http://127.0.0.1:8765`. Close the command window when you are done; that stops the local app.

The app uses only Python's standard library. It does not need a pip install or an API key. You can choose any model listed by your local Ollama service from the model dropdown.

## What this pilot tests

- Can it retrieve relevant page passages from a real book?
- Can the local model explain and synthesize those passages?
- Are citations useful and do the PDF page links take you to the right place?
- Do follow-up questions keep enough conversational context?

The retriever splits all 127 PDF pages into short passages, includes nearby text from the same paragraph to preserve context, and ranks passages with BM25. It compares meaningful-word coverage before deciding whether to use the selected local model for search-term expansion; those terms improve retrieval only and are never treated as evidence. A second local-model pass checks the draft against the retrieved passages, revises unsupported claims, distinguishes reported positions from the author's response, consolidates repeated points, and assigns a small, selective set of source IDs to each answer sentence before the app formats citations. The source links shown under an answer correspond only to passages cited in that answer. Questions asking what an author would think about a hypothetical or later issue are labeled as interpretations or inferences, since the book cannot directly settle those questions. This extra evidence check can add response time. There are no question-specific page anchors or prewritten answers. This is still an early pilot, so check the linked passages when an answer matters and try a different phrasing if retrieval misses the topic.

## Repository and book data

The chatbot code is separate from [`antilogicalism-library-data`](https://github.com/jsynon/antilogicalism-library-data), which remains the source of truth for extracted library text. The code prefers the Aristotle shard at `../antilogicalism-library-data/data-v47/book-7.json.gz` when that sibling checkout exists. It falls back to the small `data/book-7.json.gz` copy used by the pilot ZIP.

You can select another local data checkout or dataset version without editing the code:

```bat
set BOOK_CHATBOT_LIBRARY_DATA=D:\Downloads\antilogicalism-library-data
set BOOK_CHATBOT_DATA_VERSION=v47
```

For a staged corpus file, set `BOOK_CHATBOT_BOOK_FILE` to its full path. The Git repository ignores compressed book shards and local index files, so extracted books and generated search data are not committed alongside the application. The chatbot currently loads only Aristotle's shard; connecting the complete library is a later architecture step.

This app calls Ollama on the same computer and contains no hosted AI API key. Do not commit credentials, private PDFs, or extracted text files.

The page footer displays the running server's build ID. The health endpoint at `/api/health` returns the same ID, which helps confirm the browser is connected to the expected local server.

To run the local retrieval and citation checks during development, open a command prompt in this folder and run `py -3 -m unittest discover -s tests -v`.

## Privacy and scope

The server binds only to `127.0.0.1`, so it is available on this computer and is not published on the internet. Questions and retrieved passages go to Ollama on this same computer. No hosted AI service is called. This pilot includes only one book and is separate from the live website.

The bundled compressed text is from `antilogicalism-library-data/data-v47/book-7.json.gz`. The source book link is included with the citations.
