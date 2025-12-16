const axios = require("axios");

function apiBase(owner, repo) {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function b64Encode(str) {
  return Buffer.from(str, "utf8").toString("base64");
}
function b64Decode(b64) {
  return Buffer.from((b64 || "").replace(/\n/g, ""), "base64").toString("utf8");
}

async function loadDb({ owner, repo, branch, path, token }) {
  const url = `${apiBase(owner, repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const r = await axios.get(url, { headers: authHeaders(token), validateStatus: () => true, timeout: 20000 });

  if (r.status === 200 && r.data && r.data.content) {
    const raw = b64Decode(r.data.content);
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = {};
    }
    return { db: json || {}, sha: r.data.sha || null };
  }

  if (r.status === 404) {
    return { db: {}, sha: null };
  }

  throw new Error(`loadDb failed: ${r.status} ${JSON.stringify(r.data || {})}`);
}

async function saveDb({ owner, repo, branch, path, token, db, sha, message }) {
  const url = `${apiBase(owner, repo)}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `update ${path}`,
    content: b64Encode(JSON.stringify(db, null, 2)),
    branch,
  };
  if (sha) body.sha = sha;

  const r = await axios.put(url, body, {
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    validateStatus: () => true,
    timeout: 20000,
  });

  if (r.status === 200 || r.status === 201) {
    return { ok: true, sha: r.data?.content?.sha || r.data?.commit?.sha || null };
  }

  throw new Error(`saveDb failed: ${r.status} ${JSON.stringify(r.data || {})}`);
}

module.exports = { loadDb, saveDb };
