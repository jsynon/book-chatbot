# Antilogicalism Reading Companion

An experimental, locally run AI reading companion for exploring books in the Antilogicalism library. Ask a question about a book and the app retrieves relevant passages, generates an answer with a local language model, and links its citations to the source PDF pages. The aim is to make a large collection of texts easier to explore while keeping the books themselves close at hand.

## Why this project

The Antilogicalism library brings together books that readers may want to compare, revisit, and think through across chapters. A conversational interface offers another way into that collection: readers can ask about an idea, request an explanation of an argument, or follow a concept through the text. Answers are meant to guide readers back to the books, not replace reading them.

## Current stage

This is an early prototype using Aristotle's *Nicomachean Ethics*. It currently answers from that one book; it is not yet connected to the full library. The project is testing whether a small local model can answer varied questions with useful, verifiable citations before expanding the same approach to more books.

AI answers can misread or oversimplify a passage. Follow the source links to check the context, especially for questions that ask the chatbot to connect ideas or explain an argument.

## How it works

The Python app searches extracted page text and ranks relevant passages with BM25, a term-based relevance method. When the initial results seem like a weak match, the selected local model can suggest additional search terms; those terms help find passages but are not treated as evidence. The model drafts an answer from the retrieved text, and a second pass checks its claims and citations against those passages. The interface links only to sources cited in the answer.

The prototype uses general retrieval and evidence-checking rather than prewritten answers or question-specific page rules. This makes the current book a test case for a system intended to grow with the library.

## Run locally on Windows

1. Install [Ollama](https://ollama.com/) and download a model, such as `qwen3:4b`, with `ollama pull qwen3:4b`.
2. Extract the project ZIP. For development with the shared corpus, place this folder beside your `antilogicalism-library-data` checkout.
3. Make sure Ollama is running, then double-click `start.bat`.
4. Open `http://127.0.0.1:8765` in your browser. The model menu lists the models available in your local Ollama installation.

The app uses Python's standard library, so it needs no `pip` installation or hosted AI API key. Close the command window to stop the local server.

## Book data and privacy

Extracted text is maintained in the separate [`antilogicalism-library-data`](https://github.com/jsynon/antilogicalism-library-data) repository, which remains the source of truth. The app looks for the Aristotle pilot shard in a sibling data checkout and includes a small convenience copy for running the standalone prototype. Instructions for selecting another local checkout or dataset version are in [`data/README.md`](data/README.md).

The server listens only on this computer (`127.0.0.1`) and sends questions and retrieved passages to Ollama running locally. The chatbot does not call a hosted AI service and is not currently deployed online. It is a research prototype and currently includes only one book.

## Development

To run the retrieval and citation checks, open a command prompt in the project folder and run:

```bat
py -3 -m unittest discover -s tests -v
```

The build identifier appears in the app footer and at `/api/health`, which helps confirm which local server version is running.
