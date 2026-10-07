#!/usr/bin/env bash
# Понятные имена для боевого приложения React_Suz (ЭСЗ):
#   http://esz:3000/   http://zayavki.nioch.nsc.ru:3000/   http://el-ap-sys:3000/
#
# Скрипт правит файл hosts КЛИЕНТСКОГО компьютера (Linux/macOS), чтобы имена
# указывали на сервер hund03. На самом сервере его запускать не нужно: служба
# react-suz слушает все адреса машины (0.0.0.0), а имена живут в hosts у клиентов.
#
# Обычно этот скрипт не нужен: в сети НИОХ имена разрешаются через DNS
# (esz — с клиентской сети, zayavki.nioch.nsc.ru — отовсюду). Запускайте его
# там, где имя не открывается, а по IP http://192.168.129.31:3000 всё работает,
# или если браузер ходит через VPN/прокси (там нужен ещё список обхода —
# см. раздел «Имена для входа» в README).
#
#   sudo bash tools/setup-client-name.sh            — добавить/обновить записи
#   sudo bash tools/setup-client-name.sh --remove   — убрать записи
#
# Параметры (переменные окружения):
#   APP_HOST_NAMES="esz zayavki el-ap-sys"   какие имена добавить (по умолчанию три)
#   APP_HOST_NAME=esz                        одно имя (старый вариант, тоже работает)
#   APP_HOST_IPS="192.168.129.31"            адрес сервера (можно несколько через пробел)
#   APP_PORT=3000                            порт для проверки доступности
#   HOSTS_FILE=/etc/hosts                    какой файл править
#   DRY_RUN=1                                показать, что будет записано, и ничего не менять
#
# Если HOSTS_FILE не /etc/hosts (например, для проверки скрипта), права root
# не требуются. Для Windows используйте tools/setup-client-name.ps1 (или .cmd).
set -euo pipefail

NAMES="${APP_HOST_NAMES:-${APP_HOST_NAME:-esz zayavki el-ap-sys}}"
IPS="${APP_HOST_IPS:-192.168.129.31}"
PORT="${APP_PORT:-3000}"
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"
DRY_RUN="${DRY_RUN:-0}"
MARKER="# React_Suz production server (hund03) - added by tools/setup-client-name.sh"

REMOVE=0
for arg in "$@"; do
  case "$arg" in
    --remove|-Remove) REMOVE=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "❌ Неизвестный параметр: $arg" >&2; exit 1 ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '⚠️  %s\n' "$1"; }

# Системный файл hosts — только от root. Свой файл (проверка) правим как угодно.
SYSTEM_HOSTS=0
[ "$HOSTS_FILE" = "/etc/hosts" ] && SYSTEM_HOSTS=1
REMOVE_HINT=""
[ "$REMOVE" -eq 1 ] && REMOVE_HINT=" --remove"

if [ "$SYSTEM_HOSTS" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
  echo "❌ Чтобы изменить $HOSTS_FILE, нужны права администратора." >&2
  echo "   Запустите: sudo bash $0$REMOVE_HINT" >&2
  echo "   (или проверьте без системного файла: HOSTS_FILE=/tmp/hosts-test bash $0)" >&2
  exit 1
fi

[ -f "$HOSTS_FILE" ] || { echo "❌ Не найден файл $HOSTS_FILE" >&2; exit 1; }

log "Файл: $HOSTS_FILE"
echo "Имена: $NAMES  ->  $IPS"
[ "$DRY_RUN" = "1" ] && echo "(DRY_RUN — файл не изменяется)"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Убираем прежние записи этих имён и прежний маркер: повторный запуск
# обновляет адрес, а не дописывает строки заново. Маркер ищем как простой
# текст (grep -F): в нём есть скобки и точки, для шаблона они особые.
NAME_PATTERNS=""
for name in $NAMES; do
  NAME_PATTERNS="${NAME_PATTERNS:+$NAME_PATTERNS|}(^|[[:space:]])${name//./\\.}([[:space:]]|$)"
done
grep -vE "$NAME_PATTERNS" "$HOSTS_FILE" | grep -vF "$MARKER" > "$TMP" || true
# Файл должен заканчиваться переводом строки, иначе новая строка прилипнет к прежней.
if [ -s "$TMP" ] && [ "$(tail -c 1 "$TMP" | wc -l)" -eq 0 ]; then
  printf '\n' >> "$TMP"
fi

if [ "$REMOVE" -eq 1 ]; then
  echo "Удаляю записи: ${NAMES} (если были)."
  if [ "$DRY_RUN" != "1" ]; then
    cat "$TMP" > "$HOSTS_FILE"
    chmod 0644 "$HOSTS_FILE"
  fi
else
  for ip in $IPS; do
    printf '%s\t%s\n' "$ip" "$NAMES" >> "$TMP"
    echo "Добавляю: $ip -> $NAMES"
  done
  printf '%s\n' "$MARKER" >> "$TMP"
  if [ "$DRY_RUN" = "1" ]; then
    log "Что получится"
    tail -n "$(( $(echo "$IPS" | wc -w) + 1 ))" "$TMP"
  else
    # Резервная копия нужна один раз: если запись мешает, файл легко вернуть.
    [ -f "${HOSTS_FILE}.react-suz.bak" ] || cp -p "$HOSTS_FILE" "${HOSTS_FILE}.react-suz.bak"
    cat "$TMP" > "$HOSTS_FILE"
    chmod 0644 "$HOSTS_FILE"
    echo "Резервная копия: ${HOSTS_FILE}.react-suz.bak"
  fi
fi

log "Проверяю"
if [ "$SYSTEM_HOSTS" -eq 1 ]; then
  for name in $NAMES; do
    if resolved="$(getent hosts "$name" 2>/dev/null)"; then
      echo "  ✅ $name -> $(printf '%s' "$resolved" | head -1 | awk '{print $1}')"
    else
      warn "Имя $name пока не разрешается — откройте новую сессию или вкладку браузера."
    fi
  done
else
  echo "Проверяю несистемный файл — разрешение имён не проверяется."
fi

if [ "$REMOVE" -eq 1 ]; then
  echo "✅ Готово: имена ${NAMES} больше не задаются в $HOSTS_FILE."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "✅ Проверка завершена, файл не изменён. Запустите без DRY_RUN (и с sudo) для реальной записи."
  exit 0
fi

if command -v curl >/dev/null 2>&1; then
  for name in $NAMES; do
    CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://${name}:${PORT}/" || true)"
    if [ "$CODE" = "200" ]; then
      echo "✅ Работает: http://${name}:${PORT}/ (HTTP $CODE)"
    else
      warn "Имя ${name} разрешается, но приложение ответило '${CODE:-нет ответа}'."
      echo "   Проверьте, что сервер включён и служба активна:"
      echo "     ssh qwest@${IPS%% *} 'systemctl --user status react-suz'"
    fi
  done
fi

echo ""
echo "Дальше:"
for name in $NAMES; do
  echo "  приложение:      http://${name}:${PORT}/"
done
cat <<EOF
  адрес по IP:     http://${IPS%% *}:${PORT}/   (и порт 5000 для старых ссылок)
  убрать записи:   sudo bash $0 --remove
Если администратор включил адрес без порта (README, раздел «Адрес без порта»),
достаточно http://${NAMES%% *}/ — номер порта писать не нужно.
Если браузер ходит через VPN/прокси, добавьте внутренние имена в список обхода
(README, раздел «Имена для входа») — иначе имена на VPN-окне не разрешаются.
EOF
