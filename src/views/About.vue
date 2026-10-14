<template lang="pug">
main
  h1 About PeakActivity
  p An independent ActivityWatch derivative for personal activity insights.
  dl
    dt Build status
    dd Development preview
    dt Web interface revision
    dd {{ COMMIT_HASH || 'development' }}
  h2.h5 Source and license
  p ActivityWatch-derived source retains its Mozilla Public License 2.0 terms and author notices.
  p PeakActivity is not affiliated with or endorsed by ActivityWatch or its maintainers.
  p #[a(href="./LICENSE.txt" target="_blank" rel="noopener noreferrer") Read the Mozilla Public License 2.0]
  h2.h5 Current limitations
  p Default encrypted storage and production service connections are not yet available in this development preview.
  p Experimental local release bundle verification is implemented. Production verification trust is not configured. Verified update delivery and installation remain unavailable.
  p A verified support or security reporting channel has not yet been configured. Do not share real activity or credentials in public reports.
</template>
