"""音源ファイルの音量を下げて作り直す。macOS標準のafconvertを使う。

iOSはJSからの音量指定（<audio>.volume）を無視して端末の音量で鳴らすため、
アプリ側から音を小さくできない。そこで音源そのものを小さい音で作り直す。

  python3 scripts/lower_audio_volume.py <入力> <出力> <倍率> <ビットレート>
  例: python3 scripts/lower_audio_volume.py frontend/assets/bgm/menu.m4a /tmp/out.m4a 0.25 96000

現在の音源は、BGMを0.25倍(-12dB)、効果音を0.5倍(-6dB)にしたもの。
"""
import array, os, struct, subprocess, sys

WORK = '/tmp/aud'

def read_wav(path):
    """afconvertが書くWAVE_FORMAT_EXTENSIBLEも読めるように自前で解析する。"""
    data = open(path, 'rb').read()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE', 'WAVではない'
    pos, fmt, pcm = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos+4]
        size = struct.unpack('<I', data[pos+4:pos+8])[0]
        body = data[pos+8:pos+8+size]
        if cid == b'fmt ':
            ch, rate, _, _, bits = struct.unpack('<HIIHH', body[2:16])
            fmt = (ch, rate, bits)
        elif cid == b'data':
            pcm = body
        pos += 8 + size + (size & 1)
    assert fmt and pcm is not None, 'fmt/dataが見つからない'
    return fmt, pcm

def write_wav(path, fmt, pcm):
    ch, rate, bits = fmt
    block = ch * bits // 8
    hdr = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE'
    hdr += b'fmt ' + struct.pack('<IHHIIHH', 16, 1, ch, rate, rate * block, block, bits)
    hdr += b'data' + struct.pack('<I', len(pcm))
    open(path, 'wb').write(hdr + pcm)

def lower(src, dst, gain, bitrate):
    base = os.path.basename(src)
    wav_in = os.path.join(WORK, base + '.in.wav')
    wav_out = os.path.join(WORK, base + '.out.wav')
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16', src, wav_in], check=True)
    fmt, pcm = read_wav(wav_in)
    assert fmt[2] == 16, '16bitではない'
    s = array.array('h'); s.frombytes(pcm)
    for i in range(len(s)):
        s[i] = int(s[i] * gain)
    write_wav(wav_out, fmt, s.tobytes())
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(bitrate), wav_out, dst], check=True)

if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    src, dst, gain, bitrate = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
    lower(src, dst, gain, bitrate)
    print(f"{src} -> {dst}: {os.path.getsize(src)} -> {os.path.getsize(dst)} bytes (音量 x{gain})")
