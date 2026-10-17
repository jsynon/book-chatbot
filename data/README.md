# Local book data

The chatbot source repository excludes compressed book text. The authoritative
extracted corpus lives in the separate `antilogicalism-library-data` repository.

For this Aristotle pilot, the app defaults to
`../antilogicalism-library-data/data-v47/book-7.json.gz` relative to this
project. Set `BOOK_CHATBOT_LIBRARY_DATA` to the data repository folder and
`BOOK_CHATBOT_DATA_VERSION` to the chosen dataset version if the folders are
not siblings or OCR work publishes a newer version. `BOOK_CHATBOT_BOOK_ID`
can select another numeric catalog shard, while `BOOK_CHATBOT_BOOK_TITLE` and
`BOOK_CHATBOT_PDF_FILE_ID` configure its displayed title in prompts and its
Google Drive preview links. `BOOK_CHATBOT_BOOK_FILE` can point directly to one
corpus shard when testing a staged file.

This is developer configuration for one book per app run. The visible page and
its five regression prompt buttons still describe the Aristotle pilot; this
does not add a book picker or make the interface a full-library product.

The `book-7.json.gz` file included in the local pilot ZIP is a convenience copy
for testing. It is ignored by Git so this code repository does not become a
second source for the library text.
