const getWelcomeDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

module.exports = { getWelcomeDay };
