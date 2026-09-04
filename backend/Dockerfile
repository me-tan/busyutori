# ビルドコンテキストはリポジトリのルートを指定すること
# （frontend/data/radicals.json を読み込むため。docs/BACKEND.md 参照）
#   docker build -f backend/Dockerfile -t kanjibattle-backend .
FROM python:3.12-slim
WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app backend/app
COPY frontend/data/radicals.json frontend/data/radicals.json

WORKDIR /srv/backend
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
