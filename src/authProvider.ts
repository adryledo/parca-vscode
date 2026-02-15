/**
 * PARCA - Authentication Provider
 * Manages authentication tokens for Git providers, using VS Code's auth API when available.
 */
import * as vscode from 'vscode';

export class AuthProvider {
    /**
     * Get authentication token for GitHub.
     * Tries VS Code authentication first, falls back to environment variables.
     */
    static async getGitHubToken(): Promise<string | undefined> {
        try {
            // Try VS Code's built-in GitHub authentication
            const session = await vscode.authentication.getSession('github', ['repo'], {
                createIfNone: true
            });

            if (session) {
                return session.accessToken;
            }
        } catch (err) {
            // User cancelled or auth failed, fall back to env var
            console.warn('VS Code GitHub authentication not available, falling back to environment variable.');
        }

        // Fallback to environment variables
        return process.env.GITHUB_TOKEN || process.env.PARCA_TOKEN;
    }

    /**
     * Get authentication token for Azure DevOps.
     * Uses environment variables (VS Code doesn't have built-in Azure DevOps auth).
     */
    static async getAzureToken(): Promise<string | undefined> {
        return process.env.AZURE_DEVOPS_PAT || process.env.PARCA_TOKEN;
    }

    /**
     * Get token for any provider.
     */
    static async getToken(provider: 'github' | 'azure'): Promise<string | undefined> {
        if (provider === 'github') {
            return this.getGitHubToken();
        } else {
            return this.getAzureToken();
        }
    }
}
