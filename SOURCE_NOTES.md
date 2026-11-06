# Source notes

This package contains the UNSPOKEN game from the colorful redesign, including its original game engine, question/vote cryptography, responsive styling, sound effects and game components.

The export replaces the ChatGPT Sites / Cloudflare D1 hosting wrapper with a standard Next.js API and Neon PostgreSQL storage adapter so the frontend and backend can run together on the owner's Vercel project. It does not depend on the old deployed site.

The game engine and cryptographic protocol were preserved. Shared database updates still use a revision compare-and-swap. Synchronization is one-second polling of the authoritative API, not WebSockets.

The original source revision was `57897686a03013c450cabcd852e73357ceceb872`. Hosting-specific starter components, development metadata, account credentials, build caches, source-control metadata and runtime game records are excluded from this export. Font assets and their license files are included.

See `TESTING.md` for the checks performed on this portable export. Hosting and database accounts must be configured by the person deploying it.
