/**
 * PARCA - Publisher
 * Helps maintainers manage parca-manifest.yaml and publish new asset versions.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as semver from 'semver';
import { ParcaManifest, AssetKind } from './types';

const MANIFEST_FILENAME = 'parca-manifest.yaml';

export class Publisher {
    private manifestPath: string;

    constructor(private workspaceRoot: string) {
        this.manifestPath = path.join(workspaceRoot, MANIFEST_FILENAME);
    }

    /** Check if this workspace is a source repository. */
    isSourceRepo(): boolean {
        return fs.existsSync(this.manifestPath);
    }

    /** Load the manifest. */
    loadManifest(): ParcaManifest {
        if (!this.isSourceRepo()) {
            throw new Error(`PARCA manifest not found at ${this.manifestPath}.`);
        }
        const raw = fs.readFileSync(this.manifestPath, 'utf-8');
        return yaml.load(raw) as ParcaManifest;
    }

    /** Save the manifest. */
    saveManifest(manifest: ParcaManifest): void {
        const content = yaml.dump(manifest, { lineWidth: 120, noRefs: true, sortKeys: false });
        fs.writeFileSync(this.manifestPath, content, 'utf-8');
    }

    /** Initialize a new source repository manifest. */
    initManifest(): ParcaManifest {
        const manifest: ParcaManifest = {
            schema: '1.0',
            versionStrategy: { template: 'v{{version}}' },
            assets: {},
        };
        this.saveManifest(manifest);
        return manifest;
    }

    /** Propose the next version for an asset. */
    proposeNextVersion(manifest: ParcaManifest, assetId: string, level: 'patch' | 'minor' | 'major' = 'patch'): string {
        const asset = manifest.assets[assetId];
        if (!asset) { return '1.0.0'; }

        const versions = Object.keys(asset.versions).filter(v => semver.valid(v));
        if (versions.length === 0) { return '1.0.0'; }

        const latest = semver.maxSatisfying(versions, '*') || versions.sort().reverse()[0];
        const next = semver.inc(latest, level);
        return next || '1.0.0';
    }

    /** Publish a new version of an asset. */
    async publishVersion(
        manifest: ParcaManifest,
        assetId: string,
        version: string,
        filePath: string,
        kind: AssetKind = 'prompt',
    ): Promise<void> {
        if (!manifest.assets[assetId]) {
            manifest.assets[assetId] = {
                kind,
                versions: {},
            };
        }

        // Check for duplicates
        if (manifest.assets[assetId].versions[version]) {
            throw new Error(`Version ${version} of asset ${assetId} is already defined in the manifest.`);
        }

        // --- Checkpointing: Pin the previous version to the current HEAD ---
        const existingVersions = Object.keys(manifest.assets[assetId].versions).filter(v => semver.valid(v));
        if (existingVersions.length > 0) {
            const previousVersion = semver.maxSatisfying(existingVersions, '*') || existingVersions.sort().reverse()[0];
            const previousMeta = manifest.assets[assetId].versions[previousVersion];

            // Only checkpoint if the previous version doesn't already have a ref
            if (previousMeta && !previousMeta.ref) {
                try {
                    // Get the current HEAD commit SHA
                    const { execSync } = require('child_process');
                    const currentCommit = execSync('git rev-parse HEAD', {
                        cwd: this.workspaceRoot,
                        encoding: 'utf-8'
                    }).trim();

                    // Pin the previous version to this commit
                    previousMeta.ref = currentCommit;
                } catch (err) {
                    // If git command fails, we'll just warn and continue
                    console.warn(`Could not checkpoint previous version ${previousVersion}: ${err}`);
                }
            }
        }

        // Add the new version (rolling - no ref)
        manifest.assets[assetId].versions[version] = {
            path: filePath,
            // ref is omitted for 'Dynamic Registry' behavior (defaults to manifest revision)
        };

        this.saveManifest(manifest);
    }
}
