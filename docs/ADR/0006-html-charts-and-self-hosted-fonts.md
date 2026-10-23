# ADR-0006 — HTML charts, self-hosted fonts

**Status:** accepted

**Context.** The brand colours failed a colour-vision validation as a categorical palette, and
inline chart libraries complicate a strict CSP. `next/font/google` failed in development on this
machine (path with spaces) and needs network at build time.

**Decision.** Charts are single-series HTML bars/columns with direct value labels (readable as
tables, no client JS). Fonts (Plus Jakarta Sans, Chakra Petch) are bundled from `@fontsource`.
