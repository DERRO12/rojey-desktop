# Publishing an update

Every till with version 2.5.0 or newer checks
`https://api.github.com/repos/DERRO12/rojey-desktop/releases/latest` about every 10 minutes. When it finds a newer version, it downloads that release's `RojeyPOS-Setup-<version>.exe`.

1. Raise `version` in `package.json`, for example `2.5.1`.
2. Build:
   ```
   npx electron-builder --win portable --x64
   sh installer/build-installer.sh
   ```
3. Create a GitHub release:
   - The tag is `v<version>`, for example `v2.5.1`.
   - Attach `dist/RojeyPOS-Setup-<version>.exe` (the name must start with `RojeyPOS-Setup-`).
   - The portable exe can be attached too.
   - Mark the release as the latest. Drafts and pre-releases are ignored.

   With the GitHub CLI:
   ```
   gh release create v2.5.1 dist/RojeyPOS-Setup-2.5.1.exe dist/RojeyPOS-Portable-2.5.1.exe --title "Rojey POS 2.5.1" --notes "What changed"
   ```

The download is checked before installing:
- the size must match;
- the SHA-256 must match GitHub's asset digest, or a `sha256: <hex>` line in the release notes.

The update then installs by itself when nobody is signed in or when the app closes. Admins can also install at once with the update button. Data in `%APPDATA%\Rojey POS` is never touched.
