# Antilogicalism Reading Companion

The Antilogicalism Reading Companion is an experiment in making the ideas in books easier to explore. It lets readers ask questions in ordinary language, get an answer grounded in passages from a book, and follow citations back to the relevant PDF pages.

## Part of the Antilogicalism project

[Antilogicalism](https://antilogicalism.com/) brings together essays, reading resources, and a growing library of books for exploring philosophy and related subjects. The Reading Companion adds a conversational way to enter that library: readers can ask about a concept, trace an argument through a text, or use citations to return to the original passage. Its purpose is to support close reading and further thought, not to replace the books or the broader site.

Book text is maintained separately in the [`antilogicalism-library-data`](https://github.com/jsynon/antilogicalism-library-data) repository. Keeping the corpus there gives the library one shared source of truth as it grows. The companion is a separate application that can use those texts to find passages and build answers.

## Current prototype

The current pilot works with Aristotle's *Nicomachean Ethics*. It is a step toward the larger goal of making the same reading experience work across the Antilogicalism book collection; it is not yet connected to the full library. The project is testing whether a locally run language model can answer a range of questions while keeping its claims connected to passages readers can inspect.

The app searches the book text, drafts a response from relevant passages, and checks the response's claims and quotations before displaying citations. These checks can catch some unsupported claims, but they cannot guarantee that every interpretation is correct. Readers should use the source links to check context, especially when an answer explains a complicated argument or connects ideas across passages.

## Run locally

1. Install [Ollama](https://ollama.com/) and download a model, for example with `ollama pull qwen3:4b`.
2. Extract this project. To use a separate `antilogicalism-library-data` checkout, place it beside the project folder or configure the data path as described in [`data/README.md`](data/README.md).
3. Start Ollama, then double-click `start.bat`.
4. Open `http://127.0.0.1:8765` in your browser and choose an installed model.

The app uses Python's standard library and does not require a hosted AI API key. It listens only on the local computer and sends questions and retrieved passages to Ollama running there. It is a local research prototype, not an online chatbot.

## Development

Run the retrieval and citation checks from the project folder:

```bat
py -3 -m unittest discover -s tests -v
```
