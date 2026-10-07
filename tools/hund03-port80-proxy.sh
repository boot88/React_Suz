#!/usr/bin/env bash
# Адрес без порта: http://esz/   вместо   http://esz:3000/
#
# Запускать НА сервере hund03 от root (порт 80 привилегированный):
#   ssh -t qwest@192.168.129.31 'sudo bash ~/React_Suz/tools/hund03-port80-proxy.sh'
#
# Что делает: Apache в этом компьютере уже слушает порт 80, поэтому добавляется
# виртуалхост-«обратный прокси», который по именам (esz, zayavki, el-ap-sys и
# их имена в домене) отдаёт то же приложение, что и http://<имя>:3000/.
# Порт 80 по IP НЕ трогается: страница-заглушка Apache, /webmail и /phpMyAdmin
# продолжают открываться как раньше.
#
# Старые адреса с портом (http://192.168.129.31:3000/, :5000) продолжают работать:
# приложение и служба react-suz не изменяются.
#
# Повторный запуск безопасен: файл конфигурации пишется заново.
#
#   --remove              убрать виртуалхост и вернуть всё как было
#   --with-ip             заодно отдать приложение по http://192.168.129.31/
#                         (заглушка Apache заменится приложением; /webmail и
#                          /phpMyAdmin останутся открываться)
#   --help                показать эту справку
#
# Параметры окружения:
#   APP_HOST_NAMES="esz zayavki el-ap-sys"   имена (по умолчанию три)
#   APP_DOMAIN=nioch.nsc.ru                  домен для имён (пусто — без домена)
#   APP_HOST_IPS=192.168.129.31              адрес сервера
#   APP_PORT=3000                            порт приложения
#   CONF=/etc/apache2/sites-available/react-suz.conf
set -euo pipefail

APP_PORT="${APP_PORT:-3000}"
DOMAIN="${APP_DOMAIN-nioch.nsc.ru}"
NAMES="${APP_HOST_NAMES:-esz zayavki el-ap-sys}"
SITE_NAME="${SITE_NAME:-react-suz}"
CONF="${CONF:-/etc/apache2/sites-available/${SITE_NAME}.conf}"
IP="${APP_HOST_IPS:-192.168.129.31}"
WITH_IP=0
REMOVE=0

for arg in "$@"; do
  case "$arg" in
    --remove|-Remove) REMOVE=1 ;;
    --with-ip) WITH_IP=1 ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ Неизвестный параметр: $arg (см. --help)" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = "0" ] || { echo "❌ Нужны права root: sudo bash tools/${BASH_SOURCE[0]##*/}" >&2; exit 1; }
command -v apache2 >/dev/null 2>&1 || { echo "❌ Не найден Apache (apache2) — этот способ не подходит." >&2; exit 1; }

reload_apache() {
  systemctl reload apache2 2>/dev/null || systemctl restart apache2 2>/dev/null || apache2ctl graceful
}

if [ "$REMOVE" = "1" ]; then
  echo "==> Убираю адрес без порта (виртуалхост ${SITE_NAME})"
  a2dissite "$SITE_NAME" >/dev/null 2>&1 || true
  rm -f "$CONF"
  if apache2ctl configtest >/dev/null 2>&1; then
    reload_apache
    echo "Готово: по именам снова открывается прежняя страница Apache."
    echo "Приложение осталось здесь: http://${IP}:${APP_PORT}/ (и порт 5000)."
  else
    echo "⚠️  Проверьте настройки Apache: apache2ctl configtest" >&2
    exit 1
  fi
  exit 0
fi

FIRST_NAME="${NAMES%% *}"
ALIASES="$(printf '%s' "$NAMES" | tr ',' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')"
if [ -n "$DOMAIN" ]; then
  for name in $FIRST_NAME $ALIASES; do
    case " $ALIASES " in *" ${name}.${DOMAIN} "*) ;; *) ALIASES="$ALIASES ${name}.${DOMAIN}" ;; esac
  done
fi
if [ "$WITH_IP" = "1" ]; then
  case " $ALIASES " in *" $IP "*) ;; *) ALIASES="$ALIASES $IP" ;; esac
fi
SERVER_NAME="${FIRST_NAME}${DOMAIN:+.$DOMAIN}"

echo "==> Сервер: $(hostname)   приложение: 127.0.0.1:${APP_PORT}"
echo "==> Имена: ${ALIASES}   (ServerName ${SERVER_NAME})"
echo

echo "==> (1/5) Проверяю, что приложение отвечает на порту ${APP_PORT}"
if ! command -v curl >/dev/null 2>&1; then
  echo "(curl не найден — эту проверку пропускаю)"
elif curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health"; then
  echo "Приложение отвечает."
else
  echo "⚠️  Приложение не отвечает на http://127.0.0.1:${APP_PORT}/api/health." >&2
  echo "    Подсказка: systemctl --user status react-suz (от пользователя qwest)." >&2
fi

echo "==> (2/5) Включаю модули Apache: proxy, proxy_http"
a2enmod proxy proxy_http >/dev/null

echo "==> (3/5) Пишу виртуалхост $CONF"
{
  echo "# Боевое приложение React_Suz (ЭСЗ) без порта в адресе:"
  echo "#   http://${FIRST_NAME}/  ->  http://127.0.0.1:${APP_PORT}/"
  echo "# Создан скриптом tools/hund03-port80-proxy.sh — ручные правки потеряются."
  echo "<VirtualHost *:80>"
  echo -e "\tServerName ${SERVER_NAME}"
  echo -e "\tServerAlias ${ALIASES}"
  if [ "$WITH_IP" = "1" ]; then
    echo -e "\tDocumentRoot /var/www/html"
    echo -e "\t# Разделы Apache по IP оставляем на диске, в приложение они не уходят."
    echo -e "\tProxyPass /webmail !"
    echo -e "\tProxyPass /phpMyAdmin !"
  fi
  echo
  echo -e "\t# Имя из адресной строки передаём приложению как есть: приложение сверяет"
  echo -e "\t# это же имя с Origin (CORS), поэтому адрес без порта работает как с портом."
  echo -e "\tProxyPreserveHost On"
  echo -e "\tProxyRequests Off"
  echo
  echo -e "\tProxyPass        / http://127.0.0.1:${APP_PORT}/ retry=1"
  echo -e "\tProxyPassReverse / http://127.0.0.1:${APP_PORT}/"
  echo
  echo -e "\tErrorLog  \${APACHE_LOG_DIR}/react-suz-error.log"
  echo -e "\tCustomLog \${APACHE_LOG_DIR}/react-suz-access.log combined"
  echo "</VirtualHost>"
} > "$CONF"

echo "==> (4/5) Включаю сайт, проверяю конфигурацию и перезагружаю Apache"
a2ensite "$SITE_NAME" >/dev/null
if ! apache2ctl configtest >/dev/null 2>&1; then
  echo "❌ Ошибка в настройках Apache. Полный вывод:" >&2
  apache2ctl configtest || true
  echo "Откат: sudo bash tools/${BASH_SOURCE[0]##*/} --remove" >&2
  exit 1
fi
if ! systemctl is-active --quiet apache2 2>/dev/null; then
  systemctl enable --now apache2 >/dev/null 2>&1 || true
fi
reload_apache

echo "==> (5/5) Проверяю"
sleep 1
if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${FIRST_NAME}" --max-time 10 "http://127.0.0.1/" || true)"
  TITLE="$(curl -s -H "Host: ${FIRST_NAME}" --max-time 10 "http://127.0.0.1/" | grep -o '<title>[^<]*' | head -n 1 | sed 's/<title>//')"
  if [ "$CODE" = "200" ]; then
    echo "http://${FIRST_NAME}/ -> HTTP 200  ${TITLE:+«${TITLE}»}"
  else
    echo "⚠️  http://${FIRST_NAME}/ -> HTTP ${CODE:-нет ответа}" >&2
  fi
  if [ "$WITH_IP" != "1" ]; then
    if curl -s -H "Host: 127.0.0.1" --max-time 10 "http://127.0.0.1/" | grep -qi 'It works'; then
      echo "Страница Apache по IP не изменилась (http://${IP}/ — как и было)."
    fi
  fi
else
  echo "(curl не найден — проверьте вручную: http://${FIRST_NAME}/, http://${IP}:${APP_PORT}/)"
fi

echo
echo "✅ Готово. Адреса без порта:"
for name in $ALIASES; do
  echo "     http://${name}/"
done
echo "   Прежние адреса тоже работают: http://${IP}:${APP_PORT}/ и порт 5000."
echo "   Настройки клиентов и сборку менять не нужно (клиент обращается к /api)."
echo "   Убрать: sudo bash tools/${BASH_SOURCE[0]##*/} --remove"
