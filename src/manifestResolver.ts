/**
 * PARCA - ManifestResolver
 * Fetches and parses parca-manifest.yaml from a source repository.
 */
import * as yaml from 'js-yaml';
import { ParcaManifest, RemoteAssetInfo, AssetKind } from './types';
import { GitProvider } from './gitProvider';

const MANIFEST_FILENAME = 'parca-manifest.yaml';

export class ManifestResolver {
    /** Fetch and parse the manifest from a source repository. */
    async fetchManifest(gitProvider: GitProvider, ref: string = 'main'): Promise<ParcaManifest> {
        const result = await gitProvider.fetchFile(MANIFEST_FILENAME, ref);
        const manifest = yaml.load(result.content) as ParcaManifest;
        this.validate(manifest);
        return manifest;
    }

    /** List all assets from a manifest, optionally filtered by kind. */
    listAssets(manifest: ParcaManifest, kindFilter?: AssetKind): RemoteAssetInfo[] {
        const results: RemoteAssetInfo[] = [];

        for (const [id, asset] of Object.entries(manifest.assets)) {
            if (kindFilter && asset.kind !== kindFilter) {
                continue;
            }
            const versions = Object.keys(asset.versions).sort();
            results.push({
                id,
                kind: asset.kind,
                description: asset.description || '',
                latestVersion: versions[versions.length - 1] || 'unknown',
                versions,
            });
        }

        return results;
    }

    /** Validate a manifest structure. */
    private validate(manifest: ParcaManifest): void {
        if (!manifest.schema) {
            throw new Error('Manifest missing "schema" field.');
        }
        if (!manifest.assets || typeof manifest.assets !== 'object') {
            throw new Error('Manifest missing or invalid "assets" field.');
        }
        for (const [id, asset] of Object.entries(manifest.assets)) {
            if (!asset.kind) {
                throw new Error(`Asset "${id}" missing "kind" field.`);
            }
            if (!asset.versions || typeof asset.versions !== 'object') {
                throw new Error(`Asset "${id}" missing or invalid "versions" field.`);
            }
        }
    }
}
