import React from 'react';

export default function EmployeeRequestsWorkspace({ REQUEST_CATEGORIES, REQUEST_PRIORITIES, RequestTimerMetrics, activeApplications, applicationsError, applicationsLoading, completedApplications, confirmApplicationDone, fetchMyApplications, formatApplicationDateTime, getApplicationStatusMeta, getApplicationTiming, getRequestCategoryLabel, getRequestPriorityLabel, interfaceLocale, isEnglishInterface, localizeRuntimeText, reopenApplication, requestCategory, requestPriority, requestStatus, requestText, setRequestCategory, setRequestPriority, setRequestText, submitRequest, t }) {
  return (<div className="request-workspace">
            <header className="section-hero">
              <span className="eyebrow">{t('requestEyebrow')}</span>
              <h2>{t('requestTitle')}</h2>
              <p>{t('requestHint')}</p>
            </header>
            {requestStatus.state !== 'idle' && (
              <div className={`request-status-card ${requestStatus.state}`}>
                <strong>{requestStatus.textKey ? t(requestStatus.textKey) : localizeRuntimeText(requestStatus.text)}</strong>
                {requestStatus.ticketId && <span>{t('ticketNumber')}: #{requestStatus.ticketId}</span>}
              </div>
            )}
            <details className="request-support-card"><summary>{t('techSupportContacts')}</summary>
              <div>
                <span className="eyebrow">{t('techSupport')}</span>
                <h3>{t('techSupportDepartment')}</h3>
                <p>{t('techSupportText')}</p>
              </div>
              <div className="request-support-contact">
                <strong>Повисок Евгений Вячеславович</strong>
                <span>{t('leadSpecialist')}</span>
                <a href="tel:1380">{t('internalPhone')}: 1-380</a>
                <a href="mailto:povisok@nioch.nsc.ru">povisok@nioch.nsc.ru</a>
                <a href="tel:+79130080146">{t('mobile')}: 8-913-008-01-46</a>
              </div>
            </details>
            <form className="employee-request-box" onSubmit={submitRequest}>
              <div className="form-grid two">
                <label>{t('category')}<select value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)}>{REQUEST_CATEGORIES.map((item) => <option key={item}>{getRequestCategoryLabel(item)}</option>)}</select></label>
                <label>{t('priority')}<select value={requestPriority} onChange={(e) => setRequestPriority(e.target.value)}>{REQUEST_PRIORITIES.map((item) => <option key={item}>{getRequestPriorityLabel(item)}</option>)}</select></label>
              </div>
              <textarea rows={7} maxLength={500} placeholder={t('requestPlaceholder')} value={requestText} onChange={(e) => setRequestText(e.target.value)} />
              <div className="request-form-actions"><button type="submit" disabled={requestStatus.state === 'sending'}>{requestStatus.state === 'sending' ? t('sendingRequest') : t('sendRequest')}</button><button type="button" onClick={() => fetchMyApplications({ silent: false })}>{applicationsLoading ? t('refreshing') : t('refreshStatuses')}</button></div>
              {applicationsError && <div className="request-inline-error">{t('requestsUnavailable')}: {localizeRuntimeText(applicationsError)}</div>}
            </form>

            <section className="employee-ticket-board">
              <div className="ticket-board-head"><h3>{t('activeRequests')}</h3>{activeApplications.length > 0 && <span>{activeApplications.length}</span>}</div>
              {activeApplications.length === 0 && <div className="empty-mini">{t('noActiveRequests')}</div>}
              {activeApplications.map((ticket) => {
                const meta = getApplicationStatusMeta(ticket.status, isEnglishInterface);
                return (
                  <article key={ticket.id} className={`employee-ticket-card ${meta.tone}`}>
                    <header><div><strong>#{ticket.id} · {meta.label}</strong><span>{getRequestCategoryLabel(ticket.category || 'Другое')} · {getRequestPriorityLabel(ticket.priority || 'Обычный')}</span></div><em>{meta.hint}</em></header>
                    <p>{ticket.application}</p>
                    <RequestTimerMetrics ticket={ticket} t={t} />
                    {(ticket.executor || ticket.accepted_by || ticket.admin_comment || ticket.eta_minutes) && <div className="ticket-admin-note"><strong>{ticket.executor || ticket.accepted_by || t('administrator')}</strong><span>{ticket.admin_comment || (ticket.eta_minutes ? t('administratorEta').replace('{minutes}', ticket.eta_minutes) : t('administratorAccepted'))}</span></div>}
                    {Array.isArray(ticket.timeline) && <ol className="ticket-timeline" aria-label={isEnglishInterface ? 'Request progress' : 'Ход заявки'}>{ticket.timeline.filter((step) => step.completed && (step.key === 'created' || step.key === 'done' || step.key.startsWith('accepted'))).map((step) => <li key={step.key} className="completed"><span>{isEnglishInterface && step.key.startsWith('accepted') ? (step.key === 'accepted_1' || step.key === 'accepted' ? 'Taken into work' : 'Taken into work again') : step.label}</span><time>{formatApplicationDateTime(step.at, interfaceLocale)}</time></li>)}</ol>}
                    {ticket.process && <div className="ticket-admin-note"><strong>{t('workCompleted')}</strong><span>{ticket.process}</span></div>}
                    {['in_progress', 'waiting_employee_confirmation'].includes(ticket.status) && <div className="ticket-actions"><button type="button" onClick={() => confirmApplicationDone(ticket.id)}>✅ {t('requestDone')}</button><button type="button" onClick={() => reopenApplication(ticket.id)}>{t('issueRemains')}</button></div>}
                  </article>
                );
              })}
              {completedApplications.length > 0 && <details className="ticket-history"><summary>{t('completedHistory')} ({completedApplications.length})</summary>{completedApplications.slice(0, 10).map((ticket) => { const timing = getApplicationTiming(ticket); return <div key={ticket.id} className="ticket-history-row"><span>#{ticket.id}</span><span>{ticket.application}</span><span>{isEnglishInterface ? 'Submitted' : 'Подана'}: {formatApplicationDateTime(ticket.created_at || ticket.data, interfaceLocale)}</span>{timing.takenAt && <span>{isEnglishInterface ? 'Accepted' : 'Взята'}: {formatApplicationDateTime(timing.takenAt, interfaceLocale)}</span>}<span>{isEnglishInterface ? 'Completed' : 'Закрыта'}: {formatApplicationDateTime(ticket.employee_confirmed_at || ticket.resolved_at || ticket.end_data, interfaceLocale)}</span><span>{isEnglishInterface ? 'Specialist' : 'Исполнитель'}: {ticket.executor || ticket.accepted_by || '—'}</span></div>; })}</details>}
            </section>
          </div>);
}
