import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import React, { useState, useEffect, useRef } from 'react';
import './KnowledgeBase.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

const KnowledgeBase = () => {
  const t = useAdminTranslation();
  const [notice, setNotice] = useState(null);
  const notify = (text, type = 'error') => setNotice({ text, type });
  const [articles, setArticles] = useState([]);
  const [newArticle, setNewArticle] = useState({ 
    title: '', 
    solution: '', 
    category: 'Общее',
    images: []
  });
  const [editingArticle, setEditingArticle] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedImage, setExpandedImage] = useState(null);
  const [expandedArticles, setExpandedArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [savingArticle, setSavingArticle] = useState(false);
  const articleSaveLock = useRef(false);

  // Загрузка статей из базы данных
  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authFetch(`${API_BASE_URL}/knowledge-base`);
      
      if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Загруженные статьи:', data);
      setArticles(data.articles || data || []);
      setLoading(false);
    } catch (err) {
      console.error('Ошибка загрузки статей:', err);
      setError('Не удалось загрузить статьи. Проверьте подключение к серверу.');
      setLoading(false);
    }
  };

  // Безопасный парсинг JSON для изображений
  const safeParseImages = (imagesString) => {
    if (!imagesString) return [];
    
    try {
      // Если imagesString уже массив, возвращаем его
      if (Array.isArray(imagesString)) {
        return imagesString;
      }
      
      // Если это строка, пытаемся распарсить
      if (typeof imagesString === 'string') {
        // Проверяем, не пустая ли строка
        if (imagesString.trim() === '') {
          return [];
        }
        
        const parsed = JSON.parse(imagesString);
        return Array.isArray(parsed) ? parsed : [];
      }
      
      return [];
    } catch (error) {
      console.error('Ошибка парсинга изображений:', error, 'Строка:', imagesString);
      return [];
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (editingArticle) {
      setEditingArticle(prev => ({ ...prev, [name]: value }));
    } else {
      setNewArticle(prev => ({ ...prev, [name]: value }));
    }
  };

  // Функция для конвертации файла в base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    
    if (files.length === 0) return;

    try {
      setUploadingImages(true);
      const uploadedImages = [];

      for (const file of files) {
        // Проверка типа файла
        if (!file.type.startsWith('image/')) {
          notify(`Файл "${file.name}" не является изображением`, 'warning');
          continue;
        }

        // Проверка размера (максимум 2MB)
        if (file.size > 2 * 1024 * 1024) {
          notify(`Файл "${file.name}" слишком большой. Максимальный размер: 2MB`, 'warning');
          continue;
        }

        try {
          // Конвертируем файл в base64
          const base64String = await fileToBase64(file);
          
          uploadedImages.push({
            name: file.name,
            type: file.type,
            size: file.size,
            data: base64String,
            uploadedAt: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Ошибка конвертации файла ${file.name}:`, error);
          notify(`Ошибка при обработке файла "${file.name}"`, 'error');
        }
      }

      if (uploadedImages.length > 0) {
        if (editingArticle) {
          setEditingArticle(prev => ({
            ...prev,
            images: [...(prev.images || []), ...uploadedImages]
          }));
        } else {
          setNewArticle(prev => ({
            ...prev,
            images: [...(prev.images || []), ...uploadedImages]
          }));
        }
      }

    } catch (err) {
      console.error('Ошибка загрузки изображений:', err);
      notify('Ошибка при загрузке изображений', 'error');
    } finally {
      setUploadingImages(false);
      e.target.value = '';
    }
  };

  const removeImage = (imageIndex, isEditing = false) => {
    if (isEditing) {
      setEditingArticle(prev => ({
        ...prev,
        images: (prev.images || []).filter((_, index) => index !== imageIndex)
      }));
    } else {
      setNewArticle(prev => ({
        ...prev,
        images: (prev.images || []).filter((_, index) => index !== imageIndex)
      }));
    }
  };

  // Функция для подготовки данных изображений перед отправкой
  const prepareImagesForSend = (images) => {
    if (!images || !Array.isArray(images) || images.length === 0) {
      return [];
    }

    return images.map(img => ({
      name: img.name || `image_${Date.now()}`,
      type: img.type || 'image/jpeg',
      size: img.size || 0,
      data: img.data,
      uploadedAt: img.uploadedAt || new Date().toISOString()
    }));
  };

  const addArticle = async () => {
    if (articleSaveLock.current || uploadingImages) return;
    if (!newArticle.title.trim() || !newArticle.solution.trim()) {
      notify('Заголовок и решение обязательны для заполнения', 'warning');
      return;
    }

    articleSaveLock.current = true;
    setSavingArticle(true);
    try {
      const articleData = {
        title: newArticle.title,
        solution: newArticle.solution,
        category: newArticle.category || 'Общее',
        images: prepareImagesForSend(newArticle.images)
      };

      console.log('Отправляемые данные:', articleData);

      const response = await authFetch(`${API_BASE_URL}/knowledge-base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(articleData)
      });

      if (response.ok) {
        await fetchArticles();
        setNewArticle({ title: '', solution: '', category: 'Общее', images: [] });
        notify('Статья успешно добавлена!', 'success');
      } else {
        const errorData = await response.json();
        throw new Error(`Ошибка при добавлении статьи: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка добавления статьи:', err);
      notify('Произошла ошибка при добавлении статьи: ' + err.message, 'error');
    } finally {
      articleSaveLock.current = false;
      setSavingArticle(false);
    }
  };

  const updateArticle = async () => {
    if (articleSaveLock.current || uploadingImages) return;
    if (!editingArticle.title.trim() || !editingArticle.solution.trim()) {
      notify('Заголовок и решение обязательны для заполнения', 'warning');
      return;
    }

    articleSaveLock.current = true;
    setSavingArticle(true);
    try {
      const articleData = {
        title: editingArticle.title,
        solution: editingArticle.solution,
        category: editingArticle.category || 'Общее',
        images: prepareImagesForSend(editingArticle.images)
      };

      console.log('Отправляемые данные для обновления:', articleData);

      const response = await authFetch(`${API_BASE_URL}/knowledge-base/${editingArticle.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(articleData)
      });

      if (response.ok) {
        await fetchArticles();
        setEditingArticle(null);
        notify('Статья успешно обновлена!', 'success');
      } else {
        const errorData = await response.json();
        throw new Error(`Ошибка при обновлении статьи: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка обновления статьи:', err);
      notify('Произошла ошибка при обновлении статьи: ' + err.message, 'error');
    } finally {
      articleSaveLock.current = false;
      setSavingArticle(false);
    }
  };

  const deleteArticle = async (id) => {
    if (!window.confirm(t('Вы уверены, что хотите удалить эту статью?'))) {
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/knowledge-base/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchArticles();
        notify('Статья успешно удалена!', 'success');
      } else {
        throw new Error('Ошибка при удалении статьи');
      }
    } catch (err) {
      console.error('Ошибка удаления статьи:', err);
      notify('Произошла ошибка при удалении статьи', 'error');
    }
  };

  const startEditing = (article) => {
    // Используем безопасный парсинг для изображений
    const images = safeParseImages(article.images);
    setEditingArticle({ 
      ...article, 
      images: images 
    });
  };

  const cancelEditing = () => {
    setEditingArticle(null);
  };

  const filteredArticles = articles.filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         article.solution.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Получаем уникальные категории из статей
  const categories = ['all', ...new Set(articles.map(article => article.category).filter(Boolean))];

  const formatDate = (dateString) => {
    if (!dateString) return 'Не указано';
    return new Date(dateString).toLocaleDateString(getAdminLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loading) {
    return (
      <div className="knowledge-base">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>{t("Загрузка базы знаний...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-base">
      <div className="kb-header">
        <h1>{t("База знаний")}</h1>
        <div className="search-filter">
          <input
            type="text"
            placeholder={t("Поиск статей...")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="category-filter"
          >
            <option value="all">{t("Все категории")}</option>
            {categories.filter(cat => cat && cat !== 'all').map(category => (
              <option key={category} value={category}>
                {t(category)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <AdminNotice type="error">
          <span>{t(error)}</span>
          <button onClick={fetchArticles} className="retry-button">{t("Повторить попытку")}</button>
        </AdminNotice>
      )}

      {notice && <AdminNotice type={notice.type} onDismiss={() => setNotice(null)} dismissLabel={t("Закрыть уведомление")}>{t(notice.text)}</AdminNotice>}

      <div className="kb-content">
        <div className="articles-section">
          <h2>{t("Статьи (")}{filteredArticles.length})</h2>
          {filteredArticles.length === 0 ? (
            <div className="no-articles">
              <p>{t("Статьи не найдены")}</p>
              <button onClick={fetchArticles} className="retry-button">{t("Обновить")}</button>
            </div>
          ) : (
            <div className="articles-grid">
              {filteredArticles.map(article => {
                // Используем безопасный парсинг для изображений
                const articleImages = safeParseImages(article.images);
                
                return (
                  <div key={article.id} className="article-card">
                    <div className="article-header">
                      <h3>{article.title}</h3>
                      <div className="article-actions">
                        <button 
                          onClick={() => startEditing(article)}
                          className="edit-btn"
                        >{t("Редактировать")}</button>
                        <button 
                          onClick={() => deleteArticle(article.id)}
                          className="delete-btn"
                        >{t("Удалить")}</button>
                      </div>
                    </div>
                    <p className="article-category">{t("Категория: ")}{t(article.category || 'Общее')}</p>
                    <p className="article-excerpt">{String(article.solution || '').replace(/\s+/g, ' ').slice(0, 180)}{String(article.solution || '').length > 180 ? '…' : ''}</p>
                    <button type="button" className="article-expand" aria-expanded={expandedArticles.includes(article.id)} aria-controls={`article-body-${article.id}`}
                      onClick={() => setExpandedArticles((ids) => ids.includes(article.id) ? ids.filter((id) => id !== article.id) : [...ids, article.id])}>
                      {t(expandedArticles.includes(article.id) ? 'Свернуть статью' : 'Читать решение')}{articleImages.length > 0 && <span> · {t('Фотографии: ')}{articleImages.length}</span>}
                    </button>
                    {expandedArticles.includes(article.id) && <div id={`article-body-${article.id}`}>
                    <div className="article-content">
                      <h4>{t("Решение:")}</h4>
                      <pre>{article.solution}</pre>
                    </div>
                    
                    {articleImages.length > 0 && (
                      <div className="article-images">
                        <h4>{t("Изображения (")}{articleImages.length})</h4>
                        <div className="images-grid">
                          {articleImages.map((image, index) => (
                            <div key={index} className="image-item">
                              <img 
                                src={image.data || image.url} 
                                alt={image.name || t(`Изображение ${index + 1}`)}
                                onClick={() => setExpandedImage(image)}
                                className="article-image"
                                onError={(e) => {
                                  console.error('Ошибка загрузки изображения:', image);
                                  e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik03NSA0MFY4ME00MCA1NUgxMTAiIHN0cm9rZT0iIzlDQTZBNiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+';
                                }}
                              />
                              <span className="image-name">
                                {image.name || t(`Изображение ${index + 1}`)}
                                {t(image.size && ` (${formatFileSize(image.size)})`)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    </div>}
                    <p className="article-date">{t("Обновлено: ")}{t(formatDate(article.updated_at))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="edit-section">
          {editingArticle ? (
            <div className="edit-form">
              <h2>{t("Редактирование статьи #")}{editingArticle.id}</h2>
              <input
                type="text"
                name="title"
                placeholder={t("Заголовок статьи")}
                value={editingArticle.title}
                onChange={handleInputChange}
                className="form-input"
              />
              <select
                name="category"
                value={editingArticle.category || 'Общее'}
                onChange={handleInputChange}
                className="form-input"
              >
                <option value="Установка ПО">{t("Установка ПО")}</option>
                <option value="Сеть">{t("Сеть")}</option>
                <option value="Оборудование">{t("Оборудование")}</option>
                <option value="Принтеры">{t("Принтеры")}</option>
                <option value="Активация">{t("Активация")}</option>
                <option value="Общее">{t("Общее")}</option>
              </select>
              <textarea
                name="solution"
                placeholder={t("Решение проблемы")}
                value={editingArticle.solution}
                onChange={handleInputChange}
                className="form-textarea"
                rows="6"
              />
              
              <div className="image-upload-section">
                <h4>{t("Изображения")}</h4>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  multiple
                  className="file-input"
                  disabled={uploadingImages || savingArticle}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="upload-btn"
                  disabled={uploadingImages || savingArticle}
                >
                  {t(uploadingImages ? 'Загрузка...' : 'Добавить изображения')}
                </button>
                <p className="file-restrictions">{t("Максимальный размер: 2MB. Разрешены: JPEG, PNG, GIF, WebP")}</p>
                
                {editingArticle.images && editingArticle.images.length > 0 && (
                  <div className="uploaded-images">
                    <h5>{t("Загруженные изображения (")}{editingArticle.images.length}):</h5>
                    <div className="images-preview">
                      {editingArticle.images.map((image, index) => (
                        <div key={index} className="image-preview-item">
                          <img 
                            src={image.data || image.url} 
                            alt={image.name || t(`Превью ${index + 1}`)}
                            className="preview-image"
                          />
                          <div className="image-info">
                            <span>{image.name || t(`Изображение ${index + 1}`)}</span>
                            <span>{t(formatFileSize(image.size))}</span>
                            <span>{t(new Date(image.uploadedAt).toLocaleDateString(getAdminLocale()))}</span>
                          </div>
                          <button 
                            onClick={() => removeImage(index, true)}
                            className="remove-image-btn"
                            title={t("Удалить изображение")}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="form-actions">
                <button onClick={cancelEditing} className="cancel-btn">{t("Отмена")}</button>
                <button onClick={updateArticle} disabled={savingArticle || uploadingImages} className="save-btn">{t(savingArticle ? "Сохранение..." : "Сохранить изменения")}</button>
              </div>
            </div>
          ) : (
            <div className="add-form">
              <h2>{t("Добавить новую статью")}</h2>
              <input
                type="text"
                name="title"
                placeholder={t("Заголовок статьи")}
                value={newArticle.title}
                onChange={handleInputChange}
                className="form-input"
              />
              <select
                name="category"
                value={newArticle.category}
                onChange={handleInputChange}
                className="form-input"
              >
                <option value="Установка ПО">{t("Установка ПО")}</option>
                <option value="Сеть">{t("Сеть")}</option>
                <option value="Оборудование">{t("Оборудование")}</option>
                <option value="Принтеры">{t("Принтеры")}</option>
                <option value="Активация">{t("Активация")}</option>
                <option value="Общее">{t("Общее")}</option>
              </select>
              <textarea
                name="solution"
                placeholder={t("Решение проблемы")}
                value={newArticle.solution}
                onChange={handleInputChange}
                className="form-textarea"
                rows="6"
              />
              
              <div className="image-upload-section">
                <h4>{t("Изображения (опционально)")}</h4>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  multiple
                  className="file-input"
                  disabled={uploadingImages || savingArticle}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="upload-btn"
                  disabled={uploadingImages || savingArticle}
                >
                  {t(uploadingImages ? 'Загрузка...' : 'Добавить изображения')}
                </button>
                <p className="file-restrictions">{t("Максимальный размер: 2MB. Разрешены: JPEG, PNG, GIF, WebP")}</p>
                
                {newArticle.images && newArticle.images.length > 0 && (
                  <div className="uploaded-images">
                    <h5>{t("Загруженные изображения (")}{newArticle.images.length}):</h5>
                    <div className="images-preview">
                      {newArticle.images.map((image, index) => (
                        <div key={index} className="image-preview-item">
                          <img 
                            src={image.data || image.url} 
                            alt={image.name || t(`Превью ${index + 1}`)}
                            className="preview-image"
                          />
                          <div className="image-info">
                            <span>{image.name || t(`Изображение ${index + 1}`)}</span>
                            <span>{t(formatFileSize(image.size))}</span>
                            <span>{t(new Date(image.uploadedAt).toLocaleDateString(getAdminLocale()))}</span>
                          </div>
                          <button 
                            onClick={() => removeImage(index)}
                            className="remove-image-btn"
                            title={t("Удалить изображение")}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              <button 
                onClick={addArticle} 
                className="add-btn"
                disabled={!newArticle.title.trim() || !newArticle.solution.trim() || uploadingImages || savingArticle}
              >
                {t(savingArticle ? 'Сохранение...' : uploadingImages ? 'Загрузка...' : 'Добавить статью')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Модальное окно для просмотра изображения */}
      {expandedImage && (
        <div className="image-modal" onClick={() => setExpandedImage(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="close-modal"
              onClick={() => setExpandedImage(null)}
            >
              ×
            </button>
            <img 
              src={expandedImage.data || expandedImage.url} 
              alt={expandedImage.name || t('Увеличенное изображение')}
              className="expanded-image"
            />
            <div className="image-details">
              <p><strong>{t("Имя файла:")}</strong> {expandedImage.name || t('Не указано')}</p>
              <p><strong>{t("Размер:")}</strong> {t(formatFileSize(expandedImage.size))}</p>
              <p><strong>{t("Тип:")}</strong> {t(expandedImage.type || 'Не указан')}</p>
              {expandedImage.uploadedAt && (
                <p><strong>{t("Загружено:")}</strong> {t(new Date(expandedImage.uploadedAt).toLocaleString(getAdminLocale()))}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
