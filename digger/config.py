"""경로·모델·예산 설정. 모델은 환경변수로 바꿀 수 있다(DIGGER_RESEARCHER_MODEL 등)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS = ROOT / ".secrets"
DATA = ROOT / "data"
# DIGGER_HOME으로 브리프·위키 위치를 바꿀 수 있다 (UI 확인용 테스트 데이터를 실제 데이터와 분리)
HOME = Path(os.environ.get("DIGGER_HOME", ROOT))
BRIEFS = HOME / "briefs"
WIKI = HOME / "wiki" / "artists"
LOGS = ROOT / "logs"

KMA_PATH = DATA / "kma_nominees.json"
TASTE_PATH = DATA / "taste_map.json"
YTM_AUTH = SECRETS / "ytmusic_browser.json"

OPENROUTER_URL = "https://openrouter.ai/api/v1"


def secret(name: str, env: str | None = None) -> str:
    value = os.environ.get(env or name.upper(), "").strip()
    if not value and (SECRETS / name).exists():
        value = (SECRETS / name).read_text().strip()
    if not value:
        raise RuntimeError(f"키가 없습니다: .secrets/{name} 또는 환경변수 {env or name.upper()}")
    return value


@dataclass
class Models:
    # 전부 Hugging Face에 가중치가 공개된 오픈웨이트 모델. OpenRouter → vLLM 온프레미스로 옮겨도 이름만 바뀐다.
    # 선택 근거: 2026-10-14 역할별 벤치 (bench/, '디깅 에이전트 모델 선택 근거' 문서)
    # 리서처: 공개 데이터 + 익명화된 방향만 받는다. 3회 평균 4.7/5로 가장 안정적.
    researcher: str = os.environ.get("DIGGER_RESEARCHER_MODEL", "deepseek/deepseek-v4-pro-0813")
    # 로컬(개인 데이터 경계 안): 점원·추천 이유·취향 노트·말대꾸·익명화. GPU 1장(31B), 개인 사정 유출 0/6.
    local: str = os.environ.get("DIGGER_LOCAL_MODEL", "google/gemma-4-31b-it")
    # 검수는 리서처와 다른 계열이어야 자기 채점이 되지 않는다. 근거 40문항 전부 정답.
    judge: str = os.environ.get("DIGGER_JUDGE_MODEL", "google/gemma-4-31b-it")
    # 추천 이유의 '지어내기 검사'. 쓰는 모델(local=Gemma)과 다른 계열이어야 한다.
    ground: str = os.environ.get("DIGGER_GROUND_MODEL", "qwen/qwen3.6-35b-a3b")


@dataclass
class Budget:
    max_tool_calls: int = 140
    max_cost_usd: float = 0.80
    max_seconds: int = 20 * 60
    max_retries_per_candidate: int = 2
    new_artists: int = 8
    hidden_tracks: int = 2


@dataclass
class Settings:
    models: Models = field(default_factory=Models)
    budget: Budget = field(default_factory=Budget)
    max_monthly_listeners: int = 100_000
