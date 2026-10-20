#!/bin/zsh
# 야간 배치를 launchd에 등록한다 (매일 04:00). 해제: ./scripts/install_nightly.sh --uninstall
# 맥이 잠자기 중이면 깨어난 직후 한 번 실행된다(StartCalendarInterval 동작). 완전히 꺼져 있으면 건너뛴다.
set -e
mkdir -p "$HOME/Library/LaunchAgents"
LABEL="com.digging-agent.nightly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$1" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "해제했습니다: $LABEL"
  exit 0
fi

chmod +x "$ROOT/scripts/nightly.sh"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$ROOT/scripts/nightly.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/launchd.err</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "등록했습니다: 매일 04:00 → $ROOT/scripts/nightly.sh"
echo "지금 한 번 시험 실행: launchctl kickstart gui/$(id -u)/$LABEL"
