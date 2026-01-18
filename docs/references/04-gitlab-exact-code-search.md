# GitLab Exact Code Search

- Source: https://about.gitlab.com/blog/exact-code-search-find-code-faster-across-repositories/
- Type: blog

## Summary
- Describes GitLab's exact and regex search built on Zoekt.
- Highlights regex acceleration via trigram-style candidate generation.
- Focuses on cross-repo search and fast response times.

## PairOfCleats takeaways
- Add regex-to-ngram prefilters to reduce full scans.
- Make cross-repo search cheap by reusing common index artifacts.
