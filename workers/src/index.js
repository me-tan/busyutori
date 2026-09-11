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
const USERNAME_MAX = 20;
const PASSWORD_MIN = 4;
const PBKDF2_ITERATIONS = 100000;
const LEVELS = new Set(["low", "elem", "all"]);
const MAX_STREAK = 100000; // 異常値の投稿を弾くための上限
const INVITE_TTL_MS = 10 * 60 * 1000; // 対戦の誘いを表示する期限（ポーリング前提の簡易メールボックス）
const REMOVAL_TTL_MS = 3 * 24 * 60 * 60 * 1000; // フレンド解除通知を表示する期限（頻繁には開かない前提で長め）
const DECLINE_TTL_MS = 24 * 60 * 60 * 1000; // 対戦の誘いを断られた通知を表示する期限

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

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// パスワードはPBKDF2（ユーザーごとにランダムなsalt）でハッシュ化する。
// generalな平文比較を避けるため、saltを渡さなければ新規発行する。
async function derivePasswordHash(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = await derivePasswordHash(password, saltHex);
  return hash === expectedHashHex;
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

function cleanUsername(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, USERNAME_MAX);
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

async function acceptedFriendCodes(db, code) {
  const rows = await db
    .prepare(
      `SELECT CASE WHEN requester_code = ? THEN recipient_code ELSE requester_code END AS code
       FROM friendships WHERE (requester_code = ? OR recipient_code = ?) AND status = 'accepted'`
    )
    .bind(code, code, code)
    .all();
  return rows.results.map((r) => r.code);
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

  // POST /api/players — 新規登録（ユーザー名＋パスワード＋ニックネーム）
  if (method === "POST" && parts.length === 2 && parts[1] === "players") {
    const body = await request.json().catch(() => ({}));
    const nickname = cleanNickname(body.nickname);
    const username = cleanUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!nickname) return err(400, "nicknameを入力してください");
    if (!username) return err(400, "usernameを入力してください");
    if (password.length < PASSWORD_MIN) return err(400, `passwordは${PASSWORD_MIN}文字以上にしてください`);

    const existing = await db.prepare("SELECT 1 FROM players WHERE username = ?").bind(username).first();
    if (existing) return err(409, "そのusernameは既に使われています");

    const code = await newUniqueCode(db);
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const { hash: passwordHash, salt: passwordSalt } = await derivePasswordHash(password);
    await db
      .prepare(
        `INSERT INTO players (code, token_hash, nickname, username, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(code, tokenHash, nickname, username, passwordHash, passwordSalt, Date.now())
      .run();
    return json({ code, token, nickname });
  }

  // POST /api/login — ユーザー名＋パスワードで新しいtokenを発行する
  if (method === "POST" && parts.length === 2 && parts[1] === "login") {
    const body = await request.json().catch(() => ({}));
    const username = cleanUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) return err(400, "usernameとpasswordを入力してください");

    const player = await db
      .prepare("SELECT code, nickname, password_hash, password_salt FROM players WHERE username = ?")
      .bind(username)
      .first();
    if (!player || !player.password_hash) return err(401, "usernameまたはpasswordが違います");
    const ok = await verifyPassword(password, player.password_salt, player.password_hash);
    if (!ok) return err(401, "usernameまたはpasswordが違います");

    const token = randomToken();
    const tokenHash = await hashToken(token);
    await db.prepare("UPDATE players SET token_hash = ? WHERE code = ?").bind(tokenHash, player.code).run();
    return json({ code: player.code, token, nickname: player.nickname });
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

  // GET /api/players/me — 自分のプロフィール画面用（ニックネーム・コード・自分のベスト記録）
  if (method === "GET" && parts.length === 3 && parts[1] === "players" && parts[2] === "me") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const bests = await bestScoresFor(db, [me.code]);
    return json({ code: me.code, nickname: me.nickname, best: bests[me.code] || {} });
  }

  // GET /api/players/:code
  if (method === "GET" && parts.length === 3 && parts[1] === "players") {
    const code = parts[2].toUpperCase();
    const player = await db.prepare("SELECT code, nickname FROM players WHERE code = ?").bind(code).first();
    if (!player) return err(404, "見つかりません");
    return json(player);
  }

  // GET /api/friends — 承認済みのフレンド一覧
  if (method === "GET" && parts.length === 2 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const codes = await acceptedFriendCodes(db, me.code);
    if (!codes.length) return json({ friends: [] });
    const placeholders = codes.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT code, nickname FROM players WHERE code IN (${placeholders})`).bind(...codes).all();
    const bests = await bestScoresFor(db, codes);
    const friends = rows.results.map((r) => ({ code: r.code, nickname: r.nickname, best: bests[r.code] || {} }));
    return json({ friends });
  }

  // GET /api/friends/requests — 自分あての未承認の申請一覧
  if (method === "GET" && parts.length === 3 && parts[1] === "friends" && parts[2] === "requests") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const rows = await db
      .prepare(
        `SELECT p.code AS code, p.nickname AS nickname, f.created_at AS created_at
         FROM friendships f JOIN players p ON p.code = f.requester_code
         WHERE f.recipient_code = ? AND f.status = 'pending' ORDER BY f.created_at DESC`
      )
      .bind(me.code)
      .all();
    return json({ requests: rows.results });
  }

  // POST /api/friends  { code } — フレンド申請を送る。相手が先に自分へ送っていた場合は即承認になる
  if (method === "POST" && parts.length === 2 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return err(400, "codeを入力してください");
    if (code === me.code) return err(400, "自分自身は追加できません");
    const target = await db.prepare("SELECT code, nickname FROM players WHERE code = ?").bind(code).first();
    if (!target) return err(404, "そのコードの相手が見つかりません");

    const existing = await db
      .prepare(
        `SELECT requester_code, status FROM friendships
         WHERE (requester_code = ? AND recipient_code = ?) OR (requester_code = ? AND recipient_code = ?)`
      )
      .bind(me.code, target.code, target.code, me.code)
      .first();

    if (existing && existing.status === "accepted") {
      return json({ code: target.code, nickname: target.nickname, status: "accepted" });
    }
    if (existing && existing.requester_code === target.code) {
      // 相手が先に自分宛てに申請していた → クロスしたので即承認扱いにする
      await db
        .prepare("UPDATE friendships SET status = 'accepted' WHERE requester_code = ? AND recipient_code = ?")
        .bind(target.code, me.code)
        .run();
      return json({ code: target.code, nickname: target.nickname, status: "accepted" });
    }
    if (existing) {
      return json({ code: target.code, nickname: target.nickname, status: "pending" }); // 送信済みでまだ返事待ち
    }
    await db
      .prepare("INSERT INTO friendships (requester_code, recipient_code, status, created_at) VALUES (?, ?, 'pending', ?)")
      .bind(me.code, target.code, Date.now())
      .run();
    return json({ code: target.code, nickname: target.nickname, status: "pending" });
  }

  // POST /api/friends/:code/accept — 届いた申請を承認する
  if (method === "POST" && parts.length === 4 && parts[1] === "friends" && parts[3] === "accept") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const code = parts[2].toUpperCase();
    const res = await db
      .prepare("UPDATE friendships SET status = 'accepted' WHERE requester_code = ? AND recipient_code = ? AND status = 'pending'")
      .bind(code, me.code)
      .run();
    return json({ ok: (res.meta?.changes || 0) > 0 });
  }

  // POST /api/friends/:code/decline — 届いた申請を断る
  if (method === "POST" && parts.length === 4 && parts[1] === "friends" && parts[3] === "decline") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const code = parts[2].toUpperCase();
    await db
      .prepare("DELETE FROM friendships WHERE requester_code = ? AND recipient_code = ? AND status = 'pending'")
      .bind(code, me.code)
      .run();
    return json({ ok: true });
  }

  // DELETE /api/friends/:code — フレンド解除（自分が申請した/された、どちらでもよい）
  // 承認済みの友達関係を解除した場合のみ、相手に通知を1件残す
  if (method === "DELETE" && parts.length === 3 && parts[1] === "friends") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const code = parts[2].toUpperCase();
    const existing = await db
      .prepare(
        `SELECT status FROM friendships
         WHERE (requester_code = ? AND recipient_code = ?) OR (requester_code = ? AND recipient_code = ?)`
      )
      .bind(me.code, code, code, me.code)
      .first();
    await db
      .prepare(
        `DELETE FROM friendships
         WHERE (requester_code = ? AND recipient_code = ?) OR (requester_code = ? AND recipient_code = ?)`
      )
      .bind(me.code, code, code, me.code)
      .run();
    if (existing && existing.status === "accepted") {
      await db
        .prepare("INSERT INTO removals (to_code, from_nickname, created_at) VALUES (?, ?, ?)")
        .bind(code, me.nickname, Date.now())
        .run();
    }
    return json({ ok: true });
  }

  // GET /api/removals — 自分が解除された、というまだ見ていない通知の一覧
  if (method === "GET" && parts.length === 2 && parts[1] === "removals") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const rows = await db
      .prepare(
        `SELECT id, from_nickname, created_at FROM removals
         WHERE to_code = ? AND created_at > ? ORDER BY created_at DESC`
      )
      .bind(me.code, Date.now() - REMOVAL_TTL_MS)
      .all();
    return json({ removals: rows.results });
  }

  // DELETE /api/removals/:id — 通知を確認済みにする
  if (method === "DELETE" && parts.length === 3 && parts[1] === "removals") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return err(400, "idが不正です");
    await db.prepare("DELETE FROM removals WHERE id = ? AND to_code = ?").bind(id, me.code).run();
    return json({ ok: true });
  }

  // GET /api/ranking?level=elem
  // 自分とフレンドだけのランキング（見知らぬ相手のニックネームを公開しないための制限）
  if (method === "GET" && parts.length === 2 && parts[1] === "ranking") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const level = url.searchParams.get("level");
    if (!LEVELS.has(level)) return err(400, "levelが不正です");
    const friendCodes = await acceptedFriendCodes(db, me.code);
    const nicknames = { [me.code]: me.nickname };
    if (friendCodes.length) {
      const placeholders = friendCodes.map(() => "?").join(",");
      const friendRows = await db.prepare(`SELECT code, nickname FROM players WHERE code IN (${placeholders})`).bind(...friendCodes).all();
      for (const r of friendRows.results) nicknames[r.code] = r.nickname;
    }
    const codes = Object.keys(nicknames);
    const bests = await bestScoresFor(db, codes);
    const ranking = codes
      .map((code) => ({ code, nickname: nicknames[code], best: (bests[code] || {})[level] ?? 0, isMe: code === me.code }))
      .sort((a, b) => b.best - a.best);
    return json({ ranking });
  }

  // POST /api/invites  { code, room_code, level }  相手を対戦に誘う
  if (method === "POST" && parts.length === 2 && parts[1] === "invites") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const body = await request.json().catch(() => ({}));
    const toCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const roomCode = typeof body.room_code === "string" ? body.room_code.trim() : "";
    const level = body.level;
    if (!toCode || !roomCode) return err(400, "codeとroom_codeを入力してください");
    if (!LEVELS.has(level)) return err(400, "levelが不正です");
    const friendCodes = await acceptedFriendCodes(db, me.code);
    if (!friendCodes.includes(toCode)) return err(400, "フレンドにしか誘いを送れません");
    await db
      .prepare("INSERT INTO invites (from_code, to_code, room_code, level, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(me.code, toCode, roomCode, level, Date.now())
      .run();
    return json({ ok: true });
  }

  // GET /api/invites  自分あての、まだ新しい誘いの一覧
  if (method === "GET" && parts.length === 2 && parts[1] === "invites") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const rows = await db
      .prepare(
        `SELECT i.id AS id, i.from_code AS from_code, p.nickname AS from_nickname,
                i.room_code AS room_code, i.level AS level, i.created_at AS created_at
         FROM invites i JOIN players p ON p.code = i.from_code
         WHERE i.to_code = ? AND i.created_at > ?
         ORDER BY i.created_at DESC`
      )
      .bind(me.code, Date.now() - INVITE_TTL_MS)
      .all();
    return json({ invites: rows.results });
  }

  // DELETE /api/invites/:id  誘いを消す（参加した後の後始末。通知は残さない）
  if (method === "DELETE" && parts.length === 3 && parts[1] === "invites") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return err(400, "idが不正です");
    await db.prepare("DELETE FROM invites WHERE id = ? AND to_code = ?").bind(id, me.code).run();
    return json({ ok: true });
  }

  // POST /api/invites/:id/decline  誘いを断る。誘った側に通知を残す
  if (method === "POST" && parts.length === 4 && parts[1] === "invites" && parts[3] === "decline") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return err(400, "idが不正です");
    const invite = await db.prepare("SELECT from_code FROM invites WHERE id = ? AND to_code = ?").bind(id, me.code).first();
    if (invite) {
      await db
        .prepare("INSERT INTO invite_declines (to_code, from_nickname, created_at) VALUES (?, ?, ?)")
        .bind(invite.from_code, me.nickname, Date.now())
        .run();
    }
    await db.prepare("DELETE FROM invites WHERE id = ? AND to_code = ?").bind(id, me.code).run();
    return json({ ok: true });
  }

  // GET /api/invite-declines — 自分が送った誘いが断られた、まだ見ていない通知の一覧
  if (method === "GET" && parts.length === 2 && parts[1] === "invite-declines") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const rows = await db
      .prepare(
        `SELECT id, from_nickname, created_at FROM invite_declines
         WHERE to_code = ? AND created_at > ? ORDER BY created_at DESC`
      )
      .bind(me.code, Date.now() - DECLINE_TTL_MS)
      .all();
    return json({ declines: rows.results });
  }

  // DELETE /api/invite-declines/:id — 通知を確認済みにする
  if (method === "DELETE" && parts.length === 3 && parts[1] === "invite-declines") {
    const me = await requireAuth(request, db);
    if (!me) return err(401, "認証が必要です");
    const id = Number(parts[2]);
    if (!Number.isInteger(id)) return err(400, "idが不正です");
    await db.prepare("DELETE FROM invite_declines WHERE id = ? AND to_code = ?").bind(id, me.code).run();
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
