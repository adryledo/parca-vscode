# PARCA v0.0.1: Implementation Plan

## Technical Stack & Rationale

| Component | Stack | Reasoning |
| :--- | :--- | :--- |
| **Protocol Engine** | **TypeScript / Node.js** | Required for VS Code extension development. Shared logic between CLI and Extension. High developer velocity. |
| **VS Code Extension** | **VS Code API** | The primary host for resolution, UI discovery, and workspace mapping. |
| **CLI (parca)** | **Node.js (Executable)** | Lightweight wrapper around the Protocol Engine for CI/CD usage. |

> [!NOTE]
> While Go or Rust would offer better single-binary portability for a global CLI, the **Node ecosystem** is the native environment for VS Code. To avoid complex cross-compiliation and dependency on external binaries, we will start with a Pure TypeScript implementation.

---

## Integration Strategy: Workspace Projection

The user wants assets like prompts to work with existing IDE assistants (which scan `.github/prompts/` etc.) without waiting for those assistants to adopt the PARCA protocol.

### The "Mapping" Mechanism
1.  **Resolve**: The Engine downloads the asset from the source to the Central Cache (`~/.parca-cache/`).
2.  **Projection**: The Engine creates a **symbolic link** from the cache to the workspace path (e.g., `.github/prompts/my-prompt.md`).
3.  **Clean Git**: The Engine automatically adds the projected path to `.gitignore` to ensure symlinks aren't committed.

---

## Phased Roadmap

### Phase 1: Protocol Prototype (Alpha)
- [ ] **CLI Commands**:
  - `parca list-remote <url> [--kind <type>]`: Lists available assets from any PARCA-compliant source repository. Valid types: `prompt`, `skill`, `instruction`.
  - `parca install <url> <asset-id>`: 
    - Fetches the manifest from `<url>`.
    - Automatically adds the source to `.parca-assets.yaml` if missing.
    - Adds the asset entry.
    - **Calls `resolve` automatically.**
  - `parca list`: Lists currently installed assets in the project workspace.
  - `parca resolve`: Explicitly fetches manifests, downloads to cache, and refreshes symlinks.
- [ ] **Core Engine**: Manifest fetching (GitHub/Azure REST APIs) and SemVer resolution.
- [ ] **Workspace Mapper**: Symlink creation logic and `.gitignore` automation.
- [ ] **Lockfile Implementation**: Generation and verification.

### Phase 2: VS Code User Experience & Source-Side Tooling
- [ ] **Consumer UI Improvements**:
  - [ ] **Version Picker**: Show dropdown of available versions during installation. <!-- COMPLETED IN CODE -->
  - [ ] **Explorer View**: Tree view showing active assets and their mapping status.
- [ ] **Source-Side Tooling (Maintainer)**:
  - [ ] **`PARCA: Publish Asset Version`**: Command that helps maintainers:
    - Auto-detect changes in assets.
    - Propose SemVer increment.
    - **Checkpointing**: Auto-fill the `ref` of the *previous* version with the current commit SHA to "freeze" it before adding the new rolling version.
    - Automatically update `parca-manifest.yaml`.
    - Stage changes for Git commit.
  - [ ] **Manifest Scaffolding**: Command to initialize a Source Repository with a correct manifest.
- [ ] **Diagnostics**: Red squiggles in `.parca-assets.yaml` for invalid versions or missing assets.
- [ ] **Agent Skills Alignment**:
  - Update default mapping for `skill` kind to `.agent/skills/${assetId}/SKILL.md`.
  - Ensure compatibility with directory-based assets (recursive fetch for skills).

### Phase 3: Robustness & Scaling
- [ ] **Transitive Dependencies**: Graphic resolution.
- [ ] **Universal Hashing**: LF-normalized SHA-256 for cross-platform lockfile consistency.
- [ ] **Caching**: Intelligent eviction and multi-user machine cache.

### Phase 4: Expansion
- [ ] **LM Tool Integration**: For assistants that support tool-calling.
- [ ] **Sigstore / OIDC Verification**: To ensure asset authenticity.
- [ ] **Discovery UI**: Visual gallery of available assets from known sources.

---

## Verification Plan

### Automated Tests
- Test resolution against mock Git repositories.
- Verify SHA-256 consistency across different OS line endings.
- Unit tests for SemVer range matching.

### Manual Verification
- Verify the VS Code extension correctly identifies and installs assets in a test consumer repo.
- Verify discovery UI displays assets from a remote manifest.
