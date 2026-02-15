/**
 * PARCA - GitProvider
 * Fetches files from Git hosting providers (GitHub / Azure DevOps) via REST APIs.
 */
import * as https from 'https';
import * as url from 'url';
import * as path from 'path';

export interface GitFileResult {
    content: string;
    sha: string;
}

export interface GitDirectoryFile {
    path: string;        // relative path within the directory
    content: string;
}

export interface GitDirectoryResult {
    files: GitDirectoryFile[];
}

export interface GitProviderOptions {
    provider: 'github' | 'azure';
    repoUrl: string;
    token?: string;
}

export class GitProvider {
    private provider: 'github' | 'azure';
    private repoUrl: string;
    private token?: string;

    constructor(opts: GitProviderOptions) {
        this.provider = opts.provider;
        this.repoUrl = opts.repoUrl;
        this.token = opts.token;
    }

    /** Fetch a file at a specific ref (branch, tag, or commit SHA). */
    async fetchFile(filePath: string, ref: string): Promise<GitFileResult> {
        if (this.provider === 'github') {
            return this.fetchFromGitHub(filePath, ref);
        } else {
            return this.fetchFromAzure(filePath, ref);
        }
    }

    /** Fetch a directory and all its recursive contents. */
    async fetchDirectory(dirPath: string, ref: string): Promise<GitDirectoryResult> {
        const files: GitDirectoryFile[] = [];
        await this.collectDirectoryContents(dirPath, ref, '', files);
        return { files };
    }

    /** Resolve a ref (tag name, branch) to a commit SHA. */
    async resolveRef(ref: string): Promise<string> {
        if (this.provider === 'github') {
            return this.resolveGitHubRef(ref);
        } else {
            return this.resolveAzureRef(ref);
        }
    }

    private async collectDirectoryContents(
        dirPath: string,
        ref: string,
        relativePath: string,
        results: GitDirectoryFile[]
    ): Promise<void> {
        if (this.provider === 'github') {
            const { owner, repo } = this.parseGitHubRepo();
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`;
            const items = await this.httpGetJson(apiUrl);

            if (!Array.isArray(items)) {
                throw new Error(`Expected directory array from GitHub for ${dirPath}`);
            }

            for (const item of items) {
                const itemRelPath = relativePath ? `${relativePath}/${item.name}` : item.name;
                if (item.type === 'file') {
                    const fileData = await this.httpGetJson(item.url); // Use the provided URL (includes ref/auth)
                    const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
                    results.push({ path: itemRelPath, content });
                } else if (item.type === 'dir') {
                    await this.collectDirectoryContents(item.path, ref, itemRelPath, results);
                }
            }
        } else {
            // Azure DevOps Implementation for directory fetch
            const { org, project, repo } = this.parseAzureRepo();
            // Azure uses recursion by default if scopePath is specified
            const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items?scopePath=${encodeURIComponent(dirPath)}&recursionLevel=full&versionDescriptor.version=${encodeURIComponent(ref)}&api-version=7.1`;
            const data = await this.httpGetJson(apiUrl);

            if (data.value && Array.isArray(data.value)) {
                for (const item of data.value) {
                    if (item.gitObjectType === 'blob') {
                        // Skip the dir itself if it appears as an item
                        if (item.path === dirPath) continue;

                        const itemRelPath = path.relative(dirPath, item.path).replace(/\\/g, '/');
                        const fileUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items?path=${encodeURIComponent(item.path)}&versionDescriptor.version=${encodeURIComponent(ref)}&api-version=7.1`;
                        const content = await this.httpGetText(fileUrl);
                        results.push({ path: itemRelPath, content });
                    }
                }
            }
        }
    }

    // ---- GitHub Implementation ----

    private parseGitHubRepo(): { owner: string; repo: string } {
        const u = new URL(this.repoUrl);
        const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
        if (parts.length < 2) {
            throw new Error(`Invalid GitHub URL: ${this.repoUrl}`);
        }
        return { owner: parts[0], repo: parts[1] };
    }

    private async fetchFromGitHub(filePath: string, ref: string): Promise<GitFileResult> {
        const { owner, repo } = this.parseGitHubRepo();
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
        const data = await this.httpGetJson(apiUrl);
        if (data.encoding === 'base64' && data.content) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            return { content, sha: data.sha };
        }
        throw new Error(`GitHub returned unexpected format for ${filePath}`);
    }

    private async resolveGitHubRef(ref: string): Promise<string> {
        const { owner, repo } = this.parseGitHubRepo();
        // Try as branch/tag via git ref API
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
        const data = await this.httpGetJson(apiUrl);
        return data.sha;
    }

    // ---- Azure DevOps Implementation ----

    private parseAzureRepo(): { org: string; project: string; repo: string } {
        const u = new URL(this.repoUrl);
        // Format: https://dev.azure.com/{org}/{project}/_git/{repo}
        const parts = u.pathname.split('/').filter(Boolean);
        const gitIdx = parts.indexOf('_git');
        if (gitIdx === -1 || gitIdx < 2) {
            throw new Error(`Invalid Azure DevOps URL: ${this.repoUrl}`);
        }
        return {
            org: parts[0],
            project: parts[1],
            repo: parts[gitIdx + 1],
        };
    }

    private async fetchFromAzure(filePath: string, ref: string): Promise<GitFileResult> {
        const { org, project, repo } = this.parseAzureRepo();
        const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/items?path=${encodeURIComponent(filePath)}&versionDescriptor.version=${encodeURIComponent(ref)}&api-version=7.1`;
        const content = await this.httpGetText(apiUrl);
        // Azure doesn't return SHA in the same way; we'll compute it from content.
        return { content, sha: '' };
    }

    private async resolveAzureRef(ref: string): Promise<string> {
        const { org, project, repo } = this.parseAzureRepo();
        const apiUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(ref)}&$top=1&api-version=7.1`;
        const data = await this.httpGetJson(apiUrl);
        if (data.value && data.value.length > 0) {
            return data.value[0].commitId;
        }
        throw new Error(`Could not resolve ref "${ref}" in Azure repo ${this.repoUrl}`);
    }

    // ---- HTTP helpers ----

    private httpGetJson(requestUrl: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(requestUrl);
            const headers: Record<string, string> = {
                'User-Agent': 'PARCA-Engine/0.1',
                'Accept': 'application/json',
            };
            if (this.token) {
                if (this.provider === 'github') {
                    headers['Authorization'] = `Bearer ${this.token}`;
                } else {
                    headers['Authorization'] = `Basic ${Buffer.from(':' + this.token).toString('base64')}`;
                }
            }
            const req = https.get({
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                headers,
            }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}: ${body.substring(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON from ${requestUrl}`));
                    }
                });
            });
            req.on('error', reject);
        });
    }

    private httpGetText(requestUrl: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(requestUrl);
            const headers: Record<string, string> = {
                'User-Agent': 'PARCA-Engine/0.1',
            };
            if (this.token) {
                if (this.provider === 'github') {
                    headers['Authorization'] = `Bearer ${this.token}`;
                } else {
                    headers['Authorization'] = `Basic ${Buffer.from(':' + this.token).toString('base64')}`;
                }
            }
            const req = https.get({
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                headers,
            }, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}: ${body.substring(0, 200)}`));
                        return;
                    }
                    resolve(body);
                });
            });
            req.on('error', reject);
        });
    }
}
