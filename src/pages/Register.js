import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import './Register.css';

const Register = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    room: '',
    department: '',
    internalPhone: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [departments, setDepartments] = useState([]);
  const [nameHints, setNameHints] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { registerEmployee } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/employees/departments`);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) setDepartments(data);
      } catch {
        // ignore optional helper data
      }
    };

    loadDepartments();
  }, []);

  useEffect(() => {
    const query = formData.fullName.trim();
    if (query.length < 2) {
      setNameHints([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/employees/search?field=full_name&query=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) {
          setNameHints(data.slice(0, 6));
        }
      } catch {
        setNameHints([]);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [formData.fullName]);

  const hasHints = useMemo(() => nameHints.length > 0, [nameHints]);
  const passwordScore = useMemo(() => {
    const password = formData.password;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-ZА-Я]/.test(password) && /[a-zа-я]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-zА-Яа-я0-9]/.test(password)) score += 1;
    return score;
  }, [formData.password]);
  const passwordStrengthLabel = ['Weak', 'Weak', 'Normal', 'Good', 'Strong'][passwordScore];
  const hasPasswordPair = formData.password.length > 0 && formData.confirmPassword.length > 0;
  const passwordsMatch = hasPasswordPair && formData.password === formData.confirmPassword;

  const applyHint = (hint) => {
    setFormData((prev) => ({
      ...prev,
      fullName: hint.full_name || prev.fullName,
      room: hint.room || prev.room,
      department: hint.department || prev.department,
      internalPhone: hint.internal_phone || prev.internalPhone,
      email: hint.email || prev.email
    }));
    setNameHints([]);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));

    if (error) setError('');
    if (successMessage) setSuccessMessage('');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (formData.password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      await registerEmployee(formData.email, {
        fullName: formData.fullName,
        room: formData.room,
        department: formData.department,
        internalPhone: formData.internalPhone,
        password: formData.password
      });
      setSuccessMessage('Employee registered. You can now sign in with the specified login and password.');
      setTimeout(() => navigate('/login'), 1000);
    } catch (err) {
      setError(err.message || 'Registration error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="register-container">
      <div className="register-shell">
        <header className="register-header-bar">
          <p>Новосибирск · 2026</p>
        </header>

        <main className="register-content">
          <div className="register-card">
            <div className="register-header">
              <h2>Employee registration</h2>
              <p className="register-subtitle">Fill in employee data to create an account</p>
            </div>

            <form onSubmit={handleRegister} className="register-form">
          <label>
            Full name *
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              required
              disabled={isLoading}
              placeholder="Иванов Иван Иванович"
            />
          </label>

          {hasHints && (
            <div className="name-hints">
              {nameHints.map((hint) => (
                <button key={`${hint.full_name}-${hint.email || hint.room}`} type="button" onClick={() => applyHint(hint)}>
                  {hint.full_name} · {hint.department || 'no department'} · {hint.room || '—'}
                </button>
              ))}
            </div>
          )}

          <div className="grid-two">
            <label>
              Department
              <select
                name="department"
                value={formData.department}
                onChange={handleChange}
                disabled={isLoading}
              >
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>

            <label>
              Room
              <input
                type="text"
                name="room"
                value={formData.room}
                onChange={handleChange}
                disabled={isLoading}
              />
            </label>
          </div>

          <div className="grid-two">
            <label>
              Internal phone
              <input
                type="text"
                name="internalPhone"
                value={formData.internalPhone}
                onChange={handleChange}
                disabled={isLoading}
              />
            </label>

            <label>
              Email (login) *
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </label>
          </div>

          <div className="grid-two password-grid">
            <label>
              Password *
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
                autoComplete="new-password"
                minLength={8}
                placeholder="Minimum 8 characters"
              />
            </label>

            <label>
              Confirm password *
              <input
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
                autoComplete="new-password"
                minLength={8}
                placeholder="Enter password again"
              />
            </label>
          </div>

          <div className="password-actions">
            <label className="password-show-toggle">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                disabled={isLoading}
              />
              Show password
            </label>
            {hasPasswordPair && (
              <span className={`password-match ${passwordsMatch ? 'match' : 'mismatch'}`}>
                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
              </span>
            )}
          </div>

          <div className="password-helper">
            <div className="password-meter" aria-hidden="true">
              {[1, 2, 3, 4].map((item) => (
                <span key={item} className={item <= passwordScore ? 'active' : ''} />
              ))}
            </div>
            <span>{formData.password ? `Strength: ${passwordStrengthLabel}` : 'Create a password and repeat it in the second field.'}</span>
          </div>

          <p className="register-note">
            The password is set during registration. If an employee forgets it later, recovery via “Forgot password?” on the login page will still work.
          </p>

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Registering...' : 'Register employee'}
          </button>
        </form>

            {error && <div className="register-error">{error}</div>}
            {successMessage && <div className="register-success">{successMessage}</div>}

            <div className="register-footer">
              <p>Already have an account? <Link to="/login">Sign in</Link></p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Register;
