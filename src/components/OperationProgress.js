import React from 'react';
import { useAdminTranslation } from '../utils/adminTranslation';
import './OperationProgress.css';

export default function OperationProgress({ steps, step = 0, failed = false, detail = '' }) {
  const t = useAdminTranslation();
  return <div className={`operation-progress${failed ? ' operation-progress--failed' : ''}`} role="status" aria-live="polite">
    <ol aria-label={t('Этапы операции')}>
      {steps.map((label, index) => <li key={label} className={index < step ? 'complete' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}>
        <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>{t(label)}
      </li>)}
    </ol>
    {failed && <p>{t('Операция не завершена. Проверьте сообщение об ошибке.')}</p>}
    {detail && <p>{t(detail)}</p>}
  </div>;
}
