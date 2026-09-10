import React from 'react';

export default function ChatEmployeeAdministration({ deleteEmployee, directoryEmployees, employeeForm, saveEmployee, setEmployeeForm, setShowEmployeePassword, showEmployeePassword, t }) {
  return (<section className="manager-panel">
            <h2>{t('employeeManagement')}</h2>
            <form className="manager-form manager-form-labeled" onSubmit={saveEmployee}>
              <label><span>{t('employeeLogin')}</span><input placeholder="ivanov@example.local" value={employeeForm.login} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, login: e.target.value }))} required /></label>
              <label>
                <span>{employeeForm.id ? t('newPasswordLabel') : t('password')}</span>
                <input type={showEmployeePassword ? 'text' : 'password'} placeholder={employeeForm.id ? t('passwordKeepPlaceholder') : t('loginPasswordPlaceholder')} value={employeeForm.password} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, password: e.target.value }))} />
                <small>{employeeForm.id ? t('passwordKeepHint') : t('passwordMinHint')}</small>
              </label>
              <label><span>Account role</span><select value={employeeForm.role} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, role: e.target.value }))}><option value="employee">Employee</option><option value="manager">Manager</option></select></label>
              <label><span>{t('fullName')}</span><input placeholder={t('profileNamePlaceholder')} value={employeeForm.full_name} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, full_name: e.target.value }))} /></label>
              <label><span>{t('department')}</span><input placeholder={t('employeeDepartmentPlaceholder')} value={employeeForm.department} onChange={(e) => setEmployeeForm((prev) => ({ ...prev, department: e.target.value }))} /></label>
              <label className="manager-password-toggle"><input type="checkbox" checked={showEmployeePassword} onChange={(e) => setShowEmployeePassword(e.target.checked)} />{t('showPassword')}</label>
              <div className="manager-form-actions">
                <button type="submit">{employeeForm.id ? t('saveActionButton') : t('add')}</button>
                {employeeForm.id && <button type="button" onClick={() => { setEmployeeForm({ id: null, login: '', password: '', role: 'employee', full_name: '', department: '', phone: '', room: '' }); setShowEmployeePassword(false); }}>{t('cancel')}</button>}
              </div>
            </form>
            <div className="manager-list">
              {directoryEmployees.map((employee) => (
                <div className="manager-list-item" key={employee.id}>
                  <div><strong>{employee.login}</strong><div>{employee.full_name || '—'}</div></div>
                  <div className="manager-list-actions">
                    <button type="button" onClick={() => { setEmployeeForm({ id: employee.id, login: employee.login || '', password: '', role: employee.role === 'manager' ? 'manager' : 'employee', full_name: employee.full_name || '', department: employee.department || '', phone: employee.phone || '', room: employee.room || '' }); setShowEmployeePassword(false); }}>{t('edit')}</button>
                    <button type="button" onClick={() => deleteEmployee(employee.id)}>{t('delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>);
}
