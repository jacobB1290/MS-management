#!/bin/sh
# Production build + serve for the harness. The `exec` is load-bearing: the
# server process REPLACES this shell, so Playwright's teardown kills the real
# server. A `build && start` npm chain instead leaves the server as an
# orphanable grandchild — a later run then "reuses" that stale server and
# screenshots an old build (it happened; the screenshots lied).
#
# Set HARNESS_SKIP_BUILD=1 to iterate against the already-built .next, or
# leave `npm run dev` running — reuseExistingServer picks it up instead.
set -e
if [ -z "$HARNESS_SKIP_BUILD" ]; then
  node node_modules/next/dist/bin/next build
fi
exec node node_modules/next/dist/bin/next start
