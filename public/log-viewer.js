(function () {
  const runtime = window.radarRuntime;

  const elements = {
    fileSelect: document.getElementById('file-select'),
    refreshBtn: document.getElementById('refresh-btn'),
    openBtn: document.getElementById('open-btn'),
    statusText: document.getElementById('status-text'),
    body: document.getElementById('log-body'),
    empty: document.getElementById('empty-state'),
    sumTotal: document.getElementById('sum-total'),
    sumAlert: document.getElementById('sum-alert'),
    sumWarning: document.getElementById('sum-warning'),
    sumInfo: document.getElementById('sum-info'),
  };

  const state = {
    files: [],
    rows: [],
    selectedFile: '',
  };

  function setStatus(message, tone) {
    elements.statusText.textContent = message;
    if (tone === 'error') {
      elements.statusText.style.color = '#fca5a5';
      return;
    }
    if (tone === 'success') {
      elements.statusText.style.color = '#93c5fd';
      return;
    }
    elements.statusText.style.color = '#91a0b6';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTimestamp(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString || '-';
    }
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          value += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(value);
        value = '';
      } else if (ch === '\n') {
        row.push(value);
        rows.push(row);
        row = [];
        value = '';
      } else if (ch === '\r') {
      } else {
        value += ch;
      }
    }

    if (value.length > 0 || row.length > 0) {
      row.push(value);
      rows.push(row);
    }

    return rows.filter((item) => !(item.length === 1 && item[0].trim() === ''));
  }

  function parseLogRows(csvText) {
    const matrix = parseCsv(csvText);
    if (matrix.length === 0) {
      return [];
    }

    const headers = matrix[0].map((item) => item.trim().toLowerCase());
    const rows = [];

    for (let i = 1; i < matrix.length; i += 1) {
      const line = matrix[i];
      const row = {};
      for (let j = 0; j < headers.length; j += 1) {
        row[headers[j]] = line[j] || '';
      }
      rows.push({
        timestamp: row.timestamp || '',
        type: (row.type || 'INFO').toUpperCase(),
        message: row.message || '',
        objectId: row.object_id || '',
        objectClass: row.object_class || '',
      });
    }

    rows.sort((a, b) => {
      const ta = Date.parse(a.timestamp);
      const tb = Date.parse(b.timestamp);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
      return tb - ta;
    });

    return rows;
  }

  function renderSummary() {
    const counts = {
      total: state.rows.length,
      alert: 0,
      warning: 0,
      info: 0,
    };

    state.rows.forEach((row) => {
      if (row.type === 'ALERT') counts.alert += 1;
      else if (row.type === 'WARNING') counts.warning += 1;
      else counts.info += 1;
    });

    elements.sumTotal.textContent = String(counts.total);
    elements.sumAlert.textContent = String(counts.alert);
    elements.sumWarning.textContent = String(counts.warning);
    elements.sumInfo.textContent = String(counts.info);
  }

  function getTypeBadgeClass(type) {
    if (type === 'ALERT') return 'type-badge type-alert';
    if (type === 'WARNING') return 'type-badge type-warning';
    return 'type-badge type-info';
  }

  function renderTable() {
    if (state.rows.length === 0) {
      elements.body.innerHTML = '';
      elements.empty.hidden = false;
      renderSummary();
      return;
    }

    elements.empty.hidden = true;
    elements.body.innerHTML = state.rows
      .map((row) => {
        return [
          '<tr>',
          `<td class="mono">${escapeHtml(formatTimestamp(row.timestamp))}</td>`,
          `<td><span class="${getTypeBadgeClass(row.type)}">${escapeHtml(row.type)}</span></td>`,
          `<td>${escapeHtml(row.message)}</td>`,
          `<td class="mono">${escapeHtml(row.objectId || '-')}</td>`,
          `<td>${escapeHtml(row.objectClass || '-')}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');

    renderSummary();
  }

  function renderFileOptions() {
    if (state.files.length === 0) {
      elements.fileSelect.innerHTML = '<option value="">로그 파일 없음</option>';
      elements.fileSelect.disabled = true;
      elements.openBtn.disabled = true;
      return;
    }

    elements.fileSelect.disabled = false;
    elements.openBtn.disabled = false;
    elements.fileSelect.innerHTML = state.files
      .map((file) => {
        const dateText = file.dateKey || file.name;
        return `<option value="${escapeHtml(file.name)}">${escapeHtml(dateText)} (${escapeHtml(file.name)})</option>`;
      })
      .join('');

    if (!state.selectedFile || !state.files.some((file) => file.name === state.selectedFile)) {
      state.selectedFile = state.files[0].name;
    }
    elements.fileSelect.value = state.selectedFile;
  }

  async function loadFileList() {
    if (!runtime || typeof runtime.listEventLogFiles !== 'function') {
      setStatus('Electron 런타임에서만 로그 파일 조회가 가능합니다.', 'error');
      state.files = [];
      renderFileOptions();
      state.rows = [];
      renderTable();
      return;
    }

    setStatus('로그 파일 목록 조회 중...');
    const response = await runtime.listEventLogFiles();
    if (!response || !response.ok) {
      setStatus(`로그 파일 목록 조회 실패: ${response && response.error ? response.error : 'unknown error'}`, 'error');
      state.files = [];
      renderFileOptions();
      state.rows = [];
      renderTable();
      return;
    }

    state.files = Array.isArray(response.files) ? response.files : [];
    renderFileOptions();
    setStatus(`로그 파일 ${state.files.length}개 확인`, 'success');
  }

  async function loadSelectedFile() {
    if (!state.selectedFile) {
      state.rows = [];
      renderTable();
      return;
    }

    if (!runtime || typeof runtime.readEventLogFile !== 'function') {
      setStatus('Electron 런타임에서만 로그 파일 읽기가 가능합니다.', 'error');
      state.rows = [];
      renderTable();
      return;
    }

    setStatus(`${state.selectedFile} 로딩 중...`);
    const response = await runtime.readEventLogFile({ fileName: state.selectedFile });
    if (!response || !response.ok) {
      setStatus(`로그 파일 읽기 실패: ${response && response.error ? response.error : 'unknown error'}`, 'error');
      state.rows = [];
      renderTable();
      return;
    }

    state.rows = parseLogRows(response.content || '');
    renderTable();
    const encoding =
      response && typeof response.encoding === 'string' && response.encoding
        ? response.encoding.toUpperCase()
        : 'UTF-8';
    setStatus(`${state.selectedFile} · ${state.rows.length}개 이벤트 · ${encoding}`, 'success');
  }

  elements.fileSelect.addEventListener('change', () => {
    state.selectedFile = elements.fileSelect.value;
    void loadSelectedFile();
  });

  elements.refreshBtn.addEventListener('click', async () => {
    await loadFileList();
    await loadSelectedFile();
  });

  elements.openBtn.addEventListener('click', () => {
    state.selectedFile = elements.fileSelect.value;
    void loadSelectedFile();
  });

  (async () => {
    await loadFileList();
    await loadSelectedFile();
  })();
})();
