## Чат сотрудников `/employee`

В профиле, в блоке оформления, добавлены «Дизайн чата → Текущий / Новый» и отдельный язык интерфейса. Текущий дизайн остаётся выбранным по умолчанию. Настройки сохраняются локально и в профиле на сервере. Новый дизайн показывает последние диалоги, закреплённые сверху, отдельный справочник «Новый диалог» и один рабочий экран на телефоне.

Отправка использует сохраняемую очередь: сетевые ошибки повторяются с увеличением интервала до 60 секунд, остальные ошибки требуют явного повтора или редактирования сообщения. Вложения ограничены 50 МБ на файл и 10 файлами на сообщение; загрузка и отмена привязаны к исходному диалогу. История использует составной курсор и виртуализированный список. Счётчики непрочитанных и отметки прочтения поступают с сервера; после подключения SSE загруженные сообщения сверяются с сервером.

Административные инструменты сотрудников, аудита и архивов находятся в админке: `/chat-tools/employees`, `/chat-tools/audit`, `/chat-tools/archive`. Полноэкранный чат и кнопка возврата в админку сохранены.

### Обновление сервера и сессии

Клиент и сервер этого изменения следует обновлять вместе: запись массива переписки целиком заменена операцией `/threads/:id/clear`, добавлены пакетные медиатокены и сверка сообщений.

При первом входе сервер создаёт таблицу `auth_sessions`; пользователю базы нужны права `CREATE TABLE`. После обновления ранее выданные токены перестают действовать — потребуется повторный вход. Удаление аккаунта, смена пароля или роли прекращают доступ старой сессии. Открытые SSE-потоки завершаются при истечении токена; изменения аккаунта проверяются также каждые 15 секунд. Уже выданные токены отдельных файлов имеют отдельный срок действия до 10 минут.

### Журнал восстановления сообщений

MySQL остаётся основным хранилищем. Вместо полной перезаписи JSON при каждом сообщении сервер дописывает изменения в `server/data/backups/message-journal/YYYY-MM-DD.jsonl`. Сохраняйте этот каталог вместе с резервной копией базы и каталогом загрузок. Ошибки записи журнала выводятся в серверный лог; журнал не заменяет резервное копирование MySQL.

Для восстановления отсутствующих или более старых записей из журнала: `npm run recover:chat-journal`. Выполняйте восстановление в техническое окно, остановив запись сообщений другими процессами. Восстановление через раздел архивов также учитывает старые JSON-снимки. Маркеры окончательного удаления не позволяют повторно импортировать старые записи удалённой переписки; их нужно сохранять вместе с журналом. Утилита прекращает работу при повреждённой строке журнала, чтобы не скрывать потерю данных.

Журнал не удаляется автоматически: срок хранения и перенос старых файлов следует согласовать с политикой резервных копий. Перед удалением части журнала нужны проверенная полная копия базы и сохранённые маркеры окончательного удаления.

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
# React_Suz

## MySQL

Сервер использует только MySQL/MariaDB через `mysql2`. Для production можно передать одну строку подключения:

```env
MYSQL_URL=mysql://user:password@host:3306/database
```

Либо отдельные переменные:

```env
DB_HOST=mysql-host
DB_PORT=3306
DB_NAME=its
DB_USER=mysql-user
DB_PASSWORD=mysql-password
```

Также поддерживаются стандартные переменные `MYSQLHOST`, `MYSQLPORT`, `MYSQLDATABASE`, `MYSQLUSER` и `MYSQLPASSWORD`. Если провайдер требует TLS, добавьте `DB_SSL=true`.

Для локального запуска скопируйте `.env.example` в `.env`, укажите пароль MySQL и перезапустите `npm run dev`. Файл `.env` не попадает в Git.

После первого обновления выполните один раз:

```bash
npm run migrate:chat-storage
```

Команда переносит старые сообщения и вложения из JSON/BLOB на MySQL и диск, а также заполняет индекс доступа «сообщение — файл». Обычное открытие чата эту миграцию не запускает.

## Восстановление пароля

Отправка через email отключена.  
При `POST /api/auth/forgot-password` создаётся новый временный пароль и формируется служебное уведомление менеджерам (хранится в `server/data/managerNotifications.json`) и системное сообщение в MySQL-чате менеджера/сотрудника.
