import React, { useState, useEffect, useRef, useMemo } from 'react';
import './KnowledgeBase.css';
import { API_BASE_URL } from '../utils/apiConfig';

const NETWORK_SOURCE_URL = 'http://nioch.nioch.nsc.ru/nioch/nioch.txt';
const IP_LAST_OCTET_MIN = 1;
const IP_LAST_OCTET_MAX = 254;

const ipToNumber = (ip) => ip.split('.').reduce((sum, part) => (sum * 256) + Number(part), 0);
const getNetworkKey = (ip) => ip.split('.').slice(0, 3).join('.');
const getNetworkCidr = (networkKey) => `${networkKey}.0/24`;

const getFreeIpRanges = (freeIps) => {
  if (freeIps.length === 0) return [];
  const ranges = [];
  let start = freeIps[0];
  let previous = freeIps[0];

  for (let index = 1; index < freeIps.length; index += 1) {
    const current = freeIps[index];
    if (ipToNumber(current) === ipToNumber(previous) + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? start : `${start} — ${previous}`);
    start = current;
    previous = current;
  }

  ranges.push(start === previous ? start : `${start} — ${previous}`);
  return ranges;
};

const parseNetworkZone = (zoneText = '') => {
  const records = [];
  let currentSection = 'Без раздела';

  zoneText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith(';')) {
      const label = trimmed.replace(/^;+/, '').replace(/;+$/g, '').trim();
      if (label) currentSection = label;
      return;
    }

    const cleanLine = line.split(';')[0].trim();
    const match = cleanLine.match(/^(\S+)\s+IN\s+A\s+((?:\d{1,3}\.){3}\d{1,3})\b/i);
    if (!match) return;

    const [, host, ip] = match;
    const octets = ip.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return;

    records.push({
      host,
      ip,
      networkKey: getNetworkKey(ip),
      section: currentSection
    });
  });

  const byNetwork = records.reduce((acc, record) => {
    if (!acc[record.networkKey]) acc[record.networkKey] = [];
    acc[record.networkKey].push(record);
    return acc;
  }, {});

  return Object.entries(byNetwork).map(([networkKey, networkRecords]) => {
    const occupiedLastOctets = new Set(networkRecords.map((record) => Number(record.ip.split('.')[3])));
    const freeIps = [];
    for (let last = IP_LAST_OCTET_MIN; last <= IP_LAST_OCTET_MAX; last += 1) {
      if (!occupiedLastOctets.has(last)) freeIps.push(`${networkKey}.${last}`);
    }

    return {
      networkKey,
      cidr: getNetworkCidr(networkKey),
      section: networkRecords[0]?.section || 'Без раздела',
      occupied: networkRecords.sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)),
      freeIps,
      freeRanges: getFreeIpRanges(freeIps)
    };
  }).sort((a, b) => ipToNumber(`${a.networkKey}.0`) - ipToNumber(`${b.networkKey}.0`));
};

const KnowledgeBase = () => {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [networkZoneText, setNetworkZoneText] = useState('');
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [networkUpdatedAt, setNetworkUpdatedAt] = useState('');
  const [networkSearch, setNetworkSearch] = useState('');
  const [networkFilter, setNetworkFilter] = useState('all');

  // Загрузка статей из базы данных
  useEffect(() => {
    fetchArticles();
    fetchNetworkMap({ silent: true });
  }, []);

  const fetchArticles = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/knowledge-base`);
      
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

  const fetchNetworkMap = async ({ silent = false } = {}) => {
    if (!silent) setNetworkLoading(true);
    setNetworkError('');

    try {
      const response = await fetch(`${API_BASE_URL}/network-map`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось загрузить сетку');

      setNetworkZoneText(data.zoneText || '');
      setNetworkUpdatedAt(data.fetchedAt || new Date().toISOString());
    } catch (err) {
      console.error('Ошибка загрузки сетки:', err);
      setNetworkError(err.message || 'Не удалось загрузить сетку');
    } finally {
      if (!silent) setNetworkLoading(false);
    }
  };

  const networkGroups = useMemo(() => parseNetworkZone(networkZoneText), [networkZoneText]);

  const networkStats = useMemo(() => networkGroups.reduce((acc, network) => ({
    networks: acc.networks + 1,
    occupied: acc.occupied + network.occupied.length,
    free: acc.free + network.freeIps.length
  }), { networks: 0, occupied: 0, free: 0 }), [networkGroups]);

  const filteredNetworkGroups = useMemo(() => {
    const query = networkSearch.trim().toLowerCase();

    return networkGroups.map((network) => {
      const occupiedRows = network.occupied
        .filter((record) => networkFilter !== 'free')
        .filter((record) => {
          if (!query) return true;
          return `${record.host} ${record.ip} ${network.cidr} ${record.section}`.toLowerCase().includes(query);
        })
        .map((record) => ({ ...record, status: 'occupied' }));

      const freeRows = network.freeIps
        .filter(() => networkFilter !== 'occupied')
        .filter((ip) => !query || `${ip} свободен ${network.cidr} ${network.section}`.toLowerCase().includes(query))
        .map((ip) => ({ ip, host: '—', section: network.section, status: 'free' }));

      return { ...network, rows: [...occupiedRows, ...freeRows].sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip)) };
    }).filter((network) => network.rows.length > 0 || (!query && networkFilter === 'all'));
  }, [networkFilter, networkGroups, networkSearch]);

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
          alert(`Файл "${file.name}" не является изображением`);
          continue;
        }

        // Проверка размера (максимум 2MB)
        if (file.size > 2 * 1024 * 1024) {
          alert(`Файл "${file.name}" слишком большой. Максимальный размер: 2MB`);
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
          alert(`Ошибка при обработке файла "${file.name}"`);
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
      alert('Ошибка при загрузке изображений');
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
    if (!newArticle.title.trim() || !newArticle.solution.trim()) {
      alert('Заголовок и решение обязательны для заполнения');
      return;
    }

    try {
      const articleData = {
        title: newArticle.title,
        solution: newArticle.solution,
        category: newArticle.category || 'Общее',
        images: prepareImagesForSend(newArticle.images)
      };

      console.log('Отправляемые данные:', articleData);

      const response = await fetch(`${API_BASE_URL}/knowledge-base`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(articleData)
      });

      if (response.ok) {
        await fetchArticles();
        setNewArticle({ title: '', solution: '', category: 'Общее', images: [] });
        alert('Статья успешно добавлена!');
      } else {
        const errorData = await response.json();
        throw new Error(`Ошибка при добавлении статьи: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка добавления статьи:', err);
      alert('Произошла ошибка при добавлении статьи: ' + err.message);
    }
  };

  const updateArticle = async () => {
    if (!editingArticle.title.trim() || !editingArticle.solution.trim()) {
      alert('Заголовок и решение обязательны для заполнения');
      return;
    }

    try {
      const articleData = {
        title: editingArticle.title,
        solution: editingArticle.solution,
        category: editingArticle.category || 'Общее',
        images: prepareImagesForSend(editingArticle.images)
      };

      console.log('Отправляемые данные для обновления:', articleData);

      const response = await fetch(`${API_BASE_URL}/knowledge-base/${editingArticle.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(articleData)
      });

      if (response.ok) {
        await fetchArticles();
        setEditingArticle(null);
        alert('Статья успешно обновлена!');
      } else {
        const errorData = await response.json();
        throw new Error(`Ошибка при обновлении статьи: ${errorData.error || response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка обновления статьи:', err);
      alert('Произошла ошибка при обновлении статьи: ' + err.message);
    }
  };

  const deleteArticle = async (id) => {
    if (!window.confirm('Вы уверены, что хотите удалить эту статью?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/knowledge-base/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchArticles();
        alert('Статья успешно удалена!');
      } else {
        throw new Error('Ошибка при удалении статьи');
      }
    } catch (err) {
      console.error('Ошибка удаления статьи:', err);
      alert('Произошла ошибка при удалении статьи');
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
    return new Date(dateString).toLocaleDateString('ru-RU', {
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
          <p>Загрузка базы знаний...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-base">
      <div className="kb-header">
        <h1>База знаний</h1>
        <div className="search-filter">
          <input
            type="text"
            placeholder="Поиск статей..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="category-filter"
          >
            <option value="all">Все категории</option>
            {categories.filter(cat => cat && cat !== 'all').map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="kb-resource-link">
        <div>
          <strong>Официальный сайт НИОХ СО РАН</strong>
          <span>Полезная ссылка для справочной информации</span>
        </div>
        <a href="http://nioch.nioch.nsc.ru/nioch/" target="_blank" rel="noopener noreferrer">
          Открыть сайт
        </a>
      </div>

      <section className="network-map-section">
        <div className="network-map-head">
          <div>
            <span className="network-eyebrow">Сетка / маска сети</span>
            <h2>Свободные и занятые IP-адреса</h2>
            <p>Источник: <a href={NETWORK_SOURCE_URL} target="_blank" rel="noopener noreferrer">nioch.txt</a></p>
          </div>
          <button type="button" className="network-refresh-btn" onClick={() => fetchNetworkMap({ silent: false })} disabled={networkLoading}>
            {networkLoading ? 'Обновляем...' : 'Обновить сетку'}
          </button>
        </div>

        <div className="network-toolbar">
          <input
            type="text"
            placeholder="Поиск: IP, хост, подсеть, раздел..."
            value={networkSearch}
            onChange={(e) => setNetworkSearch(e.target.value)}
          />
          <select value={networkFilter} onChange={(e) => setNetworkFilter(e.target.value)}>
            <option value="all">Все адреса</option>
            <option value="free">Только свободные</option>
            <option value="occupied">Только занятые</option>
          </select>
        </div>

        <div className="network-summary-grid">
          <div><strong>{networkStats.networks}</strong><span>подсетей /24</span></div>
          <div><strong>{networkStats.occupied}</strong><span>занятых IP</span></div>
          <div><strong>{networkStats.free}</strong><span>свободных IP</span></div>
          <div><strong>{networkUpdatedAt ? new Date(networkUpdatedAt).toLocaleString('ru-RU') : '—'}</strong><span>последнее обновление</span></div>
        </div>

        {networkError && <div className="network-error">{networkError}</div>}

        <div className="network-tables">
          {filteredNetworkGroups.length === 0 && <div className="no-articles">Сетка не найдена по текущему поиску</div>}
          {filteredNetworkGroups.map((network) => (
            <article key={network.cidr} className="network-card">
              <header>
                <div>
                  <h3>{network.cidr}</h3>
                  <p>{network.section}</p>
                </div>
                <div className="network-card-stats">
                  <span className="occupied">Занято: {network.occupied.length}</span>
                  <span className="free">Свободно: {network.freeIps.length}</span>
                </div>
              </header>
              <div className="free-ranges">
                <strong>Свободные диапазоны:</strong>
                <span>{network.freeRanges.slice(0, 8).join(', ') || 'нет'}</span>
                {network.freeRanges.length > 8 && <em>ещё {network.freeRanges.length - 8}</em>}
              </div>
              <div className="network-table-wrap">
                <table className="network-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Статус</th>
                      <th>Хост</th>
                    </tr>
                  </thead>
                  <tbody>
                    {network.rows.map((row) => (
                      <tr key={`${network.cidr}-${row.ip}-${row.status}`} className={row.status === 'free' ? 'ip-free' : 'ip-occupied'}>
                        <td>{row.ip}</td>
                        <td>{row.status === 'free' ? 'Свободен' : 'Занят'}</td>
                        <td>{row.host}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>

      {error && (
        <div className="error-message">
          <span>{error}</span>
          <button onClick={fetchArticles} className="retry-button">
            Повторить попытку
          </button>
        </div>
      )}

      <div className="kb-content">
        <div className="articles-section">
          <h2>Статьи ({filteredArticles.length})</h2>
          {filteredArticles.length === 0 ? (
            <div className="no-articles">
              <p>Статьи не найдены</p>
              <button onClick={fetchArticles} className="retry-button">
                Обновить
              </button>
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
                        >
                          Редактировать
                        </button>
                        <button 
                          onClick={() => deleteArticle(article.id)}
                          className="delete-btn"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                    <p className="article-category">Категория: {article.category || 'Общее'}</p>
                    <div className="article-content">
                      <h4>Решение:</h4>
                      <pre>{article.solution}</pre>
                    </div>
                    
                    {articleImages.length > 0 && (
                      <div className="article-images">
                        <h4>Изображения ({articleImages.length})</h4>
                        <div className="images-grid">
                          {articleImages.map((image, index) => (
                            <div key={index} className="image-item">
                              <img 
                                src={image.data || image.url} 
                                alt={image.name || `Изображение ${index + 1}`}
                                onClick={() => setExpandedImage(image)}
                                className="article-image"
                                onError={(e) => {
                                  console.error('Ошибка загрузки изображения:', image);
                                  e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik03NSA0MFY4ME00MCA1NUgxMTAiIHN0cm9rZT0iIzlDQTZBNiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+';
                                }}
                              />
                              <span className="image-name">
                                {image.name || `Изображение ${index + 1}`}
                                {image.size && ` (${formatFileSize(image.size)})`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <p className="article-date">
                      Обновлено: {formatDate(article.updated_at)}
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
              <h2>Редактирование статьи #{editingArticle.id}</h2>
              <input
                type="text"
                name="title"
                placeholder="Заголовок статьи"
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
                <option value="Установка ПО">Установка ПО</option>
                <option value="Сеть">Сеть</option>
                <option value="Оборудование">Оборудование</option>
                <option value="Принтеры">Принтеры</option>
                <option value="Активация">Активация</option>
                <option value="Общее">Общее</option>
              </select>
              <textarea
                name="solution"
                placeholder="Решение проблемы"
                value={editingArticle.solution}
                onChange={handleInputChange}
                className="form-textarea"
                rows="6"
              />
              
              <div className="image-upload-section">
                <h4>Изображения</h4>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  multiple
                  className="file-input"
                  disabled={uploadingImages}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="upload-btn"
                  disabled={uploadingImages}
                >
                  {uploadingImages ? 'Загрузка...' : 'Добавить изображения'}
                </button>
                <p className="file-restrictions">
                  Максимальный размер: 2MB. Разрешены: JPEG, PNG, GIF, WebP
                </p>
                
                {editingArticle.images && editingArticle.images.length > 0 && (
                  <div className="uploaded-images">
                    <h5>Загруженные изображения ({editingArticle.images.length}):</h5>
                    <div className="images-preview">
                      {editingArticle.images.map((image, index) => (
                        <div key={index} className="image-preview-item">
                          <img 
                            src={image.data || image.url} 
                            alt={image.name || `Превью ${index + 1}`}
                            className="preview-image"
                          />
                          <div className="image-info">
                            <span>{image.name || `Изображение ${index + 1}`}</span>
                            <span>{formatFileSize(image.size)}</span>
                            <span>{new Date(image.uploadedAt).toLocaleDateString()}</span>
                          </div>
                          <button 
                            onClick={() => removeImage(index, true)}
                            className="remove-image-btn"
                            title="Удалить изображение"
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
                <button onClick={cancelEditing} className="cancel-btn">
                  Отмена
                </button>
                <button onClick={updateArticle} className="save-btn">
                  Сохранить изменения
                </button>
              </div>
            </div>
          ) : (
            <div className="add-form">
              <h2>Добавить новую статью</h2>
              <input
                type="text"
                name="title"
                placeholder="Заголовок статьи"
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
                <option value="Установка ПО">Установка ПО</option>
                <option value="Сеть">Сеть</option>
                <option value="Оборудование">Оборудование</option>
                <option value="Принтеры">Принтеры</option>
                <option value="Активация">Активация</option>
                <option value="Общее">Общее</option>
              </select>
              <textarea
                name="solution"
                placeholder="Решение проблемы"
                value={newArticle.solution}
                onChange={handleInputChange}
                className="form-textarea"
                rows="6"
              />
              
              <div className="image-upload-section">
                <h4>Изображения (опционально)</h4>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  multiple
                  className="file-input"
                  disabled={uploadingImages}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="upload-btn"
                  disabled={uploadingImages}
                >
                  {uploadingImages ? 'Загрузка...' : 'Добавить изображения'}
                </button>
                <p className="file-restrictions">
                  Максимальный размер: 2MB. Разрешены: JPEG, PNG, GIF, WebP
                </p>
                
                {newArticle.images && newArticle.images.length > 0 && (
                  <div className="uploaded-images">
                    <h5>Загруженные изображения ({newArticle.images.length}):</h5>
                    <div className="images-preview">
                      {newArticle.images.map((image, index) => (
                        <div key={index} className="image-preview-item">
                          <img 
                            src={image.data || image.url} 
                            alt={image.name || `Превью ${index + 1}`}
                            className="preview-image"
                          />
                          <div className="image-info">
                            <span>{image.name || `Изображение ${index + 1}`}</span>
                            <span>{formatFileSize(image.size)}</span>
                            <span>{new Date(image.uploadedAt).toLocaleDateString()}</span>
                          </div>
                          <button 
                            onClick={() => removeImage(index)}
                            className="remove-image-btn"
                            title="Удалить изображение"
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
                disabled={!newArticle.title || !newArticle.solution || uploadingImages}
              >
                {uploadingImages ? 'Загрузка...' : 'Добавить статью'}
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
              alt={expandedImage.name || 'Увеличенное изображение'}
              className="expanded-image"
            />
            <div className="image-details">
              <p><strong>Имя файла:</strong> {expandedImage.name || 'Не указано'}</p>
              <p><strong>Размер:</strong> {formatFileSize(expandedImage.size)}</p>
              <p><strong>Тип:</strong> {expandedImage.type || 'Не указан'}</p>
              {expandedImage.uploadedAt && (
                <p><strong>Загружено:</strong> {new Date(expandedImage.uploadedAt).toLocaleString()}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;