import { useCallback, useSyncExternalStore } from 'react';
import { PREFERENCES_EVENT, userSettingsStorage } from './userPreferences';
import { ADMIN_TRANSLATIONS } from './adminTranslationCatalog';

export const getAdminLanguage = () => userSettingsStorage.getItem('adminLanguage') === 'ru' ? 'ru' : 'en';
export const getAdminLocale = (language = getAdminLanguage()) => language === 'ru' ? 'ru-RU' : 'en-GB';
const subscribe = (onChange) => {
  window.addEventListener(PREFERENCES_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PREFERENCES_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
export const useAdminLanguage = () => useSyncExternalStore(subscribe, getAdminLanguage, () => 'en');
export const useAdminTranslation = () => {
  const language = useAdminLanguage();
  return useCallback((value) => translateAdminText(value, language), [language]);
};

// Match complete UI messages. Captured names, file names and search queries
// are preserved; there are no global replacements in user-entered content.
const MESSAGE_TRANSLATIONS = [
  [/^Максимум (\d+) символов$/, (_, count) => `Maximum ${count} characters`],
  [/^Закрыто: (\d+)\. Не удалось: (\d+)\.$/, (_, succeeded, failed) => `Closed: ${succeeded}. Failed: ${failed}.`],
  [/^Новых аккаунтов: (\d+)\. Для новых администраторов выданы индивидуальные временные пароли\.$/, (_, count) => `New accounts: ${count}. New administrators have individual temporary passwords.`],
  [/^Назначено: (\d+)\. Не удалось: (\d+)\.$/, (_, succeeded, failed) => `Assigned: ${succeeded}. Failed: ${failed}.`],
  [/^В сравнении не учтено заявок без корректных дат: (\d+)\.$/, (_, count) => `Requests with missing or invalid dates excluded from the comparison: ${count}.`],
  [/^Экспорт найденных — (\d+) заяв(?:ок|ка|ки)$/, (_, count) => `Export matching — ${count} ${count === '1' ? 'request' : 'requests'}`],
  [/^Экспорт выбранных — (\d+) заяв(?:ок|ка|ки)$/, (_, count) => `Export selected — ${count} ${count === '1' ? 'request' : 'requests'}`],
  [/^Архив повреждён: (.+)$/, (_, file) => `Archive corrupted: ${file}`],
  [/^Выберите сотрудника из списка участников периода \((\d+)\)\.$/, (_, count) => `Select an employee from the period's participant list (${count}).`],
  [/^Некорректная настройка: (.+)$/, (_, key) => `Invalid setting: ${key}`],
  [/^Резервирование символической ссылки запрещено: (.+)$/, (_, file) => `Backing up a symbolic link is not allowed: ${file}`],
  [/^Для надёжной копии таблица (.+) должна использовать InnoDB$/, (_, table) => `Table ${table} must use InnoDB for a reliable backup`],
  [/^Файл повреждён: (.+)$/, (_, file) => `File corrupted: ${file}`],
  [/^Схема таблицы (.+) отличается от дампа\. Обновите программу до совместимой версии\.$/, (_, table) => `The schema of table ${table} differs from the dump. Update the application to a compatible version.`],
  [/^Восстановление требует InnoDB: (.+)$/, (_, table) => `Restore requires InnoDB: ${table}`],
  [/^Таблица (.+) отсутствует\. Подготовьте её миграцией или импортом схемы в MySQL\.$/, (_, table) => `Table ${table} is missing. Prepare it using a migration or a MySQL schema import.`],
  [/^Неподдерживаемый тип колонки (.+)\. Подготовьте таблицу миграцией\.$/, (_, column) => `Unsupported type for column ${column}. Prepare the table using a migration.`],
  [/^Вложение отсутствует в резервной копии: (.+)$/, (_, file) => `Attachment missing from backup: ${file}`],
  [/^Заявка #(\d+)$/, (_, id) => `Request #${id}`],
  [/^Выбрать заявку (\d+)$/, (_, id) => `Select request ${id}`],
  [/^Удалить заявку #(\d+)\? Она исчезнет из рабочего списка\.$/, (_, id) => `Delete request #${id}? It will be removed from the work list.`],
  [/^Не найдено заявок по запросу "([\s\S]*)"$/, (_, query) => `No requests found for "${query}"`],
  [/^поиск: ([\s\S]*)$/, (_, query) => `search: ${query}`],
  [/^с (.+)$/, (_, date) => `from ${date}`],
  [/^по (.+)$/, (_, date) => `to ${date}`],
  [/^· внеш\. (.+)$/, (_, phone) => `· external ${phone}`],
  [/^Данные экспортированы: (.+)$/, (_, file) => `Data exported: ${file}`],
  [/^Исполнитель назначен для (\d+) заявок$/, (_, count) => `Assignee assigned to ${count} requests`],
  [/^Можно закрывать только заявки, ожидающие подтверждения\. Исключено: (\d+)\.$/, (_, count) => `Only requests awaiting confirmation can be closed. Excluded: ${count}.`],
  [/^Закрыто заявок: (\d+)$/, (_, count) => `Requests closed: ${count}`],
  [/^Экспортировано заявок: (\d+)$/, (_, count) => `Requests exported: ${count}`],
  [/^Ошибка (?:сервера|при сохранении|при удалении|при добавлении): ([\s\S]*)$/, (_, error) => `Error: ${translateAdminText(error, 'en')}`],
  [/^(?:Произошла ошибка|Ошибка) при (добавлении|обновлении) статьи: ([\s\S]*)$/, (_, operation, error) => `Could not ${operation === 'добавлении' ? 'add' : 'update'} the article: ${translateAdminText(error, 'en')}`],
  [/^Файл "(.+)" не является изображением$/, (_, file) => `File "${file}" is not an image`],
  [/^Файл "(.+)" слишком большой\. Максимальный размер: 2MB$/, (_, file) => `File "${file}" is too large. Maximum size: 2 MB`],
  [/^Ошибка при обработке файла "(.+)"$/, (_, file) => `Could not process file "${file}"`],
  [/^Изображение (\d+)$/, (_, count) => `Image ${count}`],
  [/^Превью (\d+)$/, (_, count) => `Preview ${count}`],
  [/^Показаны первые (\d+) из (\d+) адресов$/, (_, shown, total) => `Showing the first ${shown} of ${total} addresses`],
  [/^Показаны все (\d+) адресов$/, (_, total) => `Showing all ${total} addresses`],
  [/^Показать все \((\d+)\)$/, (_, total) => `Show all (${total})`],
  [/^Последние (\d+) дн\.$/, (_, count) => `Last ${count} ${count === '1' ? 'day' : 'days'}`],
  [/^Всё время(?: · с (.+))?$/, (_, date) => `All time${date ? ` · from ${date}` : ''}`],
  [/^Заявки, где (.+) работал один$/, (_, name) => `Requests handled individually by ${name}`],
  [/^Заявки, где работали только (.+)$/, (_, names) => `Requests handled only by ${names}`],
  [/^Показаны заявки, где (.+) работал один$/, (_, name) => `Showing requests handled individually by ${name}`],
  [/^Показаны заявки, где работали только (.+)$/, (_, names) => `Showing requests handled only by ${names}`],
  [/^Справочник и учётные записи обновлены\. Активных сотрудников: (\d+)\.$/, (_, count) => `Directory and accounts refreshed. Active employees: ${count}.`],
  [/^Снято с учёта: (\d+) — проверьте отчёт ниже\.$/, (_, count) => `Deactivated: ${count} — see the report below.`],
  [/^Новых аккаунтов: (\d+); начальный пароль — 12345\.$/, (_, count) => `New accounts: ${count}; initial password: 12345.`],
  [/^Удаление (\d+) аккаунтов пропущено: справочник загружен неполностью\.$/, (_, count) => `Skipped deleting ${count} accounts: the directory was not fully loaded.`],
  [/^Сохранено\. Теперь можно прикреплять файлы до (\d+) МБ\.$/, (_, size) => `Saved. Files up to ${size} MB can now be attached.`],
  [/^Экспорт(?: SQL)?$/, (text) => text.includes('SQL') ? 'Export SQL' : 'Export'],
  [/^Восстановить «(.+)» из «(.+)»\? Текущие данные выбранного раздела будут заменены\.\s*(Перед заменой сервер сохранит копию прежних данных\.)?$/, (_, title, file, recovery) => `Restore “${translateAdminText(title, 'en')}” from “${file}”? Current data in the selected section will be replaced.${recovery ? ' The server will back up the existing data before replacing it.' : ''}`],
  [/^([\s\S]*?) Восстановлено записей: (\d+); файлов: (\d+)\.$/, (_, message, rows, files) => `${translateAdminText(message, 'en')} Records restored: ${rows}; files: ${files}.`],
  [/^(\d+) дн\. (\d\d:\d\d:\d\d)$/, (_, days, clock) => `${days} days ${clock}`]
];

export const translateAdminText = (value, language = getAdminLanguage()) => {
  if (language !== 'en' || typeof value !== 'string') return value;
  const normalized = value.trim();
  const exact = Object.prototype.hasOwnProperty.call(ADMIN_TRANSLATIONS, normalized) ? ADMIN_TRANSLATIONS[normalized] : null;
  if (exact) return value.replace(normalized, () => exact);
  for (const [pattern, render] of MESSAGE_TRANSLATIONS) {
    if (pattern.test(normalized)) return value.replace(normalized, () => normalized.replace(pattern, render));
  }
  return value;
};
