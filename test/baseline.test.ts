import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AssetResolver } from '../src/assetResolver';
import { GitProvider } from '../src/gitProvider';
import { CacheManager } from '../src/cacheManager';
import { ConfigLoader } from '../src/configLoader';

// Mock GitProvider to avoid network calls
class MockGitProvider extends GitProvider {
    constructor() {
        super({ provider: 'github', repoUrl: 'https://github.com/test/repo' });
    }

    async resolveRef(ref: string): Promise<string> {
        return 'mock-sha-123';
    }

    async fetchFile(filePath: string, ref: string): Promise<{ content: string; sha: string }> {
        if (filePath === 'parca-manifest.yaml') {
            return {
                content: `
schema: 1.0
assets:
  test-asset:
    kind: prompt
    description: "Test prompt"
    versions:
      1.0.0:
        path: "prompts/test.md"
`,
                sha: 'manifest-sha'
            };
        }
        if (filePath === 'prompts/test.md') {
            return {
                content: '# Hello Test',
                sha: 'file-sha'
            };
        }
        throw new Error(`File not found: ${filePath}`);
    }
}

describe('Baseline Integration Test', () => {
    let testDir: string;
    let cacheDir: string;
    let resolver: AssetResolver;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parca-test-'));
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parca-cache-'));
        
        // Setup initial config
        const configPath = path.join(testDir, '.parca-assets.yaml');
        fs.writeFileSync(configPath, `
schema: 1.0
sources:
  test-source:
    type: git
    provider: github
    url: "https://github.com/test/repo"
assets: []
`, 'utf-8');

        resolver = new AssetResolver(testDir);
        // Inject mock cache and bypass git provider creation
        (resolver as any).cacheManager = new CacheManager(cacheDir);
        (resolver as any).createGitProvider = async () => new MockGitProvider();
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
        fs.rmSync(cacheDir, { recursive: true, force: true });
    });

    it('should install an asset correctly', async () => {
        const result = await resolver.install('https://github.com/test/repo', 'test-asset', '1.0.0');
        
        if ('existing' in result) {
            throw new Error('Asset should not already exist');
        }

        assert.strictEqual(result.id, 'test-asset');
        assert.strictEqual(result.version, '1.0.0');
        assert.strictEqual(result.content, '# Hello Test');

        // Verify cache
        const cachedFilePath = path.join(cacheDir, 'test-source', 'test-asset', '1.0.0', 'test-asset.md');
        assert.ok(fs.existsSync(cachedFilePath), 'Cache file should exist');
        assert.strictEqual(fs.readFileSync(cachedFilePath, 'utf-8'), '# Hello Test');

        // Verify workspace symlink
        const mappingPath = path.join(testDir, '.github', 'prompts', 'test-asset.prompt.md');
        assert.ok(fs.existsSync(mappingPath), 'Symlink should exist');
        assert.ok(fs.lstatSync(mappingPath).isSymbolicLink(), 'Should be a symlink');
        
        // Verify .gitignore
        const gitignorePath = path.join(testDir, '.gitignore');
        assert.ok(fs.existsSync(gitignorePath), '.gitignore should be created');
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
        assert.ok(gitignoreContent.includes('.github/prompts/test-asset.prompt.md'), 'Should be gitignored');
    });
});
