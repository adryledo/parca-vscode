/**
 * PARCA - AssetResolver (Core Engine)
 * Orchestrates: manifest fetch → version resolution → file download → cache → symlink.
 */
import * as semver from 'semver';
import { ConfigLoader } from './configLoader';
import { ManifestResolver } from './manifestResolver';
import { GitProvider } from './gitProvider';
import { CacheManager } from './cacheManager';
import { LockfileManager } from './lockfileManager';
import { WorkspaceMapper } from './workspaceMapper';
import {
    ParcaConfig, ParcaManifest, ParcaAssetEntry,
    ParcaLockedAsset, ResolvedAsset, RemoteAssetInfo, AssetKind,
} from './types';

export interface ResolveProgress {
    onAssetStart?: (id: string, version: string) => void;
    onAssetDone?: (id: string, version: string) => void;
    onAssetError?: (id: string, error: string) => void;
}

export class AssetResolver {
    private configLoader: ConfigLoader;
    private manifestResolver: ManifestResolver;
    private cacheManager: CacheManager;
    private lockfileManager: LockfileManager;
    private workspaceMapper: WorkspaceMapper;

    constructor(private workspaceRoot: string) {
        this.configLoader = new ConfigLoader(workspaceRoot);
        this.manifestResolver = new ManifestResolver();
        this.cacheManager = new CacheManager();
        this.lockfileManager = new LockfileManager(workspaceRoot);
        this.workspaceMapper = new WorkspaceMapper(workspaceRoot);
    }

    // ---- List Remote ----

    /** List assets from a remote source URL, optionally filtered by kind. */
    async listRemote(url: string, kindFilter?: AssetKind): Promise<RemoteAssetInfo[]> {
        const provider = ConfigLoader.inferProvider(url);
        const git = await this.createGitProvider(provider, url);

        // Resolve 'main' to get the current "Registry State"
        const registryCommit = await git.resolveRef('main');
        const manifest = await this.manifestResolver.fetchManifest(git, registryCommit);

        return this.manifestResolver.listAssets(manifest, kindFilter).map(a => ({
            ...a,
            resolvedCommit: registryCommit
        }));
    }

    // ---- Install ----

    /** Install an asset from a remote source URL. Adds to config and resolves. */
    async install(url: string, assetId: string, versionRange: string = 'latest', forceReinstall: boolean = false): Promise<ResolvedAsset | { existing: ParcaAssetEntry; selectedVersion: string }> {
        const provider = ConfigLoader.inferProvider(url);
        const git = await this.createGitProvider(provider, url);

        // 1. Fetch manifest from 'main' (the Dynamic Registry)
        const registryCommit = await git.resolveRef('main');
        const manifest = await this.manifestResolver.fetchManifest(git, registryCommit);

        if (!manifest.assets[assetId]) {
            const available = Object.keys(manifest.assets).join(', ');
            throw new Error(`Asset "${assetId}" not found in manifest. Available: ${available}`);
        }

        const assetMeta = manifest.assets[assetId];
        const versions = Object.keys(assetMeta.versions);

        // Resolve SemVer range
        let selectedVersion: string | null = null;
        if (versionRange === 'latest') {
            selectedVersion = semver.maxSatisfying(versions, '*') || versions.sort().reverse()[0];
        } else {
            selectedVersion = semver.maxSatisfying(versions, versionRange);
        }

        if (!selectedVersion) {
            throw new Error(`No version matching "${versionRange}" found for asset "${assetId}". Available: ${versions.join(', ')}`);
        }

        const version = selectedVersion;

        // 2. Check if already installed
        const config = this.configLoader.load();
        const existing = config.assets.find(a => a.id === assetId);

        if (existing && !forceReinstall) {
            // Return info about existing installation for the caller to handle
            return { existing, selectedVersion: version };
        }

        // 3. Build the entry but DON'T write to config yet
        const { config: updatedConfig, alias } = this.configLoader.ensureSource(url, provider);

        // Derive default mapping based on asset kind
        const defaultMapping = this.getDefaultMapping(assetMeta.kind, assetId);

        const entry: ParcaAssetEntry = {
            id: assetId,
            source: alias,
            version,
            mapping: defaultMapping,
        };

        // 4. Resolve FIRST (fetch, cache, symlink) - if this fails, config is untouched
        const resolved = await this.resolveAsset(entry, manifest, git, registryCommit, true);

        // 5. Only persist to config after successful resolution
        this.configLoader.addAsset(updatedConfig, entry);

        return resolved;
    }

    // ---- Resolve All ----

    /** Resolve all assets in .parca-assets.yaml, respecting the lockfile. */
    async resolveAll(progress?: ResolveProgress): Promise<ResolvedAsset[]> {
        const config = this.configLoader.load();
        const lockfile = this.lockfileManager.load();
        const results: ResolvedAsset[] = [];

        // Group assets by source to minimize manifest fetches
        const bySource = new Map<string, ParcaAssetEntry[]>();
        for (const asset of config.assets) {
            if (!bySource.has(asset.source)) {
                bySource.set(asset.source, []);
            }
            bySource.get(asset.source)!.push(asset);
        }

        for (const [sourceAlias, assets] of bySource) {
            const source = config.sources[sourceAlias];
            if (!source) {
                for (const a of assets) {
                    progress?.onAssetError?.(a.id, `Source "${sourceAlias}" not defined.`);
                }
                continue;
            }

            const git = await this.createGitProvider(source.provider, source.url);

            for (const asset of assets) {
                progress?.onAssetStart?.(asset.id, asset.version);
                try {
                    // Determine which manifest revision to use
                    // If locked, we stay on that commit to ensure reproducibility
                    const locked = this.lockfileManager.findAsset(lockfile, asset.id, asset.source);
                    const manifestRef = (locked && locked.version === asset.version) ? locked.commit : 'main';

                    const manifest = await this.manifestResolver.fetchManifest(git, manifestRef);
                    const resolved = await this.resolveAsset(asset, manifest, git, manifestRef);

                    results.push(resolved);
                    progress?.onAssetDone?.(asset.id, asset.version);
                } catch (err: any) {
                    progress?.onAssetError?.(asset.id, err.message);
                }
            }
        }

        return results;
    }

    // ---- List Installed ----

    /** Get the list of currently installed assets from .parca-assets.yaml. */
    listInstalled(): ParcaAssetEntry[] {
        return this.configLoader.getInstalledAssets();
    }

    // ---- Private ----

    private async resolveAsset(
        entry: ParcaAssetEntry,
        manifest: ParcaManifest,
        git: GitProvider,
        manifestRef: string = 'main',
        allowUpdate: boolean = false,
    ): Promise<ResolvedAsset> {
        const assetMeta = manifest.assets[entry.id];
        if (!assetMeta) {
            throw new Error(`Asset "${entry.id}" not found in manifest.`);
        }

        const versionMeta = assetMeta.versions[entry.version];
        if (!versionMeta) {
            throw new Error(`Version "${entry.version}" not found for asset "${entry.id}".`);
        }

        // --- Ref Resolution Strategy ---
        // Priority: explicit ref on version > manifestRef (Dynamic Registry fallback)
        // versionStrategy.template is only used when the version has an explicit ref prefix,
        // NOT as a fallback — that would break the Dynamic Registry model where
        // untagged versions live on main.
        const effectiveRef = versionMeta.ref || manifestRef;

        // Resolve ref to commit SHA
        const commit = await git.resolveRef(effectiveRef);

        // Check lockfile for cached result
        const lockfile = this.lockfileManager.load();
        const locked = this.lockfileManager.findAsset(lockfile, entry.id, entry.source);

        const kind = assetMeta.kind;

        if (locked && locked.version === entry.version && locked.commit === commit && !allowUpdate) {
            // Already resolved at this exact commit. Check cache.
            if (this.cacheManager.isCached(entry.source, entry.id, entry.version, kind, locked.sha256)) {
                const cachedPath = this.cacheManager.getAssetPath(entry.source, entry.id, entry.version, kind);

                // Ensure symlink is in place
                if (entry.mapping) {
                    this.workspaceMapper.createSymlink(cachedPath, entry.mapping, entry.id, kind);
                }

                return {
                    id: entry.id,
                    version: entry.version,
                    source: entry.source,
                    commit,
                    sha256: locked.sha256,
                    content: this.cacheManager.readFromCache(entry.source, entry.id, entry.version, kind) || '',
                    cachePath: cachedPath,
                    mapping: entry.mapping,
                };
            }
        }

        let sha256: string;
        let cachedPath: string;
        let content: string = '';

        if (kind === 'skill') {
            // Fetch the whole directory for skills
            const dirResult = await git.fetchDirectory(versionMeta.path, effectiveRef);

            // Normalize path for searching SKILL.md
            const skillFile = dirResult.files.find(f => f.path.toLowerCase() === 'skill.md');
            if (!skillFile) {
                throw new Error(`Skill "${entry.id}" is missing SKILL.md in ${versionMeta.path}`);
            }
            content = skillFile.content;

            const cacheResult = this.cacheManager.writeDirectoryToCache(
                entry.source, entry.id, entry.version, dirResult.files
            );
            cachedPath = cacheResult.dirPath;
            sha256 = cacheResult.sha256;
        } else {
            // Fetch single file for prompts/instructions
            const fileResult = await git.fetchFile(versionMeta.path, effectiveRef);
            content = fileResult.content;
            const cacheResult = this.cacheManager.writeToCache(
                entry.source, entry.id, entry.version, fileResult.content
            );
            cachedPath = cacheResult.filePath;
            sha256 = cacheResult.sha256;
        }

        // Integrity check against lockfile if exists
        if (locked && locked.sha256 && locked.sha256 !== sha256 && !allowUpdate) {
            throw new Error(
                `Integrity mismatch for "${entry.id}@${entry.version}": ` +
                `expected SHA-256 ${locked.sha256}, got ${sha256}. ` +
                `This may indicate the content of the version changed in the source registry. ` +
                `Run "PARCA: Install" again and choose "Replace" to accept the new content.`
            );
        }

        // Update lockfile
        const manifestHash = this.cacheManager.computeHashFromString(JSON.stringify(manifest));
        const lockedEntry: ParcaLockedAsset = {
            id: entry.id,
            version: entry.version,
            source: entry.source,
            commit,
            sha256,
            manifestHash,
            resolvedAt: new Date().toISOString(),
        };
        this.lockfileManager.save(this.lockfileManager.upsertAsset(lockfile, lockedEntry));

        // Create symlink
        if (entry.mapping) {
            this.workspaceMapper.createSymlink(cachedPath, entry.mapping, entry.id, kind);
        }

        return {
            id: entry.id,
            version: entry.version,
            source: entry.source,
            commit,
            sha256,
            content,
            cachePath: cachedPath,
            mapping: entry.mapping,
        };
    }

    private async createGitProvider(provider: 'github' | 'azure', url: string): Promise<GitProvider> {
        // Import AuthProvider dynamically to avoid circular dependencies
        const { AuthProvider } = await import('./authProvider');
        const token = await AuthProvider.getToken(provider);

        return new GitProvider({ provider, repoUrl: url, token });
    }

    private getDefaultMapping(kind: AssetKind, assetId: string): string {
        switch (kind) {
            case 'prompt':
                return `.github/prompts/${assetId}.prompt.md`;
            case 'instruction':
                return `.github/instructions/${assetId}.instructions.md`;
            case 'skill':
                return `.github/skills/${assetId}/SKILL.md`;
            default:
                return `.github/prompts/${assetId}.md`;
        }
    }
}
