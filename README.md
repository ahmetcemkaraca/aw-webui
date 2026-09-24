# PeakActivity web interface

A local Vue interface derived from ActivityWatch, under the Mozilla Public
License 2.0. PeakActivity is independent and is not endorsed by ActivityWatch.
Upstream copyright and author notices remain intact.

This component is a development candidate. It does not establish a production
release, default encrypted storage, supported mobile capture or a verified update
service. The interface contains no upstream release poll or satisfaction survey.

## Development

Use the lockfile and an isolated local server with synthetic activity. Do not
connect development builds to another person's data.

```sh
npm ci
make dev
```

The development interface expects the testing server on port 5666 by default.
Protected API access must be opened inside the PeakActivity desktop WebView so
the native IPC can authorize it. A standalone browser deliberately cannot recover
credentials from URLs or browser storage.
For a static build, run `make build`. The build copies the source license and
includes the original editable SVG documented in [ASSETS.md](ASSETS.md).

The existing Jest tests run with `npm test`; component tests are under `test/unit`.
Platform acceptance is separate from those checks. No upstream donation, support
or download channel represents this fork.
