# Releasing

This repository uses **semantic-release** in CI to publish version tags and container images.

## Triggering a patch release

A patch release is triggered by a Conventional Commit of type `fix` being merged into `main`.

If CI ran but no release was produced (e.g. after manual workflow changes), you can create a minimal follow-up PR with a commit message like:

- `fix(release): trigger patch release`

This PR should only contain non-functional changes (documentation/metadata) so it is safe to merge.
