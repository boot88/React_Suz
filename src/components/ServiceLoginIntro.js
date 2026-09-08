import React from 'react';

export const SERVICE_LOGIN_LABELS = {
  ru: {
    brand: 'Учёт заявок', network: 'Внутренняя сеть', employee: 'Сотрудникам', admin: 'Администраторам',
    employeeTitle: 'Помощь рядом.\nРабота продолжается.', adminTitle: 'Меньше ожидания.\nБольше решений.',
    employeeText: 'Сообщите о неполадке, следите за решением и общайтесь с коллегами — в одном месте.',
    adminText: 'Заявки сотрудников, общение и история работ. Всё, что нужно команде технической поддержки.',
    computers: 'Компьютеры', networkService: 'Сеть и доступ', software: 'Программы',
    example: 'Как это работает', ticket: 'Нужна установка программы', category: 'Программное обеспечение',
    sent: 'Заявка отправлена', progress: 'В работе', done: 'Готово',
    messageTitle: 'Всегда на связи', message: 'Детали задачи можно уточнить в чате.',
    adminMessageTitle: 'От заявки до результата', adminMessage: 'Сотрудник видит, как продвигается работа.',
    employeeLogin: 'Вход сотрудника', adminLogin: 'Вход администратора',
    employeeHint: 'Выберите себя в списке и введите пароль.', adminHint: 'Выберите свой аккаунт и введите пароль.',
    employeeAction: 'Войти в рабочий чат', adminAction: 'Открыть панель заявок',
    note: 'Доступ для сотрудников во внутренней сети.', adminNote: 'Рабочее пространство команды поддержки.',
    formKicker: 'ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО', adminFormKicker: 'ТЕХНИЧЕСКАЯ ПОДДЕРЖКА',
    footer: 'Одна система. Общая работа.', designService: 'Сервис', employeeEntry: 'Вход сотрудника', adminEntry: 'Вход администратора',
  },
  en: {
    brand: 'Service Desk', network: 'Internal network', employee: 'For employees', admin: 'For administrators',
    employeeTitle: 'Help is here.\nKeep work moving.', adminTitle: 'Less waiting.\nMore resolving.',
    employeeText: 'Report an issue, follow its progress and stay connected with colleagues. All in one place.',
    adminText: 'Employee requests, conversations and work history. Everything your IT support team needs.',
    computers: 'Computers', networkService: 'Network & access', software: 'Software',
    example: 'How it works', ticket: 'Software installation needed', category: 'Software',
    sent: 'Request sent', progress: 'In progress', done: 'Resolved',
    messageTitle: 'Stay connected', message: 'Work out the details together in chat.',
    adminMessageTitle: 'From request to resolution', adminMessage: 'Keep employees informed as work progresses.',
    employeeLogin: 'Employee sign in', adminLogin: 'Administrator sign in',
    employeeHint: 'Choose your name and enter your password.', adminHint: 'Choose your account and enter your password.',
    employeeAction: 'Enter workspace', adminAction: 'Open service desk',
    note: 'Employee access on the internal network.', adminNote: 'A workspace for the IT support team.',
    formKicker: 'YOUR WORKSPACE', adminFormKicker: 'IT SUPPORT',
    footer: 'One workspace. Better together.', designService: 'Service', employeeEntry: 'Employee sign in', adminEntry: 'Administrator sign in',
  },
};

export const ServiceIcon = ({ name, ...props }) => {
  const paths = {
    mark: <><path d="M5 4h14v12H9l-4 4V4Z" /><path d="m9 10 2 2 4-4" /></>,
    computer: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 21h8m-4-5v5" /></>,
    network: <><rect x="8" y="2" width="8" height="6" rx="1" /><path d="M12 8v5M5 16v-3h14v3" /><rect x="2" y="16" width="6" height="5" rx="1" /><rect x="16" y="16" width="6" height="5" rx="1" /></>,
    software: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 8h18m-12 4-3 3 3 3m6-6 3 3-3 3" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" /></>,
    chat: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z" /><path d="M7 10h10M7 14h6" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.mark}</svg>;
};

export default function ServiceLoginIntro({ isAdminMode, labels }) {
  return (
    <aside className="service-intro">
      <span className="service-eyebrow"><span />{labels[isAdminMode ? 'admin' : 'employee']}</span>
      <h2>{labels[isAdminMode ? 'adminTitle' : 'employeeTitle']}</h2>
      <p className="service-intro-copy">{labels[isAdminMode ? 'adminText' : 'employeeText']}</p>
      <div className="service-categories">
        {[['computer', 'computers'], ['network', 'networkService'], ['software', 'software']].map(([icon, label]) => (
          <span key={icon}><ServiceIcon name={icon} />{labels[label]}</span>
        ))}
      </div>
      <div className="service-illustration">
        <span className="service-example-label">{labels.example}<span aria-hidden="true">↗</span></span>
        <div className="service-ticket">
          <div className="service-ticket-top"><span className="service-ticket-icon"><ServiceIcon name="software" /></span><span>{labels.category}</span><span className="service-ticket-dots" aria-hidden="true">•••</span></div>
          <strong>{labels.ticket}</strong>
          <div className="service-steps">
            <span><i>✓</i>{labels.sent}</span><span className="is-current"><i /><b>{labels.progress}</b></span><span><i />{labels.done}</span>
          </div>
        </div>
        <div className="service-chat-note"><span className="service-chat-icon"><ServiceIcon name="chat" /></span><div><strong>{labels[isAdminMode ? 'adminMessageTitle' : 'messageTitle']}</strong><p>{labels[isAdminMode ? 'adminMessage' : 'message']}</p></div></div>
        <div className="service-orbit" aria-hidden="true" />
      </div>
    </aside>
  );
}
