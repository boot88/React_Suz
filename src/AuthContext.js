// src/AuthContext.js
import React, { createContext, useState, useContext } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
 const [isAuthenticated, setIsAuthenticated] = useState(() => {
 // Проверяем, был ли вход ранее (можно хранить в localStorage)
 const saved = localStorage.getItem('isAuthenticated');
 return saved === 'true';
 });

 const login = () => {
 setIsAuthenticated(true);
 localStorage.setItem('isAuthenticated', 'true');
 };

 const logout = () => {
 setIsAuthenticated(false);
 localStorage.setItem('isAuthenticated', 'false');
 // Можно также очистить другие данные
 };

 return (
 <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
 {children}
 </AuthContext.Provider>
 );
};

// Хук для удобного доступа
export const useAuth = () => useContext(AuthContext);
