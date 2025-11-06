// context/ApplicationContext.js
import { createContext } from 'react';

// Создаем контекст с начальными значениями
export const ApplicationsContext = createContext({
 // Начальные значения для всех свойств контекста
 applications: [],
 setApplications: () => {},
 loading: true,
 error: null,
 fetchApplications: () => {},
});

// TypeScript интерфейс (опционально)
export interface ApplicationsContextType {
 applications: Application[];
 setApplications: (applications: Application[]) => void;
 loading: boolean;
 error: string | null;
 fetchApplications: () => Promise<void>;
}

// Если используете TypeScript, можно определить тип Application
// export interface Application {
//   id: number;
//   title: string;
//   description: string;
//   status: string;
//   // другие поля вашей модели
// }

// Пример использования контекста в компоненте
// const { applications, loading, error } = useContext(ApplicationsContext);

export default ApplicationsContext;
