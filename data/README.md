# Local book data

The source repository does not contain the full extracted book corpus. The authoritative corpus is maintained in the separate `antilogicalism-library-data` repository.

The local app has two related data uses:

- **Default book configuration:** Aristotle, catalog ID `7`, dataset version `v48`. Its shard is `data-v48/book-7.json.gz` under the data repository. `BOOK_CHATBOT_BOOK_ID`, `BOOK_CHATBOT_BOOK_TITLE`, and `BOOK_CHATBOT_PDF_FILE_ID` configure the default/fallback book identity and display links. `BOOK_CHATBOT_BOOK_FILE` can point directly to a staged shard for a focused test.
- **Library-wide local search:** the page can search across the Antilogicalism library or constrain search to one selected book. The library catalog and shard discovery come from the separate data checkout; the corpus is not bundled into this code repository. `BOOK_CHATBOT_LIBRARY_DATA` points to the data repository when it is not at the expected sibling path, and `BOOK_CHATBOT_DATA_VERSION` selects the corpus version (default `v48`).

The page's book picker and `/api/books` endpoint expose the available local catalog. Selecting one book scopes that request; it does not change the production website or deployed Worker. The default book ID is a fallback/configuration value, not a limit that makes the local app a one-book-only interface.

The `book-7.json.gz` file included in the local pilot ZIP is a convenience copy for testing. It is ignored by Git so this code repository does not become a second source for the library text. Do not commit corpus shards or generated evaluation transcripts here.
