"use strict";
/* フレンド・ユーザー機能のクライアント。/api/* は同一オリジンなので相対パスで呼ぶ。 */
(function () {
  const KEY = "kbPlayerProfile";

  function getProfile() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function saveProfile(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  function clearProfile() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function authHeaders() {
    const p = getProfile();
    return { "Content-Type": "application/json", "Authorization": "Bearer " + (p ? p.token : "") };
  }
  async function readJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "通信に失敗しました");
    return data;
  }

  async function createProfile(username, password, nickname) {
    const res = await fetch("/api/players", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, nickname }),
    });
    const data = await readJson(res);
    saveProfile({ code: data.code, token: data.token, nickname: data.nickname });
    return data;
  }

  async function login(username, password) {
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await readJson(res);
    saveProfile({ code: data.code, token: data.token, nickname: data.nickname });
    return data;
  }

  async function renameProfile(nickname) {
    const res = await fetch("/api/players/me", { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ nickname }) });
    const data = await readJson(res);
    const p = getProfile();
    if (p) saveProfile({ ...p, nickname: data.nickname });
    return data;
  }

  async function addFriend(code) {
    const res = await fetch("/api/friends", { method: "POST", headers: authHeaders(), body: JSON.stringify({ code }) });
    return readJson(res);
  }

  async function removeFriend(code) {
    const res = await fetch("/api/friends/" + encodeURIComponent(code), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  async function listRemovals() {
    const res = await fetch("/api/removals", { headers: authHeaders() });
    const data = await readJson(res);
    return data.removals;
  }

  async function dismissRemoval(id) {
    const res = await fetch("/api/removals/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  async function listFriends() {
    const res = await fetch("/api/friends", { headers: authHeaders() });
    const data = await readJson(res);
    return data.friends;
  }

  async function listFriendRequests() {
    const res = await fetch("/api/friends/requests", { headers: authHeaders() });
    const data = await readJson(res);
    return data.requests;
  }

  async function acceptFriendRequest(code) {
    const res = await fetch("/api/friends/" + encodeURIComponent(code) + "/accept", { method: "POST", headers: authHeaders() });
    return readJson(res);
  }

  async function declineFriendRequest(code) {
    const res = await fetch("/api/friends/" + encodeURIComponent(code) + "/decline", { method: "POST", headers: authHeaders() });
    return readJson(res);
  }

  async function getMe() {
    const res = await fetch("/api/players/me", { headers: authHeaders() });
    return readJson(res);
  }

  function submitScore(level, streak) {
    if (!getProfile()) return;
    fetch("/api/scores", { method: "POST", headers: authHeaders(), body: JSON.stringify({ level, streak }) }).catch(() => {});
  }

  async function listCleared() {
    const res = await fetch("/api/cleared", { headers: authHeaders() });
    const data = await readJson(res);
    return data.cleared;
  }

  function markCleared(level, radical) {
    if (!getProfile()) return;
    fetch("/api/cleared", {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ level, radical }),
    }).catch(() => {});
  }

  async function listRanking(level) {
    const res = await fetch("/api/ranking?level=" + encodeURIComponent(level), { headers: authHeaders() });
    const data = await readJson(res);
    return data.ranking;
  }

  async function sendInvite(code, roomCode, level) {
    const res = await fetch("/api/invites", {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ code, room_code: roomCode, level }),
    });
    return readJson(res);
  }

  async function cancelInvite(roomCode) {
    const res = await fetch("/api/invites/room/" + encodeURIComponent(roomCode), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  async function listInvites() {
    const res = await fetch("/api/invites", { headers: authHeaders() });
    const data = await readJson(res);
    return data.invites;
  }

  async function dismissInvite(id) {
    const res = await fetch("/api/invites/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  async function declineInvite(id) {
    const res = await fetch("/api/invites/" + encodeURIComponent(id) + "/decline", { method: "POST", headers: authHeaders() });
    return readJson(res);
  }

  async function listInviteDeclines() {
    const res = await fetch("/api/invite-declines", { headers: authHeaders() });
    const data = await readJson(res);
    return data.declines;
  }

  async function dismissInviteDecline(id) {
    const res = await fetch("/api/invite-declines/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  async function listInviteCancels() {
    const res = await fetch("/api/invite-cancels", { headers: authHeaders() });
    const data = await readJson(res);
    return data.cancels;
  }

  async function dismissInviteCancel(id) {
    const res = await fetch("/api/invite-cancels/" + encodeURIComponent(id), { method: "DELETE", headers: authHeaders() });
    return readJson(res);
  }

  window.Players = {
    getProfile, saveProfile, clearProfile, getMe,
    createProfile, login, renameProfile, addFriend, removeFriend, listFriends, submitScore,
    listCleared, markCleared,
    listRemovals, dismissRemoval,
    listFriendRequests, acceptFriendRequest, declineFriendRequest,
    listRanking, sendInvite, cancelInvite, listInvites, dismissInvite, declineInvite,
    listInviteDeclines, dismissInviteDecline,
    listInviteCancels, dismissInviteCancel,
  };
})();
