# Releasing XDraw

XDraw uses semantic versioning and Release Please.

1. Merge changes into `main` using Conventional Commit prefixes:
   - `fix:` for a patch release.
   - `feat:` for a minor release.
   - `feat!:` or a `BREAKING CHANGE:` footer for a major release.
2. Release Please creates or updates the release pull request.
3. Review its version, changelog, and passing checks.
4. Merge the release pull request.

The release workflow then creates the version tag and GitHub release. Do not
create the tag manually.

Repository Actions settings must allow workflows to create pull requests.
