import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Support.css';

const Support = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    priority: 'normal'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Здесь будет логика отправки формы (можно интегрировать с email-сервисом)
      console.log('Данные формы поддержки:', formData);
      
      // Имитация отправки
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setMessage({
        text: 'Ваше сообщение успешно отправлено! Мы ответим вам в ближайшее время.',
        type: 'success'
      });
      
      // Очищаем форму после успешной отправки
      setFormData({
        name: '',
        email: '',
        subject: '',
        message: '',
        priority: 'normal'
      });
      
    } catch (error) {
      setMessage({
        text: 'Произошла ошибка при отправке сообщения. Попробуйте еще раз.',
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const contactInfo = [
    {
      icon: '📧',
      title: 'Электронная почта',
      value: 'povisok@nioch.nsc.ru',
      description: 'Основной канал связи для технической поддержки'
    },
    {
      icon: '🕒',
      title: 'Время ответа',
      value: '24-48 часов',
      description: 'Среднее время ответа на запросы'
    },
    {
      icon: '📞',
      title: 'Телефон поддержки',
      value: '+7 (383) 330-72-83, 1-380', 
      description: 'Для срочных вопросов в рабочее время'
    },
    {
      icon: '🏢',
      title: 'Адрес',
      value: 'Новосибирск, пр. Академика Лаврентьева, 9',
      description: 'Институт органической химии им. Н.Н. Ворожцова СО РАН'
    }
  ];

  const faqItems = [
    {
      question: 'Как добавить новую заявку?',
      answer: 'Перейдите в раздел "Добавить заявку" и заполните все обязательные поля формы. Обязательно укажите ФИО, суть заявки и контактные данные.'
    },
    {
      question: 'Как отследить статус моей заявки?',
      answer: 'В разделе "Дашборд" вы можете фильтровать заявки по статусу (в работе/выполнено) и отслеживать прогресс выполнения.'
    },
    {
      question: 'Что делать, если я забыл пароль?',
      answer: 'Обратитесь к системному администратору или отправьте запрос на почту povisok@nioch.nsc.ru для сброса пароля.'
    },
    {
      question: 'Как экспортировать данные в Excel?',
      answer: 'В разделе "Дашборд" нажмите кнопку "Экспорт в Excel" для выгрузки всех данных с текущими фильтрами.'
    }
  ];

  return (
    <div className="support-container">
      <div className="support-header">
        <button 
          onClick={() => navigate(-1)} 
          className="back-button"
        >
          ← Назад
        </button>
        <h1>📞 Техническая поддержка</h1>
        <p>Мы здесь, чтобы помочь вам с любыми вопросами по системе учёта заявок</p>
      </div>

      <div className="support-content">
        {/* Контактная информация */}
        <div className="contact-section">
          <h2>🛠️ Контакты поддержки</h2>
          <div className="contact-grid">
            {contactInfo.map((item, index) => (
              <div key={index} className="contact-card">
                <div className="contact-icon">{item.icon}</div>
                <h3>{item.title}</h3>
                <p className="contact-value">{item.value}</p>
                <p className="contact-description">{item.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Форма обратной связи */}
        <div className="form-section">
          <h2>✉️ Отправить запрос в поддержку</h2>
          <form onSubmit={handleSubmit} className="support-form">
            {message.text && (
              <div className={`message ${message.type}`}>
                {message.text}
              </div>
            )}

            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="name">Ваше имя *</label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Введите ваше полное имя"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email для ответа *</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="your@email.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="subject">Тема обращения *</label>
                <input
                  id="subject"
                  name="subject"
                  type="text"
                  placeholder="Кратко опишите тему вашего вопроса"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="priority">Приоритет</label>
                <select
                  id="priority"
                  name="priority"
                  value={formData.priority}
                  onChange={handleChange}
                  disabled={isSubmitting}
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                  <option value="urgent">Срочный</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="message">Подробное описание проблемы *</label>
              <textarea
                id="message"
                name="message"
                rows="6"
                placeholder="Опишите вашу проблему или вопрос максимально подробно. Укажите шаги для воспроизведения проблемы, если это возможно."
                value={formData.message}
                onChange={handleChange}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="form-actions">
              <button 
                type="submit" 
                className="submit-button"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="button-spinner"></div>
                    Отправка...
                  </>
                ) : (
                  'Отправить запрос'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* FAQ раздел */}
        <div className="faq-section">
          <h2>❓ Часто задаваемые вопросы</h2>
          <div className="faq-list">
            {faqItems.map((item, index) => (
              <div key={index} className="faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Дополнительная информация */}
        <div className="info-section">
          <h2>ℹ️ Дополнительная информация</h2>
          <div className="info-content">
            <p>
              <strong>Часы работы поддержки:</strong> Понедельник - Пятница, 9:00 - 18:00
            </p>
            <p>
              <strong>Экстренные случаи:</strong> Для критических проблем, влияющих на работу системы, 
              звоните по телефону поддержки (указывается в рабочее время).
            </p>
            <p>
              <strong>Документация:</strong> Полное руководство пользователя доступно на внутреннем портале института.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Support;