// context/ApplicationContext.js
import { createContext } from 'react';

// Создаем контекст с начальным значением
export const ApplicationsContext = createContext({
 // Начальные значения для всех свойств контекста
 applications: [],
 setApplications: () => {},
 loading: true,
 error: null,
 fetchApplications: () => {}
});

// Можно также добавить типы (если используете TypeScript):
/*
export interface ApplicationsContextType {
 applications: Application[];
 setApplications: (applications: Application[]) => void;
 loading: boolean;
 error: string | null;
 fetchApplications: () => Promise<void>;
}

export const ApplicationsContext = createContext<ApplicationsContextType>({
 applications: [],
 setApplications: () => {},
 loading: true,
 error: null,
 fetchApplications: () => Promise.resolve(),
});
*/
