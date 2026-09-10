import React from 'react';

export default function ChatAppearanceSettings({ settings, onChange, isEnglish }) {
  return <div className="chat-design-settings">
    <label><span>{isEnglish ? 'Chat design' : 'Дизайн чата'}</span>
      <select value={settings.uiDesign || 'classic'} onChange={event => onChange('uiDesign', event.target.value)}>
        <option value="classic">{isEnglish ? 'Current' : 'Текущий'}</option>
        <option value="modern">{isEnglish ? 'New' : 'Новый'}</option>
      </select>
    </label>
    <label><span>{isEnglish ? 'Interface language' : 'Язык интерфейса'}</span>
      <select value={settings.uiLanguage || 'ru'} onChange={event => onChange('uiLanguage', event.target.value)}>
        <option value="ru">Русский</option><option value="en">English</option>
      </select>
    </label>
  </div>;
}
