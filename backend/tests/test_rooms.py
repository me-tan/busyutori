from app.rooms import RoomStore


def test_quickmatch_first_caller_becomes_host_and_waits():
    store = RoomStore()
    room, player_id, is_host = store.find_or_create_quickmatch("elem")
    assert is_host is True
    assert player_id == room.host_id
    assert room.guest_id is None
    assert room.quickmatch is True


def test_quickmatch_second_caller_joins_existing_waiting_room():
    store = RoomStore()
    room1, host_id, _ = store.find_or_create_quickmatch("elem")
    room2, guest_id, is_host2 = store.find_or_create_quickmatch("elem")
    assert room2.code == room1.code
    assert is_host2 is False
    assert guest_id == room1.guest_id
    assert guest_id != host_id


def test_quickmatch_does_not_pair_across_different_levels():
    store = RoomStore()
    room_low, _, _ = store.find_or_create_quickmatch("low")
    room_all, _, is_host = store.find_or_create_quickmatch("all")
    assert room_low.code != room_all.code
    assert is_host is True


def test_quickmatch_ignores_rooms_already_started_or_full():
    store = RoomStore()
    room1, host_id, _ = store.find_or_create_quickmatch("elem")
    room1.started = True  # 既に始まっている部屋は新しい相手を受け付けない
    room2, _, is_host2 = store.find_or_create_quickmatch("elem")
    assert room2.code != room1.code
    assert is_host2 is True


def test_cancel_quickmatch_removes_waiting_room():
    store = RoomStore()
    room, host_id, _ = store.find_or_create_quickmatch("elem")
    assert store.cancel_quickmatch(room.code, host_id) is True
    assert store.get(room.code) is None


def test_cancel_quickmatch_fails_if_already_matched():
    store = RoomStore()
    room, host_id, _ = store.find_or_create_quickmatch("elem")
    store.find_or_create_quickmatch("elem")  # 相手が参加してマッチ成立
    assert store.cancel_quickmatch(room.code, host_id) is False
    assert store.get(room.code) is not None


def test_cancel_quickmatch_fails_for_wrong_player():
    store = RoomStore()
    room, host_id, _ = store.find_or_create_quickmatch("elem")
    assert store.cancel_quickmatch(room.code, "someone-else") is False
    assert store.get(room.code) is not None
