"""対戦ルームの管理。プロセスのメモリ上だけに状態を持つ(DB不要)。

サーバーを再起動すると進行中の対戦は消える。個人開発の小規模な対戦ゲームで
あればこれで十分だが、複数プロセス/複数インスタンスでスケールする場合は
外部ストア（Redis等）への切り出しが必要になる。
"""
import asyncio
import secrets
from dataclasses import dataclass, field

from fastapi import WebSocket

from . import game as gamerules

# 紛らわしい文字(0/O, 1/I など)を除いたルームコード用アルファベット
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 5


def _new_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


@dataclass
class Room:
    code: str
    level: str
    host_id: str
    guest_id: str | None = None
    state: gamerules.BattleState | None = None
    connections: dict[str, WebSocket] = field(default_factory=dict)
    timeout_task: "asyncio.Task | None" = None
    started: bool = False
    quickmatch: bool = False
    post_game: bool = False  # 対戦終了後、再戦の返事を待っている状態か
    rematch_votes: set[str] = field(default_factory=set)


class RoomStore:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def create(self, level: str, quickmatch: bool = False) -> Room:
        code = _new_code()
        while code in self._rooms:
            code = _new_code()
        room = Room(code=code, level=level, host_id=secrets.token_urlsafe(8), quickmatch=quickmatch)
        self._rooms[code] = room
        return room

    def get(self, code: str) -> Room | None:
        return self._rooms.get(code)

    def join(self, code: str) -> tuple[Room, str] | None:
        room = self._rooms.get(code)
        if not room or room.guest_id is not None or room.started:
            return None
        guest_id = secrets.token_urlsafe(8)
        room.guest_id = guest_id
        return room, guest_id

    def find_or_create_quickmatch(self, level: str) -> tuple[Room, str, bool]:
        """同じ難易度で相手を待っているランダムマッチの部屋があれば参加し、
        なければ新しく作って待つ側になる。戻り値は (room, player_id, is_host)。
        """
        for room in self._rooms.values():
            if room.quickmatch and room.level == level and room.guest_id is None and not room.started:
                guest_id = secrets.token_urlsafe(8)
                room.guest_id = guest_id
                return room, guest_id, False
        room = self.create(level, quickmatch=True)
        return room, room.host_id, True

    def cancel_quickmatch(self, code: str, player_id: str) -> bool:
        """待っている間にあきらめた場合の後始末。まだ相手がついていない、
        自分（ホスト）の部屋である場合だけ削除できる。"""
        room = self._rooms.get(code)
        if not room or room.host_id != player_id or room.guest_id is not None:
            return False
        self._rooms.pop(code, None)
        return True

    def remove(self, code: str) -> None:
        self._rooms.pop(code, None)

    def exists(self, code: str) -> bool:
        return code in self._rooms


rooms = RoomStore()
