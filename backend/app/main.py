"""ぶしゅとり対戦API。

REST: ルームの作成・参加。
WebSocket: 対戦中のリアルタイムなやり取り（部首を投げる/答える/結果通知）。

メッセージ形式の詳細は docs/BACKEND.md を参照。
"""
import asyncio
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import data as gamedata
from . import game as gamerules
from .rooms import Room, rooms
from .schemas import (
    CreateRoomRequest,
    CreateRoomResponse,
    JoinRoomResponse,
    QuickMatchRequest,
    QuickMatchResponse,
)

app = FastAPI(title="ぶしゅとり 対戦API")

# 開発中は全オリジン許可。本番では実際のフロントエンドのオリジンに絞ること。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/rooms", response_model=CreateRoomResponse)
def create_room(req: CreateRoomRequest) -> CreateRoomResponse:
    room = rooms.create(req.level)
    return CreateRoomResponse(code=room.code, player_id=room.host_id)


@app.post("/api/rooms/{code}/join", response_model=JoinRoomResponse)
def join_room(code: str) -> JoinRoomResponse:
    result = rooms.join(code.upper())
    if not result:
        raise HTTPException(404, "この部屋には入れません（存在しない・満員・開始済み）")
    room, guest_id = result
    return JoinRoomResponse(code=room.code, player_id=guest_id, level=room.level)


@app.delete("/api/rooms/{code}")
def cancel_room(code: str, player_id: str) -> dict:
    """ランダムマッチングで相手が見つからずあきらめたときの後始末。
    まだ相手がついていない・自分がホストの部屋しか消せない。"""
    ok = rooms.cancel_quickmatch(code.upper(), player_id)
    return {"ok": ok}


@app.post("/api/quickmatch", response_model=QuickMatchResponse)
def quickmatch(req: QuickMatchRequest) -> QuickMatchResponse:
    """同じ難易度で待っている相手がいれば即マッチ、いなければ新しく待つ側になる。"""
    room, player_id, is_host = rooms.find_or_create_quickmatch(req.level)
    return QuickMatchResponse(code=room.code, player_id=player_id, level=room.level, is_host=is_host)


async def broadcast(room: Room, message: dict) -> None:
    for ws in list(room.connections.values()):
        await ws.send_json(message)


def _start_state(room: Room) -> None:
    assert room.guest_id is not None
    room.state = gamerules.BattleState(level=room.level, attacker=room.host_id, defender=room.guest_id)
    room.started = True


async def _send_offer(room: Room) -> None:
    assert room.state is not None
    choices = gamerules.offer_radicals(room.state)
    if not choices:
        await _end_game(room, reason="exhausted", loser=None)
        return
    names = gamedata.radicals()
    await broadcast(room, {
        "type": "offer",
        "attacker": room.state.attacker,
        "choices": [
            {"radical": r, "name": names[r]["name"], "meaning": names[r]["meaning"]}
            for r in choices
        ],
        "used": sorted(room.state.used),
    })


async def _end_game(room: Room, reason: str, loser: str | None) -> None:
    reveal = None
    if room.state and room.state.current_radical:
        reveal = gamerules.reveal(room.state, room.state.current_radical)
    await broadcast(room, {"type": "game_over", "reason": reason, "loser": loser, "reveal": reveal})
    if room.timeout_task:
        room.timeout_task.cancel()
    rooms.remove(room.code)


async def _timeout_watch(room: Room, radical: str, deadline: float) -> None:
    await asyncio.sleep(max(0.0, deadline - time.time()))
    # 待っている間に正解が来たり試合が終わったりしていたら何もしない
    if room.state is None or room.state.current_radical != radical:
        return
    await _end_game(room, reason="timeout", loser=room.state.defender)


async def _handle_throw(room: Room, player_id: str, msg: dict) -> None:
    state = room.state
    if state is None or player_id != state.attacker or state.current_radical is not None:
        return
    radical = msg.get("radical")
    if not isinstance(radical, str) or radical not in state.last_offer:
        return

    state.current_radical = radical
    deadline = time.time() + gamerules.ANSWER_SECONDS
    room.timeout_task = asyncio.create_task(_timeout_watch(room, radical, deadline))
    await broadcast(room, {
        "type": "defend",
        "radical": radical,
        "defender": state.defender,
        "seconds": gamerules.ANSWER_SECONDS,
    })


async def _handle_answer(room: Room, player_id: str, msg: dict) -> None:
    state = room.state
    if state is None or player_id != state.defender or state.current_radical is None:
        return
    kanji = msg.get("kanji")
    if not isinstance(kanji, str) or not kanji:
        return

    radical = state.current_radical
    ok, reason = gamerules.is_valid_answer(state, radical, kanji)
    if not ok:
        ws = room.connections.get(player_id)
        if ws:
            await ws.send_json({"type": "answer_rejected", "reason": reason, "kanji": kanji})
        return

    if room.timeout_task:
        room.timeout_task.cancel()
    gamerules.apply_answer(state, kanji)
    await broadcast(room, {
        "type": "turn_result",
        "radical": radical,
        "kanji": kanji,
        "next_attacker": state.attacker,
        "used": sorted(state.used),
    })
    await _send_offer(room)


async def _handle_give_up(room: Room, player_id: str) -> None:
    state = room.state
    if state is None or player_id != state.defender:
        return
    await _end_game(room, reason="give_up", loser=player_id)


async def _dispatch(room: Room, player_id: str, msg: dict) -> None:
    mtype = msg.get("type")
    if mtype == "throw":
        await _handle_throw(room, player_id, msg)
    elif mtype == "answer":
        await _handle_answer(room, player_id, msg)
    elif mtype == "give_up":
        await _handle_give_up(room, player_id)


@app.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str, player_id: str) -> None:
    code = code.upper()
    room = rooms.get(code)
    if not room or player_id not in (room.host_id, room.guest_id):
        await ws.close(code=4004)
        return

    await ws.accept()
    room.connections[player_id] = ws

    if not room.started and room.guest_id and len(room.connections) == 2:
        _start_state(room)
        await broadcast(room, {
            "type": "start",
            "attacker": room.state.attacker,
            "defender": room.state.defender,
            "level": room.level,
        })
        await _send_offer(room)

    try:
        while True:
            msg = await ws.receive_json()
            await _dispatch(room, player_id, msg)
    except WebSocketDisconnect:
        room.connections.pop(player_id, None)
        if room.started and rooms.exists(room.code):
            await _end_game(room, reason="disconnect", loser=None)
