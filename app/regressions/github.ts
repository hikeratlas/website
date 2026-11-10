// Reading and writing hikeratlas/routes from the browser, for the
// regressions page (routes/dev.regressions.tsx).
//
// Reads go through raw.githubusercontent.com (the repo is public; no token,
// no rate limit), at a commit the API resolves a branch to, so the file CDN's
// 5-minute cache of a branch's files never shows stale ones. Writes need a
// token: a fine-grained one, for hikeratlas/routes only, with Contents and
// Pull requests read and write. They go to a working branch, as one commit,
// and a pull request from it to main: the routes CI checks the entries
// before anything reaches main.

export const REPO = 'hikeratlas/routes';
const API = 'https://api.github.com';

export class GitHub {
  constructor(public token: string | null) {}

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${API}${path}`, {
      // The API says max-age=60: always ask, so a ref read just after a push
      // or merge is the new one.
      cache: 'no-store',
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({})) as { message?: string };
      throw new GitHubError(r.status, `${init.method ?? 'GET'} ${path}: ${r.status} ${body.message ?? r.statusText}`);
    }
    return r.status === 204 ? (undefined as T) : r.json() as Promise<T>;
  }

  // Who the token is for, or null without one.
  async user(): Promise<string | null> {
    if (!this.token) return null;
    return (await this.api<{ login: string }>('/user')).login;
  }

  // A branch's head commit, or null if there's no such branch.
  async head(branch: string): Promise<string | null> {
    try {
      return (await this.api<{ object: { sha: string } }>(`/repos/${REPO}/git/ref/heads/${branch}`)).object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  // The names of the files in a directory at a commit.
  async list(dir: string, ref: string): Promise<string[]> {
    const items = await this.api<{ name: string; type: string }[]>(`/repos/${REPO}/contents/${dir}?ref=${ref}`);
    return items.filter((i) => i.type === 'file').map((i) => i.name);
  }

  // A file's text at a commit, or null if it isn't there.
  async read(path: string, ref: string): Promise<string | null> {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new GitHubError(r.status, `reading ${path}: ${r.status}`);
    return r.text();
  }

  // The open pull request from a branch, if there is one.
  async openPull(branch: string): Promise<{ number: number; html_url: string } | null> {
    const owner = REPO.split('/')[0];
    const ps = await this.api<{ number: number; html_url: string }[]>(`/repos/${REPO}/pulls?state=open&head=${owner}:${branch}`);
    return ps[0] ?? null;
  }

  // Commit files (path -> text) to a branch, as one commit on `base` (a
  // commit sha), and point the branch at it, making the branch if need be.
  async commit(branch: string, base: string, files: Record<string, string>, message: string): Promise<string> {
    const baseCommit = await this.api<{ tree: { sha: string } }>(`/repos/${REPO}/git/commits/${base}`);
    const tree = await this.api<{ sha: string }>(`/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      }),
    });
    const c = await this.api<{ sha: string }>(`/repos/${REPO}/git/commits`, {
      method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [base] }),
    });
    if (await this.head(branch)) {
      // force: the branch may be restarted from main after its pull request
      // was merged (see Regressions' workBase).
      await this.api(`/repos/${REPO}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: true }) });
    } else {
      await this.api(`/repos/${REPO}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: c.sha }) });
    }
    return c.sha;
  }

  async createPull(branch: string, title: string, body: string): Promise<{ number: number; html_url: string }> {
    return this.api(`/repos/${REPO}/pulls`, { method: 'POST', body: JSON.stringify({ title, body, head: branch, base: 'main' }) });
  }
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
