# PARCA v0.0.1 Walkthrough

We have successfully built the foundation (Phase 1) and the maintainer workflow (Phase 2) of the **Protocol of Asset Resolution for Coding Agents (PARCA)**.

## 🚀 Accomplishments

### 1. The Core Engine (Phase 1)
- **Resolution Flow**: Implemented manifest fetching, version resolution (including SemVer support), and file downloading.
- **Dynamic Caching**: Assets are cached in `~/.parca-cache/` with LF-normalized SHA-256 validation.
- **Deterministic Locking**: Produced `.parca-assets.lock` to ensure permanent immutability, even if the source's `main` branch changes.
- **Workspace Projection**: Automatic symlinking of assets into locations like `.github/prompts/` and auto-management of `.gitignore`.
- **Integrity & Pinnning**:
    - `resolveAll` now respects the **Lockfile Commit SHA**, ensuring that a repo doesn't break if the remote branch moves.
    - **`PARCA: Update Asset`**: A manual command to explicitly move an asset to the latest commit on the source's `main` branch.

### 2. The Maintainer Workflow (Phase 2)
- **Registry-as-Truth**: Removed the need for complex Git tags. The manifest on the source repo's `main` branch acts as the registry.
- **`PARCA: Publish Asset Version`**: A new command that enables maintainers to easily add new versions, auto-incrementing SemVer, and updating the manifest.
- **Version Picker**: Consumers can now explicitly select which version of an asset to install during the flow.
- **Checkpointing**: When publishing a new version, the system automatically pins the previous version to the current HEAD commit, ensuring old versions are frozen.

### 3. Authentication & Security
- **VS Code Integration**: Uses VS Code's built-in GitHub authentication when available, providing a seamless sign-in experience.
- **Fallback Support**: If VS Code auth is unavailable, falls back to environment variables (`GITHUB_TOKEN`, `AZURE_DEVOPS_PAT`, `PARCA_TOKEN`).
- **Rate Limit Protection**: Authenticated requests get higher GitHub API rate limits, preventing 403 errors during resolution.

## 🛠️ Testing & Verification

### Compilation
The entire codebase compiles with zero errors using `npx tsc`.

### Architectural Alignment
- **Vendor Neutrality**: The protocol uses vendor-neutral filenames like `.parca-assets.yaml` and `parca-manifest.yaml`.
- **Runtime Compatibility**: The spec supports the `runtime` field to specify model/agent compatibility (Phase 3 expansion).

## 📄 Documentation Sync
- [protocol_v1.md](file:///protocol_v1.md): Updated with the "Dynamic Registry" and "Tag Templating" strategies.
- [implementation_plan.md](file:///implementation_plan.md): Approved and synced.

---

### Ready for Next Steps:
We are now ready to progress to **Phase 3: Robustness & Scaling**, which includes transitive dependencies and universal hashing verification.
