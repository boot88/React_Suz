/**
 * Настройки отправки email.
 *
 * ВАЖНО:
 * - Текущая реализация использует Gmail SMTP.
 * - Пароль приложения храните в переменной SMTP_APP_PASSWORD.
 */
module.exports = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
  user: process.env.SMTP_USER || 'povisok888@gmail.com',
  pass: process.env.SMTP_APP_PASSWORD || '',
  from: process.env.MAIL_FROM || 'povisok888@gmail.com',
  replyTo: process.env.MAIL_REPLY_TO || 'povisok888@gmail.com'
};
