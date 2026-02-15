/**
 * PARCA - Protocol of Asset Resolution for Coding Agents
 * Core type definitions.
 */

// --- Asset Types ---

export type AssetKind = 'prompt' | 'skill' | 'instruction';

// --- Consumer Config (.parca-assets.yaml) ---

export interface ParcaConfig {
    schema: string;
    sources: Record<string, ParcaSource>;
    assets: ParcaAssetEntry[];
}

export interface ParcaSource {
    type: 'git';
    provider: 'github' | 'azure';
    url: string;
}

export interface ParcaAssetEntry {
    id: string;
    source: string;
    version: string;
    mapping?: string;
}

// --- Source Manifest (parca-manifest.yaml) ---

export interface ParcaManifest {
    schema: string;
    versionStrategy?: {
        template?: string;
    };
    assets: Record<string, ParcaManifestAsset>;
}

export interface ParcaManifestAsset {
    kind: AssetKind;
    description?: string;
    versions: Record<string, ParcaManifestVersion>;
}

export interface ParcaManifestVersion {
    ref?: string;
    path: string;
    runtime?: ParcaRuntime;
}

export interface ParcaRuntime {
    llm?: Array<{ provider: string; models: string[] }>;
    min_context_tokens?: number;
    requires_tools?: boolean;
}

// --- Lockfile (.parca-assets.lock) ---

export interface ParcaLockfile {
    assets: ParcaLockedAsset[];
}

export interface ParcaLockedAsset {
    id: string;
    version: string;
    source: string;
    commit: string;
    sha256: string;
    manifestHash: string;
    resolvedAt: string;
}

// --- Resolution Results ---

export interface ResolvedAsset {
    id: string;
    version: string;
    source: string;
    commit: string;
    sha256: string;
    content: string;
    cachePath: string;
    mapping?: string;
}

// --- Remote Listing ---

export interface RemoteAssetInfo {
    id: string;
    kind: AssetKind;
    description: string;
    latestVersion: string;
    versions: string[];
    resolvedCommit?: string; // The commit SHA where this version was discovered (added during resolution)
}
