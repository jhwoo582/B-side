#!/bin/zsh
# 야간 배치: launchd가 매일 04:00에 실행한다. 위임 범위 = 브리프·위키 기록 + 새 비공개 플레이리스트 생성.
# 실패는 조용히 넘기지 않고 logs/nightly-YYYY-MM-DD.out에 남긴다. 예산 상한은 digger/config.py의 Budget.
cd "$(dirname "$0")/.."
mkdir -p logs
OUT="logs/nightly-$(date +%F).out"
{
  echo "=== $(date '+%F %T') 야간 디깅 시작"
  # caffeinate -i: 도는 동안 맥이 잠들면 모델 요청이 끊겨 빈 브리프가 나온다 (2026-10-13 밤)
  caffeinate -i .venv/bin/python -m digger.pipeline --nightly
  code=$?
  echo "=== $(date '+%F %T') 종료 (exit $code)"
} >> "$OUT" 2>&1
if grep -q "AUTH_WARNING" "$OUT"; then
  osascript -e 'display notification "music.youtube.com 쿠키를 다시 설정해 주세요 (setup_auth.py)" with title "디깅: YouTube Music 로그인 만료"' 2>/dev/null
fi
if [ $code -ne 0 ]; then
  osascript -e 'display notification "로그를 확인해 주세요" with title "야간 디깅 실패"' 2>/dev/null
fi
exit $code
