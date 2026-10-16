# Service Desk / React_Suz

Веб-приложение для учёта обращений сотрудников и работы технической поддержки: административная панель, корпоративный чат и база знаний.

**[Открыть актуальную версию → dev/test-stand](https://github.com/boot88/React_Suz/tree/dev/test-stand)** · [Документация запуска и сопровождения](https://github.com/boot88/React_Suz/blob/dev/test-stand/README.md) · [GitHub Actions](https://github.com/boot88/React_Suz/actions/workflows/ci.yml)

## Где находится текущая разработка

Этот README находится в ветке `main`, где сохранена ранняя версия приложения. Описанные ниже возможности относятся к **`dev/test-stand`**. Для просмотра современного клиента, API, тестов и Docker-конфигурации переходите в эту ветку.

## Возможности актуальной версии

- Подача и отмена сотрудником собственной заявки из чата.
- Очередь заявок для администраторов: назначение исполнителя, статусы, редактирование и история действий.
- Проверка версии заявки при сохранении, чтобы обнаруживать конкурирующие изменения.
- Корпоративные переписки, вложения, лента и рассылки сотрудникам.
- Справочник сотрудников и база знаний.
- Статистика, фильтры и экспорт заявок в Excel.
- Резервное копирование и восстановление данных.
- Персональные настройки, русский и английский интерфейсы.

## Технологии

| Часть | Стек |
| --- | --- |
| Интерфейс | React, React Router, JavaScript, CSS, Recharts |
| API | Node.js, Express |
| Данные | MySQL, файловое хранилище вложений |
| Проверки | Jest, node:test, ESLint |
| Сборка и доставка | Docker, Docker Compose, GitHub Actions |

## Навигация по коду

- [Страницы административной панели](https://github.com/boot88/React_Suz/tree/dev/test-stand/src/pages).
- [Компоненты чата и профиля](https://github.com/boot88/React_Suz/tree/dev/test-stand/src/components/employeeChat).
- [Маршруты API](https://github.com/boot88/React_Suz/tree/dev/test-stand/server/routes).
- [Серверные проверки и служебные функции](https://github.com/boot88/React_Suz/tree/dev/test-stand/server/utils).
- [Dockerfile](https://github.com/boot88/React_Suz/blob/dev/test-stand/Dockerfile), [Compose](https://github.com/boot88/React_Suz/blob/dev/test-stand/compose.yaml) и [CI](https://github.com/boot88/React_Suz/blob/dev/test-stand/.github/workflows/ci.yml).

## Получить актуальный код

```bash
git clone --branch dev/test-stand --single-branch https://github.com/boot88/React_Suz.git
cd React_Suz
npm ci
```

Для запуска требуется настроенная MySQL и переменные окружения. Порядок настройки, миграций и восстановления описан в [README актуальной ветки](https://github.com/boot88/React_Suz/blob/dev/test-stand/README.md).

Проверки в актуальной ветке:

```bash
npm run lint
npm run test:all
npm run build
```

Клиент и сервер обновляются вместе. Демонстрационные и тестовые окружения должны использовать отдельные базы данных.
