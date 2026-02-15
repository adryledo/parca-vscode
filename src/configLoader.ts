/**
 * PARCA - ConfigLoader
 * Reads, writes, and validates .parca-assets.yaml in the workspace.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ParcaConfig, ParcaAssetEntry, ParcaSource } from './types';

const CONFIG_FILENAME = '.parca-assets.yaml';

export class ConfigLoader {
    private configPath: string;

    constructor(private workspaceRoot: string) {
        this.configPath = path.join(workspaceRoot, CONFIG_FILENAME);
    }

    /** Check if a .parca-assets.yaml exists in the workspace. */
    exists(): boolean {
        return fs.existsSync(this.configPath);
    }

    /** Load and parse the config. Returns a validated ParcaConfig. */
    load(): ParcaConfig {
        if (!this.exists()) {
            throw new Error(`PARCA config not found at ${this.configPath}. Run 'PARCA: Install Asset' to create one.`);
        }
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = yaml.load(raw) as ParcaConfig;
        this.validate(parsed);
        return parsed;
    }

    /** Write a ParcaConfig back to disk. */
    save(config: ParcaConfig): void {
        const content = yaml.dump(config, { lineWidth: 120, noRefs: true, sortKeys: false });
        fs.writeFileSync(this.configPath, content, 'utf-8');
    }

    /** Create a fresh config file with empty sources and assets. */
    init(): ParcaConfig {
        const config: ParcaConfig = {
            schema: '1.0',
            sources: {},
            assets: [],
        };
        this.save(config);
        return config;
    }

    /** Add a source if not already registered. Returns the alias used. */
    ensureSource(url: string, provider: 'github' | 'azure'): { config: ParcaConfig; alias: string } {
        let config: ParcaConfig;
        try {
            config = this.load();
        } catch {
            config = this.init();
        }

        // Check if this URL is already registered under any alias
        for (const [alias, src] of Object.entries(config.sources)) {
            if (src.url === url) {
                return { config, alias };
            }
        }

        // Derive alias from URL
        const alias = this.deriveAlias(url);
        config.sources[alias] = { type: 'git', provider, url };
        this.save(config);
        return { config, alias };
    }

    /** Add an asset entry. Returns the updated config. */
    addAsset(config: ParcaConfig, entry: ParcaAssetEntry): ParcaConfig {
        // Replace existing entry for same id+source
        config.assets = config.assets.filter(a => !(a.id === entry.id && a.source === entry.source));
        config.assets.push(entry);
        this.save(config);
        return config;
    }

    /** Get all installed asset entries. */
    getInstalledAssets(): ParcaAssetEntry[] {
        if (!this.exists()) { return []; }
        const config = this.load();
        return config.assets;
    }

    /** Infer the Git provider from a URL. */
    static inferProvider(url: string): 'github' | 'azure' {
        if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) {
            return 'azure';
        }
        return 'github';
    }

    // --- Private ---

    private validate(config: ParcaConfig): void {
        if (!config.schema) {
            throw new Error('PARCA config missing "schema" field.');
        }
        if (!config.sources || typeof config.sources !== 'object') {
            throw new Error('PARCA config missing or invalid "sources" field.');
        }
        if (!Array.isArray(config.assets)) {
            throw new Error('PARCA config missing or invalid "assets" field.');
        }
        for (const asset of config.assets) {
            if (!asset.id || !asset.source || !asset.version) {
                throw new Error(`PARCA asset entry missing required fields (id, source, version): ${JSON.stringify(asset)}`);
            }
            if (!config.sources[asset.source]) {
                throw new Error(`PARCA asset "${asset.id}" references undefined source "${asset.source}".`);
            }
        }
    }

    private deriveAlias(url: string): string {
        try {
            const u = new URL(url);
            // e.g. https://github.com/my-org/repo -> my-org
            const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
            if (parts.length >= 2) {
                return parts[parts.length - 2]; // org name
            }
            return parts[0] || 'default';
        } catch {
            return 'default';
        }
    }
}
