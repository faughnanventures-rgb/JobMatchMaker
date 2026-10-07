// Talks to this project's own GitHub repository. Needs GITHUB_TOKEN (a fine-grained token limited
// to this one repository) and GITHUB_REPO ("owner/name"). The token never leaves the server.
export const WORKFLOW = 'check-jobs.yml';
export const branch = () => process.env.GITHUB_BRANCH || 'main';

export async function gh(path, { method = 'GET', body } = {}) {
  const repo = process.env.GITHUB_REPO || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPO must look like owner/name');
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'job-watch', ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`GitHub answered ${res.status}`); e.status = res.status; throw e; }
  return data;
}
