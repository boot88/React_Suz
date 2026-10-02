import React from 'react';
import './AdminNotice.css';

export default function AdminNotice({ type = 'info', children, onDismiss, dismissLabel = 'Dismiss notification', className = '' }) {
  const tone = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  return <div className={`admin-notice admin-notice--${tone} ${className}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
    <span className="admin-notice-icon" aria-hidden="true">{{ success: '✓', error: '!', warning: '!', info: 'i' }[tone]}</span>
    <div className="admin-notice-content">{children}</div>
    {onDismiss && <button type="button" className="admin-notice-dismiss" onClick={onDismiss} aria-label={dismissLabel}>×</button>}
  </div>;
}
