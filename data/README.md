# Local book data

The chatbot source repository excludes compressed book text. The authoritative
extracted corpus lives in the separate `antilogicalism-library-data` repository.

For this Aristotle pilot, the app looks first for
`../antilogicalism-library-data/data-v47/book-7.json.gz` relative to this
project. Set `BOOK_CHATBOT_LIBRARY_DATA` to the data repository folder and
`BOOK_CHATBOT_DATA_VERSION` to the chosen dataset version if the folders are
not siblings or OCR work publishes a newer version. `BOOK_CHATBOT_BOOK_FILE`
can point directly to one corpus shard when testing a staged file.

The `book-7.json.gz` file included in the local pilot ZIP is a convenience copy
for testing. It is ignored by Git so this code repository does not become a
second source for the library text.
