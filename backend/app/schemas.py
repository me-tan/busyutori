"""REST API のリクエスト/レスポンス型。WebSocketのメッセージはJSONの辞書を
直接やり取りしており、型定義は docs/BACKEND.md のプロトコル仕様を正とする。
"""
from typing import Literal

from pydantic import BaseModel

Level = Literal["low", "elem", "all"]


class CreateRoomRequest(BaseModel):
    level: Level = "elem"


class CreateRoomResponse(BaseModel):
    code: str
    player_id: str


class JoinRoomResponse(BaseModel):
    code: str
    player_id: str
    level: Level


class QuickMatchRequest(BaseModel):
    level: Level = "elem"


class QuickMatchResponse(BaseModel):
    code: str
    player_id: str
    level: Level
    is_host: bool
