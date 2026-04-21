/**
 * Настройки отправки email.
 *
 * ВАЖНО:
 * - Текущая реализация использует локальный sendmail (без SMTP-логина/пароля в коде).
 * - Отправка "с вашей почты" настраивается через поле `from`.
 * - Если нужен SMTP с логином/паролем, это настраивается на уровне MTA/relay сервера.
 */
module.exports = {
  from: process.env.MAIL_FROM || 'povisok@nioch.nsc.ru',
  replyTo: process.env.MAIL_REPLY_TO || 'povisok@nioch.nsc.ru',
  sendmailBin: process.env.SENDMAIL_BIN || 'sendmail'
};

