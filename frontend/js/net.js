"use strict";
// オンライン対戦の通信クライアント。REST(部屋の作成/参加) と
// WebSocket(対戦中のやり取り) をまとめる。プロトコルは docs/BACKEND.md 参照。

const Net = (() => {
  let ws = null;
  let handlers = {};

  async function createRoom(level) {
    const res = await fetch(`${API_BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    if (!res.ok) throw new Error("failed to create room");
    return res.json(); // { code, player_id }
  }

  async function joinRoom(code) {
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("failed to join room");
    return res.json(); // { code, player_id, level }
  }

  function connect(code, playerId) {
    close();
    const wsBase = API_BASE.replace(/^http/, "ws");
    ws = new WebSocket(
      `${wsBase}/ws/rooms/${encodeURIComponent(code)}?player_id=${encodeURIComponent(playerId)}`
    );
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const fn = handlers[msg.type];
      if (fn) fn(msg);
    };
    ws.onclose = () => { if (handlers.closed) handlers.closed(); };
    ws.onerror = () => { if (handlers.error) handlers.error(); };
  }

  function on(type, fn) {
    handlers[type] = fn;
  }

  function send(type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type, ...payload }));
  }

  function close() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    handlers = {};
  }

  return { createRoom, joinRoom, connect, on, send, close };
})();
