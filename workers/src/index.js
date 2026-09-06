/**
 * フレンド・ユーザー機能用API（Cloudflare Workers + D1）。
 *
 * 認証はニックネーム＋自動発行コードのみ（パスワード・メール不要）。
 * - code: フレンドに教える公開コード
 * - token: 自分の操作を証明する秘密トークン（ブラウザのlocalStorageだけに保存）。
 *   サーバーにはSHA-256ハッシュだけを保存し、生のトークンは保存しない。
 *
 * /api/ 以外のパスは静的フロントエンド(env.ASSETS)にそのまま委譲する。
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい0/O,1/Iを除く
const CODE_LENGTH = 6;
const NICKNAME_MAX = 20;
const LEVELS = new Set(["low", "elem", "all"]);
const MAX_STREAK = 100000; // 異常値の投稿を弾くための上限

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function err(status, message) {
  return json({ error: message }, status);
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function newUniqueCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const existing = await db.prepare("SELECT 1 FROM players WHERE code = ?").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("could not allocate a unique code");
}

function cleanNickname(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, NICKNAME_MAX);
  return trimmed.length ? trimmed : null;
}

async function requireAuth(request, db) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const tokenHash = await hashToken(m[1]);
  const player = await db
    .prepare("SELECT code, nickname FROM players WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  return player || null;
}

async function bestScoresFor(db, codes) {
  // codes: string[] -> { [code]: { [level]: bestStreak } }
  if (!codes.length) return {};
  const placeholders = codes.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT player_code, level, MAX(streak) AS best
       FROM scores WHERE player_code IN (${placeholders})
       GROUP BY player_code, level`
    )
    .bind(...codes)
    .all();
  const out = {};
  for (const row of rows.results) {
    (out[row.player_code] ??= {})[row.level] = row.best;
  }
  return out;
}

async function handleApi(request, env, url) {
  const db = env.DB;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = request.method;

  // POST /api/players
  if (method === "POST" && parts.length === 2 && parts[1] === "players") {
    const body = await request.json().catch(() => ({}));
    const nickname = cleanNickname(body.nickname);
    if (!nickname) return err(400, "nicknameを入力してください");
    const code = await newUniqueCode(db);
    const token = randomToken();
    const tokenHash = await hashToken(token);
    await db
      .prepare("INSERT INTO players (code, token_hash, nickname, created_at) VALUES (?, ?, ?, ?)")
      .bind(code, tokenHash, nickname, Date.now())
      .run();
    return json({ code, token, nickname });
  }

  // PATCH /api/players/me
  if (method === "PATCH" && parts.length === 3 && parts[1] === "players" && parts[2] === "me") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const body = await request.json().catch(() => ({}));
    const nickname = cleanNickname(body.nickname);
    if (!nickname) return err(400, "nicknameを入力してください");
    await db.prepare("UPDATE players SET nickname = ? WHERE code = ?").bind(nickname, me.code).run();
    return json({ code: me.code, nickname });
  }

  // GET /api/players/:code
  if (method === "GET" && parts.length === 3 && parts[1] === "players") {
    const code = parts[2].toUpperCase();
    const player = await db.prepare("SELECT code, nickname FROM players WHERE code = ?").bind(code).first();
    if (!player) return err(404, "見つかりません");
    return json(player);
  }

  // GET /api/friends
  if (method === "GET" && parts.length === 2 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const rows = await db
      .prepare(
        `SELECT p.code AS code, p.nickname AS nickname
         FROM friends f JOIN players p ON p.code = f.friend_code
         WHERE f.owner_code = ? ORDER BY f.created_at ASC`
      )
      .bind(me.code)
      .all();
    const codes = rows.results.map((r) => r.code);
    const bests = await bestScoresFor(db, codes);
    const friends = rows.results.map((r) => ({ code: r.code, nickname: r.nickname, best: bests[r.code] || {} }));
    return json({ friends });
  }

  // POST /api/friends  { code }
  if (method === "POST" && parts.length === 2 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return err(400, "codeを入力してください");
    if (code === me.code) return err(400, "自分自身は追加できません");
    const target = await db.prepare("SELECT code, nickname FROM players WHERE code = ?").bind(code).first();
    if (!target) return err(404, "そのコードの相手が見つかりません");
    await db
      .prepare("INSERT OR IGNORE INTO friends (owner_code, friend_code, created_at) VALUES (?, ?, ?)")
      .bind(me.code, target.code, Date.now())
      .run();
    return json({ code: target.code, nickname: target.nickname });
  }

  // DELETE /api/friends/:code
  if (method === "DELETE" && parts.length === 3 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const code = parts[2].toUpperCase();
    await db.prepare("DELETE FROM friends WHERE owner_code = ? AND friend_code = ?").bind(me.code, code).run();
    return json({ ok: true });
  }

  // POST /api/scores  { level, streak }
  if (method === "POST" && parts.length === 2 && parts[1] === "scores") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const body = await request.json().catch(() => ({}));
    const level = body.level;
    const streak = Number(body.streak);
    if (!LEVELS.has(level)) return err(400, "levelが不正です");
    if (!Number.isInteger(streak) || streak < 0 || streak > MAX_STREAK) return err(400, "streakが不正です");
    await db
      .prepare("INSERT INTO scores (player_code, level, streak, created_at) VALUES (?, ?, ?, ?)")
      .bind(me.code, level, streak, Date.now())
      .run();
    return json({ ok: true });
  }

  return err(404, "not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return err(500, "サーバーエラーが発生しました");
      }
    }
    return env.ASSETS.fetch(request);
  },
};
