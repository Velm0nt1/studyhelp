(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const todayISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  localStorage.removeItem('studyhelp-acceso');

  let tasks = read('studyhelp-tareas', []);
  let summaries = read('studyhelp-resumenes', []);
  let questions = read('studyhelp-dudas', []);
  let aiConversation = read('studyhelp-chat-ia', []);
  let grades = read('studyhelp-calificaciones', []);
  let profile = read('studyhelp-perfil', { name: 'Estudiante', photo: '' });
  let profileCoverPreviewUrl = null;
  let profileAvatarPreviewUrl = null;
  let removeBannerRequested = false;
  let taskFilter = 'todas';
  let taskSort = 'fecha';
  let expandedTasks = false;
  let favoritesOnly = false;
  let agendaWeekOffset = 0;
  const savedPomodoro = read('studyhelp-pomodoro', null);
  let studyMinutes = Math.min(180, Math.max(1, Number(savedPomodoro?.studyMinutes) || 25));
  let breakMinutes = Math.min(60, Math.max(1, Number(savedPomodoro?.breakMinutes) || Math.round(studyMinutes / 5)));
  let pomodoroSeconds = Math.min((studyMinutes + breakMinutes) * 60, Math.max(0, Number(savedPomodoro?.seconds) || studyMinutes * 60));
  let pomodoroInterval = null;
  let isBreak = Boolean(savedPomodoro?.isBreak);
  let timerDeadline = savedPomodoro?.running && savedPomodoro.deadline ? Number(savedPomodoro.deadline) : null;
  let sessions = read('studyhelp-sesiones', []);
  let preferences = read('studyhelp-preferencias', { notifications: false, sound: false });
  let timerAudioContext = null;
  let toastTimer;
  let toastUndoAction = null;

  function notify(message, undoAction = null) {
    const toast = $('#aviso'); toast.replaceChildren(); toastUndoAction = undoAction;
    const text = document.createElement('span'); text.textContent = message; toast.append(text);
    if (undoAction) { const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'toast-undo'; undo.textContent = 'Deshacer'; undo.addEventListener('click', () => { const action = toastUndoAction; toastUndoAction = null; if (action) action(); toast.classList.remove('visible'); }); toast.append(undo); }
    toast.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
  }
  function showView(view) {
    $$('.page-view').forEach(page => page.classList.toggle('active', page.dataset.view === view));
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.section === view));
    const names = { inicio: 'Inicio', dudas: 'Resolver dudas', tutor: 'Tutor IA', resumenes: 'Crear resúmenes', tareas: 'Organizar tareas', agenda: 'Agenda semanal', calificaciones: 'Mis calificaciones' };
    $('.breadcrumb strong').textContent = names[view] || 'Inicio';
    $('#barra-lateral').classList.remove('open');
    history.replaceState(null, '', `#${view}`); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Navegación entre páginas independientes dentro de esta aplicación de una sola página.
  $$('.nav-link').forEach(link => link.addEventListener('click', event => { event.preventDefault(); showView(link.dataset.section); }));
  $$('[data-ir]').forEach(button => button.addEventListener('click', () => showView(button.dataset.ir)));
  $('#menu-movil').addEventListener('click', () => $('#barra-lateral').classList.toggle('open'));
  const initialView = location.hash.slice(1);
  showView(['inicio', 'dudas', 'tutor', 'resumenes', 'tareas', 'agenda', 'calificaciones'].includes(initialView) ? initialView : 'inicio');

  // Tema y perfil local.
  const theme = read('studyhelp-tema', 'claro');
  if (theme === 'oscuro') document.documentElement.dataset.tema = 'oscuro';
  $('#cambiar-tema').textContent = theme === 'oscuro' ? '☀' : '☾';
  $('#cambiar-tema').setAttribute('aria-label', theme === 'oscuro' ? 'Activar modo claro' : 'Activar modo oscuro');
  $('#cambiar-tema').addEventListener('click', () => {
    const dark = document.documentElement.dataset.tema !== 'oscuro';
    if (dark) document.documentElement.dataset.tema = 'oscuro'; else delete document.documentElement.dataset.tema;
    write('studyhelp-tema', dark ? 'oscuro' : 'claro'); $('#cambiar-tema').textContent = dark ? '☀' : '☾';
    $('#cambiar-tema').setAttribute('aria-label', dark ? 'Activar modo claro' : 'Activar modo oscuro');
  });
  function paintProfile() {
    $('#saludo-estudiante').textContent = `¡Hola, ${profile.name || 'Estudiante'}!`;
    $$('.profile-copy strong').forEach(node => { node.textContent = profile.name || 'Estudiante'; });
    $$('.avatar').forEach(node => {
      node.textContent = profile.photo ? '' : (profile.name || 'E').trim().charAt(0).toLocaleUpperCase('es');
      node.style.backgroundImage = profile.photo ? `url("${profile.photo}")` : '';
      node.classList.toggle('has-photo', Boolean(profile.photo));
    });
    $('#vista-portada').style.backgroundImage = profile.banner ? `linear-gradient(180deg,transparent 40%,rgba(22,28,54,.48)),url("${profile.banner}")` : '';
    $('#vista-portada').style.backgroundSize = profile.banner ? 'cover' : '';
  }
  function openDialog(dialog) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
  $('.profile-button').addEventListener('click', () => { $('#nombre-perfil').value = profile.name || ''; $('#foto-perfil').value = ''; $('#banner-perfil').value = ''; removeBannerRequested = false; $('#vista-portada').style.backgroundImage = profile.banner ? `linear-gradient(180deg,transparent 40%,rgba(22,28,54,.48)),url("${profile.banner}")` : ''; $('#vista-portada').style.backgroundSize = profile.banner ? 'cover' : ''; openDialog($('#modal-perfil')); });
  function updateProfilePreview(input, property, previousUrl) {
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const file = input.files[0]; if (!file) return null;
    if (!file.type.startsWith('image/')) { notify('Selecciona un archivo de imagen.'); input.value = ''; return null; }
    const url = URL.createObjectURL(file);
    if (property === 'banner') { $('#vista-portada').style.backgroundImage = `linear-gradient(180deg,transparent 40%,rgba(22,28,54,.48)),url("${url}")`; $('#vista-portada').style.backgroundSize = 'cover'; }
    else { $('#vista-avatar').style.backgroundImage = `url("${url}")`; $('#vista-avatar').textContent = ''; $('#vista-avatar').classList.add('has-photo'); }
    return url;
  }
  $('#banner-perfil').addEventListener('change', () => { profileCoverPreviewUrl = updateProfilePreview($('#banner-perfil'), 'banner', profileCoverPreviewUrl); removeBannerRequested = false; });
  $('#foto-perfil').addEventListener('change', () => { profileAvatarPreviewUrl = updateProfilePreview($('#foto-perfil'), 'avatar', profileAvatarPreviewUrl); });
  $('#quitar-banner').addEventListener('click', () => { removeBannerRequested = true; if (profileCoverPreviewUrl) URL.revokeObjectURL(profileCoverPreviewUrl); profileCoverPreviewUrl = null; $('#banner-perfil').value = ''; $('#vista-portada').style.backgroundImage = ''; $('#vista-portada').style.backgroundSize = ''; });
  $('#cerrar-perfil').addEventListener('click', () => $('#modal-perfil').close());
  $('#modal-perfil').addEventListener('close', () => { if (profileCoverPreviewUrl) URL.revokeObjectURL(profileCoverPreviewUrl); if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl); profileCoverPreviewUrl = null; profileAvatarPreviewUrl = null; paintProfile(); });
  function compressProfileImage(file, width, height, quality) {
    return new Promise((resolve, reject) => {
      const image = new Image(); const url = URL.createObjectURL(file);
      image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); const scale = Math.max(width / image.width, height / image.height); const drawWidth = image.width * scale; const drawHeight = image.height * scale; context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight); URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg', quality)); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen.')); }; image.src = url;
    });
  }
  $('#form-perfil').addEventListener('submit', async event => {
    event.preventDefault(); const nextProfile = { ...profile, name: $('#nombre-perfil').value.trim() || 'Estudiante' };
    const photo = $('#foto-perfil').files[0]; const banner = $('#banner-perfil').files[0];
    try {
      if (photo) { if (photo.size > 5 * 1024 * 1024) { notify('La foto debe pesar menos de 5 MB.'); return; } nextProfile.photo = await compressProfileImage(photo, 240, 240, 0.78); }
      if (banner) { if (banner.size > 8 * 1024 * 1024) { notify('La portada debe pesar menos de 8 MB.'); return; } nextProfile.banner = await compressProfileImage(banner, 1440, 460, 0.72); }
      if (removeBannerRequested) nextProfile.banner = '';
      write('studyhelp-perfil', nextProfile); profile = nextProfile; paintProfile(); $('#modal-perfil').close(); notify('Perfil actualizado.');
    } catch { notify('No se pudo procesar la imagen. Prueba con otra foto.'); }
  });
  const backupKeys = ['studyhelp-tareas', 'studyhelp-resumenes', 'studyhelp-dudas', 'studyhelp-chat-ia', 'studyhelp-calificaciones', 'studyhelp-perfil', 'studyhelp-tema', 'studyhelp-sesiones', 'studyhelp-pomodoro', 'studyhelp-preferencias', 'studyhelp-tutorial', 'studyhelp-borrador-form-tarea', 'studyhelp-borrador-form-resumen', 'studyhelp-borrador-form-duda', 'studyhelp-borrador-form-calificacion'];
  $('#exportar-datos').addEventListener('click', () => {
    const backup = { app: 'StudyHelp', version: 1, exportedAt: new Date().toISOString(), data: Object.fromEntries(backupKeys.map(key => [key, read(key, null)])) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `studyhelp-copia-${todayISO()}.json`; link.click(); URL.revokeObjectURL(url); notify('Copia de seguridad descargada.');
  });
  $('#importar-datos').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('La copia supera el límite de 20 MB.');
      const backup = JSON.parse(await file.text()); if (backup.app !== 'StudyHelp' || !backup.data || typeof backup.data !== 'object') throw new Error('El archivo no es una copia de StudyHelp.');
      if (!window.confirm('Importar esta copia reemplazará tus datos actuales de StudyHelp en este navegador. ¿Continuar?')) return;
      const arrayKeys = ['studyhelp-tareas', 'studyhelp-resumenes', 'studyhelp-dudas', 'studyhelp-chat-ia', 'studyhelp-calificaciones', 'studyhelp-sesiones'];
      arrayKeys.forEach(key => { const value = backup.data[key]; if (key in backup.data && value !== null && (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object'))) throw new Error('La copia tiene una sección dañada.'); });
      if ('studyhelp-perfil' in backup.data && backup.data['studyhelp-perfil'] !== null) { const importedProfile = backup.data['studyhelp-perfil']; if (typeof importedProfile !== 'object' || typeof importedProfile.name !== 'string' || (importedProfile.photo && !String(importedProfile.photo).startsWith('data:image/')) || (importedProfile.banner && !String(importedProfile.banner).startsWith('data:image/'))) throw new Error('La información del perfil no es válida.'); }
      if ('studyhelp-tema' in backup.data && backup.data['studyhelp-tema'] !== null && !['claro', 'oscuro'].includes(backup.data['studyhelp-tema'])) throw new Error('La preferencia de tema no es válida.');
      if ('studyhelp-preferencias' in backup.data && backup.data['studyhelp-preferencias'] !== null && typeof backup.data['studyhelp-preferencias'] !== 'object') throw new Error('Las preferencias de la copia no son válidas.');
      const previousData = Object.fromEntries(backupKeys.map(key => [key, localStorage.getItem(key)]));
      try { backupKeys.forEach(key => { if (key in backup.data) localStorage.setItem(key, JSON.stringify(backup.data[key])); }); }
      catch { backupKeys.forEach(key => { const old = previousData[key]; if (old === null) localStorage.removeItem(key); else localStorage.setItem(key, old); }); throw new Error('La copia no cabe en el espacio disponible de este navegador.'); }
      location.reload();
    } catch (error) { notify(error.message || 'No se pudo leer esa copia de seguridad.'); }
    finally { event.target.value = ''; }
  });
  paintProfile();

  // Actividad y racha: cuenta días con una nota nueva o una tarea completada.
  function renderStreak() {
    const days = new Set([
      ...summaries.map(item => (item.created || '').slice(0, 10)),
      ...tasks.filter(item => item.done && item.completedAt).map(item => item.completedAt),
      ...sessions.map(item => item.date)
    ].filter(Boolean));
    const cursor = new Date(); if (!days.has(todayISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0; while (days.has(todayISO(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    $('#racha-estudio').textContent = streak;
    const studiedMinutes = sessions.reduce((total, item) => total + (Number(item.minutes) || 0), 0);
    const hours = Math.floor(studiedMinutes / 60); const minutes = studiedMinutes % 60;
    $('#tiempo-estudiado').textContent = `Tiempo enfocado: ${hours ? `${hours} h ` : ''}${minutes} min`;
  }

  function renderProgress() {
    const total = tasks.length;
    const completed = tasks.filter(task => task.done).length;
    const percent = total ? Math.round(completed / total * 100) : 0;
    $('#texto-progreso').textContent = `${completed} de ${total} completadas · ${percent}%`;
    $('#barra-progreso').style.width = `${percent}%`;
    $('.progress-track').setAttribute('aria-valuenow', String(percent));
  }

  function renderHomeQueue() {
    const list = $('#tareas-inicio'); list.replaceChildren();
    const upcoming = tasks.filter(task => !task.done).sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31')).slice(0, 5);
    if (!upcoming.length) { const empty = document.createElement('p'); empty.className = 'summary-empty'; empty.textContent = 'No tienes pendientes. ¡Buen momento para repasar o descansar!'; list.append(empty); return; }
    upcoming.forEach(task => { const row = document.createElement('div'); row.className = 'home-task-row'; const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'task-check'; check.setAttribute('aria-label', `Completar ${task.text}`); check.addEventListener('change', () => { task.done = true; task.completedAt = todayISO(); write('studyhelp-tareas', tasks); renderTasks(); renderAgenda(); }); const name = document.createElement('button'); name.type = 'button'; name.className = 'home-task-name'; name.textContent = task.text; name.addEventListener('click', () => { showView('tareas'); editTask(task); }); const meta = document.createElement('small'); const dateText = task.date ? new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' }).format(new Date(`${task.date}T12:00:00`)) : 'Sin fecha'; meta.textContent = `${task.subject || 'Otra materia'} · ${dateText}`; row.append(check, name, meta); list.append(row); });
  }

  function refreshSummaryLinks() {
    [['#apunte-tarea', 'Sin apunte vinculado'], ['#apunte-calificacion', 'Sin apunte vinculado']].forEach(([selector, placeholder]) => {
      const select = $(selector); if (!select) return; const selected = select.value; select.replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = placeholder; select.append(empty);
      summaries.forEach(note => { const option = document.createElement('option'); option.value = note.id; option.textContent = `${note.subject || 'Otra'} · ${note.title}`; select.append(option); });
      if (summaries.some(note => note.id === selected)) select.value = selected;
    });
  }

  // Tareas, filtros y prioridades.
  function renderTasks() {
    const list = $('#lista-tareas'); list.replaceChildren();
    let filtered = tasks;
    if (taskFilter === 'pendientes') filtered = tasks.filter(task => !task.done);
    if (taskFilter === 'completadas') filtered = tasks.filter(task => task.done);
    if (taskFilter === 'urgentes') filtered = tasks.filter(task => ['alta', 'urgente'].includes(task.priority) && !task.done);
    if (taskFilter === 'vencidas') filtered = tasks.filter(task => !task.done && task.date && task.date < todayISO());
    const query = ($('#buscar-tarea')?.value || '').trim().toLocaleLowerCase('es');
    const subjectFilter = $('#filtrar-materia-tarea')?.value || '';
    filtered = filtered.filter(task => `${task.text} ${task.detail || ''} ${task.subject || ''}`.toLocaleLowerCase('es').includes(query) && (!subjectFilter || (task.subject || 'Otra') === subjectFilter));
    filtered = [...filtered].sort((a, b) => {
      if (taskSort === 'prioridad') return ({ alta: 0, urgente: 0, media: 1, normal: 1, baja: 2 }[a.priority] ?? 1) - ({ alta: 0, urgente: 0, media: 1, normal: 1, baja: 2 }[b.priority] ?? 1);
      if (taskSort === 'recientes') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31');
    });
    const shown = expandedTasks ? filtered : filtered.slice(0, 8);
    $('#vacio-tareas').hidden = filtered.length > 0;
    for (const task of shown) {
      const overdue = !task.done && task.date && task.date < todayISO();
      const row = document.createElement('div'); row.className = `task-item${task.done ? ' done' : ''}${overdue ? ' task-overdue' : ''}`;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'task-check'; checkbox.checked = Boolean(task.done);
      checkbox.setAttribute('aria-label', `Marcar ${task.text} como ${task.done ? 'pendiente' : 'completada'}`);
      checkbox.addEventListener('change', () => { task.done = checkbox.checked; task.completedAt = task.done ? todayISO() : null; write('studyhelp-tareas', tasks); renderTasks(); renderAgenda(); });
      const name = document.createElement('span'); name.className = 'task-name'; name.textContent = task.text;
      if (task.detail) { const detail = document.createElement('small'); detail.className = 'task-detail'; detail.textContent = task.detail; name.append(detail); }
      const tag = document.createElement('span'); tag.className = `task-tag priority-${task.priority || 'media'}`;
      tag.textContent = `Prioridad ${({ alta: 'alta', media: 'media', baja: 'baja', urgente: 'alta', normal: 'media' })[task.priority] || 'media'}`;
      const subject = document.createElement('span'); subject.className = 'task-subject'; subject.textContent = task.subject || 'Otra materia';
      const date = document.createElement('span'); date.className = 'task-date'; date.textContent = overdue ? `Vencida · ${new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' }).format(new Date(`${task.date}T12:00:00`))}` : task.date ? new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${task.date}T12:00:00`)) : 'Sin fecha';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'task-edit'; edit.textContent = 'Editar'; edit.addEventListener('click', () => editTask(task));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'task-delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `Eliminar tarea ${task.text}`);
      remove.addEventListener('click', () => { const index = tasks.findIndex(item => item.id === task.id); tasks = tasks.filter(item => item.id !== task.id); write('studyhelp-tareas', tasks); renderTasks(); renderAgenda(); notify('Tarea eliminada.', () => { tasks.splice(index, 0, task); write('studyhelp-tareas', tasks); renderTasks(); renderAgenda(); }); });
      row.append(checkbox, name, tag, subject, date);
      const linkedNote = summaries.find(note => note.id === task.summaryId);
      if (linkedNote) { const noteButton = document.createElement('button'); noteButton.type = 'button'; noteButton.className = 'task-note-link'; noteButton.textContent = '▤ Apunte'; noteButton.title = linkedNote.title; noteButton.addEventListener('click', () => openSummaryPreview(linkedNote)); row.append(noteButton); }
      row.append(edit, remove); list.append(row);
    }
    $('#total-tareas').textContent = tasks.filter(task => !task.done).length;
    $('#total-completadas').textContent = tasks.filter(task => task.done).length;
    $('#contador-tareas-vista').textContent = `${tasks.filter(task => !task.done).length} pendientes · ${tasks.filter(task => !task.done && task.date && task.date < todayISO()).length} vencidas`;
    $('#ver-tareas').hidden = filtered.length <= 8;
    $('#ver-tareas').innerHTML = expandedTasks ? 'Mostrar menos <span>↑</span>' : 'Ver todas las tareas <span>→</span>';
    renderStreak();
    renderProgress();
    renderHomeQueue();
  }

  function editTask(task) {
    $('#id-tarea-editar').value = task.id;
    $('#entrada-tarea').value = task.text;
    $('#fecha-tarea').value = task.date || '';
    $('#prioridad-tarea').value = ['alta', 'media', 'baja'].includes(task.priority) ? task.priority : (task.priority === 'urgente' ? 'alta' : 'media');
    $('#materia-tarea').value = task.subject || 'Otra';
    $('#apunte-tarea').value = task.summaryId || '';
    $('#detalle-tarea').value = task.detail || '';
    $('#titulo-editor-tarea').textContent = 'Editar tarea'; $('#guardar-tarea').textContent = 'Guardar'; $('#cancelar-edicion-tarea').hidden = false;
    $('#entrada-tarea').focus();
  }
  function clearTaskEditor() {
    $('#form-tarea').reset(); $('#id-tarea-editar').value = ''; $('#titulo-editor-tarea').textContent = 'Lista de tareas';
    $('#guardar-tarea').textContent = '+'; $('#cancelar-edicion-tarea').hidden = true;
  }
  $('#form-tarea').addEventListener('submit', event => {
    event.preventDefault(); const text = $('#entrada-tarea').value.trim(); if (!text) return;
    const id = $('#id-tarea-editar').value;
    const values = { text, detail: $('#detalle-tarea').value.trim(), date: $('#fecha-tarea').value, priority: $('#prioridad-tarea').value, subject: $('#materia-tarea').value, summaryId: $('#apunte-tarea').value };
    if (id) { const task = tasks.find(item => item.id === id); if (task) Object.assign(task, values, { updatedAt: new Date().toISOString() }); }
    else tasks.unshift({ id: crypto.randomUUID(), ...values, done: false, createdAt: new Date().toISOString() });
    write('studyhelp-tareas', tasks); clearTaskEditor(); renderTasks(); renderAgenda(); notify(id ? 'Tarea actualizada.' : 'Tarea agregada a tu plan.');
  });
  $('#cancelar-edicion-tarea').addEventListener('click', clearTaskEditor);
  $('#ver-notificaciones').addEventListener('click', () => { const overdue = tasks.filter(task => !task.done && task.date && task.date < todayISO()).length; const dueToday = tasks.filter(task => !task.done && task.date === todayISO()).length; const dueTomorrow = new Date(); dueTomorrow.setDate(dueTomorrow.getDate() + 1); const tomorrowCount = tasks.filter(task => !task.done && task.date === todayISO(dueTomorrow)).length; const parts = []; if (overdue) parts.push(`${overdue} vencida${overdue === 1 ? '' : 's'}`); if (dueToday) parts.push(`${dueToday} para hoy`); if (tomorrowCount) parts.push(`${tomorrowCount} para mañana`); notify(parts.length ? `Avisos: ${parts.join(', ')}.` : 'No tienes tareas vencidas ni entregas próximas.'); });
  $('#orden-tareas').addEventListener('change', () => { taskSort = $('#orden-tareas').value; expandedTasks = true; renderTasks(); });
  $('#buscar-tarea').addEventListener('input', renderTasks); $('#filtrar-materia-tarea').addEventListener('change', renderTasks);
  $('#ver-tareas').addEventListener('click', () => { expandedTasks = !expandedTasks; renderTasks(); });
  $$('[data-filtro-tarea]').forEach(button => button.addEventListener('click', () => {
    taskFilter = button.dataset.filtroTarea; expandedTasks = true;
    $$('[data-filtro-tarea]').forEach(item => item.classList.toggle('active', item === button)); renderTasks();
  }));

  // Registro personal de calificaciones por materia.
  function gradeOnTen(grade) { return Number(grade.score) / Number(grade.maximum) * 10; }
  function renderGrades() {
    const filter = $('#filtrar-calificaciones').value;
    const subjects = [...new Set(grades.map(grade => grade.subject || 'Otra'))].sort((a, b) => a.localeCompare(b, 'es'));
    const overview = $('#resumen-calificaciones'); overview.replaceChildren();
    const overall = grades.length ? grades.reduce((sum, grade) => sum + gradeOnTen(grade), 0) / grades.length : null;
    const makeCard = (title, value, detail) => { const card = document.createElement('article'); card.className = 'grade-stat'; const name = document.createElement('span'); name.textContent = title; const number = document.createElement('strong'); number.textContent = value; const note = document.createElement('small'); note.textContent = detail; card.append(name, number, note); overview.append(card); };
    makeCard('Promedio general', overall === null ? '—' : overall.toFixed(2) + ' / 10', `${grades.length} ${grades.length === 1 ? 'evaluación registrada' : 'evaluaciones registradas'}`);
    subjects.forEach(subject => { const values = grades.filter(grade => grade.subject === subject); const average = values.reduce((sum, grade) => sum + gradeOnTen(grade), 0) / values.length; makeCard(subject, average.toFixed(2) + ' / 10', `${values.length} ${values.length === 1 ? 'evaluación' : 'evaluaciones'}`); });
    const chartSelect = $('#materia-grafico'); const selectedChartSubject = chartSelect.value; chartSelect.replaceChildren();
    const allSubjectsOption = document.createElement('option'); allSubjectsOption.value = ''; allSubjectsOption.textContent = 'Todas las materias'; chartSelect.append(allSubjectsOption);
    subjects.forEach(subject => { const option = document.createElement('option'); option.value = subject; option.textContent = subject; chartSelect.append(option); });
    if (subjects.includes(selectedChartSubject)) chartSelect.value = selectedChartSubject;
    const chartGrades = grades.filter(grade => !chartSelect.value || grade.subject === chartSelect.value).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const chart = $('#grafico-calificaciones'); chart.replaceChildren();
    if (chartGrades.length < 2) { const note = document.createElement('p'); note.className = 'summary-empty'; note.textContent = chartGrades.length ? 'Registra otra nota para ver la evolución.' : 'El gráfico aparecerá cuando registres evaluaciones.'; chart.append(note); }
    else {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 520 190'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Evolución de ${chartGrades.length} calificaciones sobre 10`);
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = 'Evolución de calificaciones en el tiempo'; svg.append(title);
      [0, 5, 10].forEach(value => { const y = 154 - value * 12; const line = document.createElementNS(svg.namespaceURI, 'line'); line.setAttribute('x1', '36'); line.setAttribute('x2', '510'); line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y)); line.setAttribute('class', 'chart-grid-line'); svg.append(line); const label = document.createElementNS(svg.namespaceURI, 'text'); label.setAttribute('x', '5'); label.setAttribute('y', String(y + 4)); label.setAttribute('class', 'chart-axis-label'); label.textContent = String(value); svg.append(label); });
      const coords = chartGrades.map((grade, index) => ({ x: 42 + (index * 466 / (chartGrades.length - 1)), y: 154 - Math.max(0, Math.min(10, gradeOnTen(grade))) * 12 }));
      const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', coords.map(point => `${point.x},${point.y}`).join(' ')); line.setAttribute('class', 'grade-chart-line'); svg.append(line);
      coords.forEach((point, index) => { const grade = chartGrades[index]; const scoreClass = gradeOnTen(grade) >= 8 ? 'grade-high' : gradeOnTen(grade) >= 7 ? 'grade-passed' : 'grade-needs-work'; const dot = document.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('cx', String(point.x)); dot.setAttribute('cy', String(point.y)); dot.setAttribute('r', '4'); dot.setAttribute('class', `grade-chart-dot ${scoreClass}`); dot.setAttribute('aria-label', `${grade.title}: ${gradeOnTen(grade).toFixed(1)} sobre 10`); const tip = document.createElementNS(svg.namespaceURI, 'title'); tip.textContent = `${grade.title} · ${gradeOnTen(grade).toFixed(1)} / 10`; dot.append(tip); svg.append(dot); if (index === 0 || index === chartGrades.length - 1) { const dateLabel = document.createElementNS(svg.namespaceURI, 'text'); dateLabel.setAttribute('x', String(point.x)); dateLabel.setAttribute('y', '178'); dateLabel.setAttribute('text-anchor', index === 0 ? 'start' : 'end'); dateLabel.setAttribute('class', 'chart-date-label'); dateLabel.textContent = grade.date ? new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' }).format(new Date(`${grade.date}T12:00:00`)) : ''; svg.append(dateLabel); } });
      chart.append(svg);
    }
    updateNeededGrade();
    const list = $('#lista-calificaciones'); list.replaceChildren();
    const visible = grades.filter(grade => !filter || grade.subject === filter).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'summary-empty'; empty.textContent = grades.length ? 'No hay evaluaciones en esta materia.' : 'Aún no has registrado calificaciones.'; list.append(empty); if (!grades.length) { const action = document.createElement('button'); action.type = 'button'; action.className = 'filter-button empty-action'; action.textContent = 'Registrar mi primera calificación'; action.addEventListener('click', () => $('#nombre-evaluacion').focus()); list.append(action); } }
    visible.forEach(grade => {
      const item = document.createElement('article'); item.className = 'grade-entry';
      const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = grade.title; const meta = document.createElement('small'); meta.textContent = `${grade.subject} · ${new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(new Date(`${grade.date}T12:00:00`))}`; info.append(title, meta);
      const score = document.createElement('strong'); const normalizedScore = gradeOnTen(grade); score.className = `grade-score ${normalizedScore >= 8 ? 'grade-high' : normalizedScore >= 7 ? 'grade-passed' : 'grade-needs-work'}`; score.textContent = `${Number(grade.score)} / ${Number(grade.maximum)}`;
      const actions = document.createElement('div'); actions.className = 'grade-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => { $('#id-calificacion').value = grade.id; $('#nombre-evaluacion').value = grade.title; $('#materia-calificacion').value = grade.subject; $('#apunte-calificacion').value = grade.summaryId || ''; $('#nota-obtenida').value = grade.score; $('#nota-maxima').value = grade.maximum; $('#fecha-evaluacion').value = grade.date; $('#titulo-editor-calificacion').textContent = 'Editar evaluación'; $('#guardar-calificacion').textContent = 'Guardar cambios'; $('#cancelar-calificacion').hidden = false; $('#nombre-evaluacion').focus(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger-button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => { const index = grades.findIndex(record => record.id === grade.id); grades = grades.filter(record => record.id !== grade.id); write('studyhelp-calificaciones', grades); renderGrades(); notify('Calificación eliminada.', () => { grades.splice(index, 0, grade); write('studyhelp-calificaciones', grades); renderGrades(); }); });
      actions.append(edit, remove); item.append(info, score);
      const linkedNote = summaries.find(note => note.id === grade.summaryId);
      if (linkedNote) { const noteButton = document.createElement('button'); noteButton.type = 'button'; noteButton.className = 'task-note-link'; noteButton.textContent = `Apunte relacionado: ${linkedNote.title}`; noteButton.addEventListener('click', () => openSummaryPreview(linkedNote)); item.append(noteButton); }
      item.append(actions); list.append(item);
    });
  }
  function updateNeededGrade() {
    const target = Math.max(0, Math.min(10, Number($('#meta-promedio').value) || 0)); const subject = $('#materia-meta').value;
    const scoped = grades.filter(grade => !subject || grade.subject === subject); const output = $('#nota-necesaria');
    if (!scoped.length) { output.textContent = 'Registra notas para calcular cuánto necesitas.'; return; }
    const total = scoped.reduce((sum, grade) => sum + gradeOnTen(grade), 0); const required = target * (scoped.length + 1) - total;
    if (required <= 0) output.textContent = `Con un 0 en una evaluación más, mantendrías la meta de ${target.toFixed(1)}.`;
    else if (required > 10) output.textContent = `Necesitarías ${required.toFixed(1)} / 10 en una evaluación; una sola nota no alcanza esa meta.`;
    else output.textContent = `Necesitas ${required.toFixed(1)} / 10 en la próxima evaluación para llegar a ${target.toFixed(1)}.`;
  }
  function clearGradeEditor() { $('#form-calificacion').reset(); $('#id-calificacion').value = ''; $('#nota-maxima').value = '10'; $('#fecha-evaluacion').value = todayISO(); $('#titulo-editor-calificacion').textContent = 'Registrar una evaluación'; $('#guardar-calificacion').textContent = 'Guardar calificación'; $('#cancelar-calificacion').hidden = true; }
  $('#form-calificacion').addEventListener('submit', event => { event.preventDefault(); const score = Number($('#nota-obtenida').value); const maximum = Number($('#nota-maxima').value); if (score < 0 || maximum <= 0 || score > maximum) { notify('Revisa las notas: la obtenida no puede superar la nota máxima.'); return; } const id = $('#id-calificacion').value; const values = { title: $('#nombre-evaluacion').value.trim(), subject: $('#materia-calificacion').value, summaryId: $('#apunte-calificacion').value, score, maximum, date: $('#fecha-evaluacion').value }; if (id) { const grade = grades.find(item => item.id === id); if (grade) Object.assign(grade, values); } else grades.unshift({ id: crypto.randomUUID(), ...values, created: new Date().toISOString() }); write('studyhelp-calificaciones', grades); clearGradeEditor(); renderGrades(); notify(id ? 'Calificación actualizada.' : 'Calificación registrada.'); });
  $('#cancelar-calificacion').addEventListener('click', clearGradeEditor); $('#filtrar-calificaciones').addEventListener('change', renderGrades); $('#materia-grafico').addEventListener('change', renderGrades); $('#meta-promedio').addEventListener('input', updateNeededGrade); $('#materia-meta').addEventListener('change', updateNeededGrade);
  $('#fecha-evaluacion').value = todayISO();

  // Agenda semanal.
  function renderAgenda() {
    const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setDate(monday.getDate() + agendaWeekOffset * 7);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const shortDate = date => new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short' }).format(date);
    $('#titulo-semana').textContent = `${shortDate(monday)} – ${shortDate(sunday)}`;
    const grid = $('#agenda-semanal'); grid.replaceChildren();
    ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].forEach((dayName, index) => {
      const day = new Date(monday); day.setDate(monday.getDate() + index); const iso = todayISO(day);
      const column = document.createElement('div'); column.className = `day-column${iso === todayISO() ? ' today-column' : ''}`;
      column.addEventListener('dragover', event => { event.preventDefault(); column.classList.add('day-drop-target'); });
      column.addEventListener('dragleave', () => column.classList.remove('day-drop-target'));
      column.addEventListener('drop', event => { event.preventDefault(); column.classList.remove('day-drop-target'); const taskId = event.dataTransfer.getData('text/plain'); const task = tasks.find(item => item.id === taskId); if (!task) return; task.date = iso; write('studyhelp-tareas', tasks); renderAgenda(); renderTasks(); notify(`Tarea programada para ${new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00`))}.`); });
      const name = document.createElement('span'); name.className = 'day-name'; name.textContent = dayName;
      const number = document.createElement('span'); number.className = 'day-number'; number.textContent = day.getDate(); column.append(name, number);
      const dayTasks = tasks.filter(task => (task.date || task.createdAt?.slice(0, 10)) === iso);
      if (!dayTasks.length) { const empty = document.createElement('span'); empty.className = 'day-empty'; empty.textContent = 'Sin tareas'; column.append(empty); }
      dayTasks.slice(0, 4).forEach(task => { const item = document.createElement('button'); item.type = 'button'; item.draggable = true; item.className = `day-task${task.done ? ' is-done' : ''}`; item.textContent = `${task.done ? '✓ ' : ''}${task.text}`; item.title = `${task.subject || 'Otra materia'} · ${task.done ? 'Completada' : 'Pendiente'} · Arrastra para cambiar el día${task.detail ? ` · ${task.detail}` : ''}`; item.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; }); item.addEventListener('click', () => { showView('tareas'); editTask(task); }); column.append(item); });
      if (dayTasks.length > 4) { const extra = document.createElement('span'); extra.className = 'day-empty'; extra.textContent = `+${dayTasks.length - 4} más`; column.append(extra); }
      const add = document.createElement('button'); add.type = 'button'; add.className = 'day-add'; add.textContent = '+ Agregar'; add.addEventListener('click', () => { showView('tareas'); clearTaskEditor(); $('#fecha-tarea').value = iso; $('#entrada-tarea').focus(); }); column.append(add);
      grid.append(column);
    });
    const weekTasks = tasks.filter(task => { const due = task.date || task.createdAt?.slice(0, 10); return due && due >= todayISO(monday) && due <= todayISO(sunday); });
    const weekSummary = $('#resumen-agenda'); weekSummary.replaceChildren();
    const summaryText = document.createElement('span'); summaryText.textContent = `${weekTasks.filter(task => !task.done).length} pendientes · ${weekTasks.filter(task => task.done).length} completadas esta semana`; weekSummary.append(summaryText);
    if (!weekTasks.length) { const action = document.createElement('button'); action.type = 'button'; action.className = 'text-button'; action.textContent = 'Planificar mi primera tarea →'; action.addEventListener('click', () => { showView('tareas'); clearTaskEditor(); $('#fecha-tarea').value = todayISO(); $('#entrada-tarea').focus(); }); weekSummary.append(action); }
  }
  $('#semana-anterior').addEventListener('click', () => { agendaWeekOffset--; renderAgenda(); });
  $('#semana-siguiente').addEventListener('click', () => { agendaWeekOffset++; renderAgenda(); });
  $('#semana-hoy').addEventListener('click', () => { agendaWeekOffset = 0; renderAgenda(); });

  // Biblioteca, filtros y editor amplio.
  function renderNoteMarkdown(source, container) {
    container.replaceChildren(); let list = null;
    const addInline = (parent, text) => { const pattern = /\*\*(.+?)\*\*/g; let cursor = 0; let match; while ((match = pattern.exec(text))) { parent.append(document.createTextNode(text.slice(cursor, match.index))); const strong = document.createElement('strong'); strong.textContent = match[1]; parent.append(strong); cursor = pattern.lastIndex; } parent.append(document.createTextNode(text.slice(cursor))); };
    (source || '').split(/\r?\n/).forEach(line => {
      if (/^\s*[-*]\s+/.test(line)) { if (!list) { list = document.createElement('ul'); container.append(list); } const item = document.createElement('li'); addInline(item, line.replace(/^\s*[-*]\s+/, '')); list.append(item); return; }
      list = null; if (!line.trim()) return; const paragraph = document.createElement('p'); addInline(paragraph, line); container.append(paragraph);
    });
  }
  function openSummaryPreview(item = null) {
    const note = item || { title: $('#titulo-resumen').value.trim() || 'Vista previa', subject: $('#materia-resumen').value, source: $('#texto-resumen').value };
    $('#preview-title').textContent = note.title || 'Apunte'; $('#preview-subject').textContent = note.subject || 'Otra'; renderNoteMarkdown(note.source || note.summaryText || '', $('#preview-content')); openDialog($('#modal-vista-previa'));
  }
  $('#abrir-vista-previa').addEventListener('click', () => openSummaryPreview()); $('#cerrar-vista-previa').addEventListener('click', () => $('#modal-vista-previa').close());
  function updateWordCount() { const words = $('#texto-resumen').value.trim().split(/\s+/).filter(Boolean).length; $('#contador-palabras').textContent = `${words} ${words === 1 ? 'palabra' : 'palabras'}`; }
  $('#texto-resumen').addEventListener('input', updateWordCount);
  $$('[data-formato]').forEach(button => button.addEventListener('click', () => {
    const area = $('#texto-resumen'); const start = area.selectionStart; const end = area.selectionEnd; const selected = area.value.slice(start, end);
    if (button.dataset.formato === 'negrita') { const value = selected || 'texto'; area.setRangeText(`**${value}**`, start, end, 'select'); }
    else { const value = selected || 'elemento'; const lines = value.split('\n').map(line => `- ${line}`).join('\n'); area.setRangeText(lines, start, end, 'select'); }
    area.focus(); updateWordCount();
  }));
  function renderSummaries() {
    $('#total-resumenes').textContent = summaries.length;
    const query = $('#buscar-resumen').value.trim().toLocaleLowerCase('es'); const subject = $('#filtrar-materia').value;
    const list = $('#lista-resumenes'); list.replaceChildren();
    const matches = summaries.filter(item => `${item.title} ${item.summaryText || ''} ${item.source || ''} ${item.subject || ''}`.toLocaleLowerCase('es').includes(query) && (!subject || (item.subject || 'Otra') === subject) && (!favoritesOnly || item.favorite));
    const summarySort = $('#orden-resumenes').value;
    matches.sort((a, b) => summarySort === 'titulo' ? a.title.localeCompare(b.title, 'es') : summarySort === 'materia' ? (a.subject || 'Otra').localeCompare(b.subject || 'Otra', 'es') : new Date(b.updated || b.created || 0) - new Date(a.updated || a.created || 0));
    $('#cantidad-visible-resumenes').textContent = `(${matches.length} de ${summaries.length})`;
    if (!matches.length) { const empty = document.createElement('div'); empty.className = 'summary-empty'; empty.textContent = summaries.length ? 'No hay apuntes que coincidan con la búsqueda.' : 'Aún no tienes apuntes guardados.'; list.append(empty); }
    matches.forEach(item => {
      const entry = document.createElement('article'); entry.className = `summary-entry note-${item.color || 'azul'}`;
      const title = document.createElement('strong'); title.textContent = item.title;
      const subjectLabel = document.createElement('span'); subjectLabel.className = 'subject-label'; subjectLabel.textContent = item.subject || 'Otra';
      const excerpt = document.createElement('p'); excerpt.textContent = item.summaryText || item.source || '';
      const actions = document.createElement('div'); actions.className = 'summary-entry-actions';
      const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = `favorite-toggle${item.favorite ? ' is-favorite' : ''}`; favorite.textContent = item.favorite ? '★' : '☆'; favorite.setAttribute('aria-label', item.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'); favorite.setAttribute('aria-pressed', String(Boolean(item.favorite)));
      favorite.addEventListener('click', () => { item.favorite = !item.favorite; write('studyhelp-resumenes', summaries); renderSummaries(); });
      const action = document.createElement('button'); action.type = 'button'; action.className = 'text-button'; action.textContent = 'Abrir y editar';
      action.addEventListener('click', () => { $('#id-resumen-editar').value = item.id; $('#titulo-resumen').value = item.title; $('#materia-resumen').value = item.subject || 'Otra'; $('#color-resumen').value = item.color || 'azul'; $('#texto-resumen').value = item.source || ''; updateWordCount(); $('#titulo-editor-resumen').textContent = 'Editar resumen'; $('#cancelar-edicion-resumen').hidden = false; $('#texto-resumen').focus(); });
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'text-button'; preview.textContent = 'Vista previa'; preview.addEventListener('click', () => openSummaryPreview(item));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger-button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => { const index = summaries.findIndex(note => note.id === item.id); summaries = summaries.filter(note => note.id !== item.id); write('studyhelp-resumenes', summaries); renderSummaries(); notify('Apunte eliminado.', () => { summaries.splice(index, 0, item); write('studyhelp-resumenes', summaries); renderSummaries(); }); });
      actions.append(favorite, preview, action, remove); entry.append(title, subjectLabel, excerpt, actions); list.append(entry);
    });
    $('#mensaje-biblioteca').textContent = summaries.length ? `${summaries.length} ${summaries.length === 1 ? 'resumen guardado' : 'resúmenes guardados'} en tu biblioteca.` : 'Tus resúmenes estarán aquí, listos para repasar cuando quieras.';
    refreshSummaryLinks();
    if ($('#lista-tareas')) renderTasks();
    renderStreak();
  }
  $('#buscar-resumen').addEventListener('input', renderSummaries); $('#filtrar-materia').addEventListener('change', renderSummaries); $('#orden-resumenes').addEventListener('change', renderSummaries);
  $('#exportar-resumenes').addEventListener('click', () => {
    if (!summaries.length) { notify('Todavía no tienes apuntes para descargar.'); return; }
    const content = summaries.map(item => `# ${item.title}\nMateria: ${item.subject || 'Otra'}\n\n${item.source || item.summaryText || ''}`).join('\n\n------------------------------\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'mis-apuntes-studyhelp.txt'; link.click(); URL.revokeObjectURL(url); notify('Descargaste tus apuntes.');
  });
  $('#filtrar-favoritos').addEventListener('click', () => { favoritesOnly = !favoritesOnly; $('#filtrar-favoritos').classList.toggle('active', favoritesOnly); $('#filtrar-favoritos').setAttribute('aria-pressed', String(favoritesOnly)); $('#filtrar-favoritos').textContent = favoritesOnly ? '★ Favoritos' : '☆ Favoritos'; renderSummaries(); });
  $('#form-resumen').addEventListener('submit', event => {
    event.preventDefault(); const title = $('#titulo-resumen').value.trim(); const source = $('#texto-resumen').value.trim(); if (!title || !source) return;
    const sentences = source.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
    const summaryText = sentences.length > 3 ? `${sentences.slice(0, 3).join(' ')}…` : source;
    const id = $('#id-resumen-editar').value; const subject = $('#materia-resumen').value; const color = $('#color-resumen').value;
    if (id) { const item = summaries.find(summary => summary.id === id); if (item) Object.assign(item, { title, source, summaryText, subject, color, updated: new Date().toISOString() }); }
    else summaries.unshift({ id: crypto.randomUUID(), title, source, summaryText, subject, color, favorite: false, created: new Date().toISOString() });
    write('studyhelp-resumenes', summaries); $('#form-resumen').reset(); updateWordCount(); $('#id-resumen-editar').value = ''; $('#titulo-editor-resumen').textContent = 'Crear un resumen'; $('#cancelar-edicion-resumen').hidden = true;
    renderSummaries(); notify(id ? 'Cambios guardados.' : 'Resumen guardado en tu biblioteca.');
  });
  $('#cancelar-edicion-resumen').addEventListener('click', () => { $('#form-resumen').reset(); updateWordCount(); $('#id-resumen-editar').value = ''; $('#titulo-editor-resumen').textContent = 'Crear un resumen'; $('#cancelar-edicion-resumen').hidden = true; });

  // Historial local de preguntas.
  function renderQuestions() {
    const list = $('#historial-dudas'); list.replaceChildren();
    $('#total-dudas').textContent = questions.length;
    const query = $('#buscar-duda').value.trim().toLocaleLowerCase('es'); const filter = $('#filtrar-duda').value;
    const visible = questions.filter(item => `${item.question} ${item.answer || ''} ${item.subject || ''}`.toLocaleLowerCase('es').includes(query) && (filter === 'todas' || (filter === 'repasadas' ? item.reviewed : !item.reviewed)));
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'summary-empty'; empty.textContent = questions.length ? 'No hay preguntas con esos filtros.' : 'Todavía no has guardado preguntas.'; list.append(empty); if (!questions.length) { const action = document.createElement('button'); action.type = 'button'; action.className = 'filter-button empty-action'; action.textContent = 'Crear mi primera duda'; action.addEventListener('click', () => { showView('dudas'); $('#pregunta').focus(); }); list.append(action); } return; }
    visible.forEach(item => {
      const entry = document.createElement('article'); entry.className = `question-entry${item.reviewed ? ' question-reviewed' : ''}`;
      const header = document.createElement('div'); header.className = 'question-entry-header';
      const subject = document.createElement('span'); subject.className = 'subject-label'; subject.textContent = item.subject || 'Otra';
      const status = document.createElement('span'); status.className = 'question-status'; status.textContent = item.reviewed ? 'Repasada' : 'Por repasar'; header.append(subject, status);
      const question = document.createElement('p'); question.className = 'question-text'; question.textContent = item.question;
      const answer = document.createElement('p'); answer.className = 'question-answer'; answer.textContent = item.answer || 'Aún no has escrito tu explicación.';
      const date = document.createElement('small'); date.textContent = `Guardada ${new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' }).format(new Date(item.created || Date.now()))}`;
      const actions = document.createElement('div'); actions.className = 'question-actions';
      const reviewed = document.createElement('button'); reviewed.type = 'button'; reviewed.className = 'text-button'; reviewed.textContent = item.reviewed ? 'Marcar por repasar' : 'Marcar repasada'; reviewed.addEventListener('click', () => { item.reviewed = !item.reviewed; item.reviewedAt = item.reviewed ? todayISO() : null; write('studyhelp-dudas', questions); renderQuestions(); });
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => { $('#id-duda-editar').value = item.id; $('#materia-duda').value = item.subject || 'Otra'; $('#pregunta').value = item.question; $('#respuesta-personal').value = item.answer || ''; $('#titulo-editor-duda').textContent = 'Editar pregunta'; $('#guardar-duda').textContent = 'Guardar cambios'; $('#cancelar-edicion-duda').hidden = false; $('#form-duda').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#pregunta').focus(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger-button'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => { const index = questions.findIndex(questionItem => questionItem.id === item.id); questions = questions.filter(questionItem => questionItem.id !== item.id); write('studyhelp-dudas', questions); renderQuestions(); notify('Pregunta eliminada.', () => { questions.splice(index, 0, item); write('studyhelp-dudas', questions); renderQuestions(); }); });
      actions.append(reviewed, edit, remove); entry.append(header, question, answer, date, actions); list.append(entry);
    });
  }
  $('#buscar-duda').addEventListener('input', renderQuestions); $('#filtrar-duda').addEventListener('change', renderQuestions);
  function clearDoubtEditor() { $('#form-duda').reset(); $('#id-duda-editar').value = ''; $('#titulo-editor-duda').textContent = 'Cuaderno de preguntas'; $('#guardar-duda').textContent = 'Guardar en mi cuaderno'; $('#cancelar-edicion-duda').hidden = true; }
  $('#form-duda').addEventListener('submit', event => { event.preventDefault(); const question = $('#pregunta').value.trim(); if (!question) return; const id = $('#id-duda-editar').value; const values = { question, answer: $('#respuesta-personal').value.trim(), subject: $('#materia-duda').value, updated: new Date().toISOString() }; if (id) { const item = questions.find(entry => entry.id === id); if (item) Object.assign(item, values); } else questions.unshift({ id: crypto.randomUUID(), ...values, reviewed: false, created: new Date().toISOString() }); write('studyhelp-dudas', questions); clearDoubtEditor(); renderQuestions(); notify(id ? 'Pregunta actualizada.' : 'Pregunta guardada en tu cuaderno.'); });
  $('#cancelar-edicion-duda').addEventListener('click', clearDoubtEditor);

  // Temporizador Pomodoro persistente entre pestañas del sitio y recargas.
  function paintTimer() { $('#reloj-pomodoro').textContent = `${String(Math.floor(pomodoroSeconds / 60)).padStart(2, '0')}:${String(pomodoroSeconds % 60).padStart(2, '0')}`; }
  function savePomodoro(running = Boolean(pomodoroInterval)) { write('studyhelp-pomodoro', { studyMinutes, breakMinutes, seconds: pomodoroSeconds, isBreak, running, deadline: running ? timerDeadline : null }); }
  function announceTimer(message) {
    if (preferences.sound) { try { const context = timerAudioContext || new (window.AudioContext || window.webkitAudioContext)(); timerAudioContext = context; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 660; gain.gain.value = 0.035; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.35); } catch {} }
    if (preferences.notifications && 'Notification' in window && Notification.permission === 'granted') { try { new Notification('StudyHelp', { body: message, icon: 'app-icon.svg' }); } catch {} }
  }
  function finishTimer() {
    clearInterval(pomodoroInterval); pomodoroInterval = null; timerDeadline = null;
    const endedBreak = isBreak;
    const message = endedBreak ? 'Descanso terminado. Inicia otra sesión cuando quieras.' : `¡Sesión completada! Toma un descanso de ${breakMinutes} minutos.`;
    if (!endedBreak) { sessions.unshift({ id: crypto.randomUUID(), date: todayISO(), minutes: studyMinutes, completedAt: new Date().toISOString() }); write('studyhelp-sesiones', sessions); renderStreak(); }
    announceTimer(message); notify(message); isBreak = !isBreak; pomodoroSeconds = isBreak ? breakMinutes * 60 : studyMinutes * 60;
    $('#modo-pomodoro').textContent = isBreak ? `Descanso · ${breakMinutes} minutos` : `Sesión de estudio · ${studyMinutes} minutos`;
    $('#iniciar-pomodoro').disabled = false; $('#pausar-pomodoro').disabled = true; paintTimer(); savePomodoro(false);
  }
  function startTimer() {
    if (pomodoroInterval) return; timerDeadline = Date.now() + pomodoroSeconds * 1000; savePomodoro(true);
    $('#iniciar-pomodoro').disabled = true; $('#pausar-pomodoro').disabled = false;
    pomodoroInterval = setInterval(() => { pomodoroSeconds = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)); paintTimer(); if (pomodoroSeconds <= 0) finishTimer(); }, 250);
  }
  $('#iniciar-pomodoro').addEventListener('click', startTimer);
  $('#pausar-pomodoro').addEventListener('click', () => { if (timerDeadline) pomodoroSeconds = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)); clearInterval(pomodoroInterval); pomodoroInterval = null; timerDeadline = null; $('#iniciar-pomodoro').disabled = false; $('#pausar-pomodoro').disabled = true; paintTimer(); savePomodoro(false); });
  $('#reiniciar-pomodoro').addEventListener('click', () => { clearInterval(pomodoroInterval); pomodoroInterval = null; timerDeadline = null; isBreak = false; studyMinutes = Math.min(180, Math.max(1, Number($('#duracion-estudio').value) || 25)); breakMinutes = Math.min(60, Math.max(1, Number($('#duracion-descanso').value) || 5)); $('#duracion-estudio').value = studyMinutes; $('#duracion-descanso').value = breakMinutes; pomodoroSeconds = studyMinutes * 60; $('#modo-pomodoro').textContent = `Sesión de estudio · ${studyMinutes} minutos`; $('#iniciar-pomodoro').disabled = false; $('#pausar-pomodoro').disabled = true; paintTimer(); savePomodoro(false); });
  ['duracion-estudio', 'duracion-descanso'].forEach(id => $(`#${id}`).addEventListener('change', () => $('#reiniciar-pomodoro').click()));
  $('#duracion-estudio').value = studyMinutes; $('#duracion-descanso').value = breakMinutes;
  if (savedPomodoro?.running && timerDeadline) { pomodoroSeconds = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)); if (pomodoroSeconds <= 0) finishTimer(); else startTimer(); }
  $('#activar-notificaciones').checked = Boolean(preferences.notifications && 'Notification' in window && Notification.permission === 'granted'); $('#sonido-temporizador').checked = Boolean(preferences.sound);
  $('#activar-notificaciones').addEventListener('change', async event => { if (event.target.checked && 'Notification' in window) { let permission = 'denied'; try { permission = await Notification.requestPermission(); } catch {} if (permission !== 'granted') { event.target.checked = false; preferences.notifications = false; notify('El navegador no autorizó las notificaciones.'); } else preferences.notifications = true; } else if (event.target.checked) { event.target.checked = false; preferences.notifications = false; notify('Este navegador no admite notificaciones.'); } else preferences.notifications = false; write('studyhelp-preferencias', preferences); });
  $('#sonido-temporizador').addEventListener('change', async event => { preferences.sound = event.target.checked; if (preferences.sound) { try { timerAudioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await timerAudioContext.resume(); } catch {} } write('studyhelp-preferencias', preferences); });

  // Búsqueda global por tareas, apuntes y preguntas.
  function renderGlobalSearch() {
    const query = $('#busqueda-global').value.trim().toLocaleLowerCase('es'); const results = $('#resultados-busqueda'); results.replaceChildren();
    if (!query) { const hint = document.createElement('p'); hint.className = 'summary-empty'; hint.textContent = 'Escribe para buscar en tareas, apuntes y dudas.'; results.append(hint); return; }
    const matches = [
      ...tasks.filter(item => `${item.text} ${item.detail || ''} ${item.subject || ''}`.toLocaleLowerCase('es').includes(query)).map(item => ({ kind: 'Tarea', label: item.text, detail: item.subject || 'Organizador', view: 'tareas', item })),
      ...summaries.filter(item => `${item.title} ${item.source || ''} ${item.subject || ''}`.toLocaleLowerCase('es').includes(query)).map(item => ({ kind: 'Apunte', label: item.title, detail: item.subject || 'Biblioteca', view: 'resumenes', item })),
      ...questions.filter(item => `${item.question} ${item.answer || ''} ${item.subject || ''}`.toLocaleLowerCase('es').includes(query)).map(item => ({ kind: 'Duda', label: item.question, detail: item.subject || 'Cuaderno', view: 'dudas', item }))
    ].slice(0, 20);
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'summary-empty'; empty.textContent = 'No encontré resultados.'; results.append(empty); return; }
    matches.forEach(result => { const button = document.createElement('button'); button.type = 'button'; button.className = 'global-result'; const label = document.createElement('strong'); label.textContent = result.label; const meta = document.createElement('small'); meta.textContent = `${result.kind} · ${result.detail}`; button.append(label, meta); button.addEventListener('click', () => { $('#modal-busqueda').close(); showView(result.view); if (result.view === 'tareas') editTask(result.item); else if (result.view === 'resumenes') openSummaryPreview(result.item); else { $('#id-duda-editar').value = result.item.id; $('#materia-duda').value = result.item.subject || 'Otra'; $('#pregunta').value = result.item.question; $('#respuesta-personal').value = result.item.answer || ''; $('#titulo-editor-duda').textContent = 'Editar pregunta'; $('#guardar-duda').textContent = 'Guardar cambios'; $('#cancelar-edicion-duda').hidden = false; } }); results.append(button); });
  }
  function openGlobalSearch() { openDialog($('#modal-busqueda')); $('#busqueda-global').value = ''; renderGlobalSearch(); $('#busqueda-global').focus(); }
  $('#abrir-busqueda').addEventListener('click', openGlobalSearch); $('#cerrar-busqueda').addEventListener('click', () => $('#modal-busqueda').close()); $('#busqueda-global').addEventListener('input', renderGlobalSearch);
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openGlobalSearch(); } });

  // Tutor de IA: las credenciales solo existen en el servidor; el historial queda en este navegador.
  function addAiAnswerToDoubts(question, answer, subject) {
    questions.unshift({ id: crypto.randomUUID(), question, answer, subject: subject === 'General' ? 'Otra' : subject, reviewed: false, created: new Date().toISOString(), source: 'tutor-ia' });
    write('studyhelp-dudas', questions); renderQuestions(); notify('Respuesta guardada en tu cuaderno de dudas.');
  }
  function renderTutorChat() {
    const chat = $('#chat-tutor'); chat.replaceChildren();
    if (!aiConversation.length) { const welcome = document.createElement('div'); welcome.className = 'ai-welcome'; const icon = document.createElement('span'); icon.className = 'ai-avatar'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '✦'; const title = document.createElement('strong'); title.textContent = 'Hola, soy tu tutor de estudio.'; const text = document.createElement('p'); text.textContent = 'Cuéntame qué tema estás estudiando y te ayudaré a entenderlo.'; welcome.append(icon, title, text); chat.append(welcome); return; }
    aiConversation.forEach((message, index) => {
      const article = document.createElement('article'); article.className = `ai-message ${message.role === 'assistant' ? 'ai-response' : 'ai-question'}`;
      const heading = document.createElement('strong'); heading.textContent = message.role === 'assistant' ? 'Tutor IA' : 'Tú';
      const content = document.createElement('div'); content.className = 'ai-message-content';
      if (message.role === 'assistant') renderNoteMarkdown(message.content, content); else content.textContent = message.content;
      article.append(heading, content);
      if (message.role === 'assistant' && index > 0 && aiConversation[index - 1].role === 'user') { const save = document.createElement('button'); save.type = 'button'; save.className = 'text-button'; save.textContent = 'Guardar en mis dudas'; save.addEventListener('click', () => addAiAnswerToDoubts(aiConversation[index - 1].content, message.content, message.subject || aiConversation[index - 1].subject || 'General')); article.append(save); }
      chat.append(article);
    });
    chat.scrollTop = chat.scrollHeight;
  }
  $('#form-tutor').addEventListener('submit', async event => {
    event.preventDefault(); const question = $('#mensaje-tutor').value.trim(); if (!question) return;
    const subject = $('#materia-tutor').value; aiConversation.push({ role: 'user', content: question, subject, created: new Date().toISOString() });
    write('studyhelp-chat-ia', aiConversation); renderTutorChat(); $('#mensaje-tutor').value = ''; $('#enviar-tutor').disabled = true; $('#mensaje-tutor').disabled = true; $('#estado-tutor').textContent = 'El tutor está preparando una explicación…';
    try {
      const response = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, messages: aiConversation.slice(-8).map(({ role, content }) => ({ role, content })) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo obtener una respuesta.');
      aiConversation.push({ role: 'assistant', content: payload.answer, subject, created: new Date().toISOString() }); write('studyhelp-chat-ia', aiConversation); renderTutorChat(); $('#estado-tutor').textContent = '';
    } catch (error) { $('#estado-tutor').textContent = error.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor. Comprueba que StudyHelp esté abierto desde localhost y vuelve a intentar.' : error.message; }
    finally { $('#enviar-tutor').disabled = false; $('#mensaje-tutor').disabled = false; $('#mensaje-tutor').focus(); }
  });
  $$('[data-pregunta-sugerida]').forEach(button => button.addEventListener('click', () => { $('#mensaje-tutor').value = button.dataset.preguntaSugerida; $('#mensaje-tutor').focus(); $('#mensaje-tutor').setSelectionRange($('#mensaje-tutor').value.length, $('#mensaje-tutor').value.length); }));
  $('#limpiar-chat').addEventListener('click', () => { if (!aiConversation.length || !window.confirm('¿Borrar esta conversación de este navegador?')) return; aiConversation = []; write('studyhelp-chat-ia', aiConversation); renderTutorChat(); $('#estado-tutor').textContent = ''; });
  async function checkTutorConfiguration() {
    try { const response = await fetch('/api/tutor/status'); const status = await response.json(); const message = status.configured ? `Tutor IA local listo (${status.model}). Puedes enviar tu pregunta.` : status.ollamaRunning ? `Ollama está activo, pero falta descargar ${status.model}. Abre PowerShell y ejecuta: ollama run ${status.model}` : 'Para usar el Tutor IA sin pagar ni crear claves, instala Ollama y sigue los pasos de CONFIGURAR-IA.md.'; $('#estado-configuracion-ia').textContent = status.configured ? message : status.provider === 'openai' ? 'Falta configurar la clave de OpenAI en el servidor. Sigue CONFIGURAR-IA.md y no pegues la clave aquí.' : message; $('#estado-configuracion-ia').classList.toggle('ai-ready', Boolean(status.configured)); }
    catch { $('#estado-configuracion-ia').textContent = 'No se pudo conectar con el servidor de StudyHelp. Abre la página desde localhost y reinicia el servidor si acabas de configurarlo.'; }
  }
  checkTutorConfiguration();

  // Tarjetas de repaso a partir de las dudas guardadas por el estudiante.
  let cardIndex = 0; let cardAnswerVisible = false;
  function renderFlashcard() { if (!questions.length) return; const item = questions[cardIndex % questions.length]; $('#contador-tarjeta').textContent = `Tarjeta ${cardIndex + 1} de ${questions.length} · ${item.subject || 'Otra materia'}`; $('#tarjeta-repaso').textContent = cardAnswerVisible ? (item.answer || 'No escribiste una respuesta todavía. Piensa en la explicación y añádela al editar la duda.') : item.question; $('#tarjeta-voltear').textContent = cardAnswerVisible ? 'Ver pregunta' : 'Ver respuesta'; $('#tarjeta-repasada').textContent = item.reviewed ? 'Ya repasada ✓' : 'Marcar repasada'; }
  $('#iniciar-tarjetas').addEventListener('click', () => { if (!questions.length) { notify('Primero guarda una duda para crear tarjetas.'); return; } cardIndex = 0; cardAnswerVisible = false; renderFlashcard(); openDialog($('#modal-tarjetas')); });
  $('#cerrar-tarjetas').addEventListener('click', () => $('#modal-tarjetas').close()); $('#tarjeta-repaso').addEventListener('click', () => { cardAnswerVisible = !cardAnswerVisible; renderFlashcard(); }); $('#tarjeta-voltear').addEventListener('click', () => { cardAnswerVisible = !cardAnswerVisible; renderFlashcard(); });
  $('#tarjeta-anterior').addEventListener('click', () => { cardIndex = (cardIndex - 1 + questions.length) % questions.length; cardAnswerVisible = false; renderFlashcard(); }); $('#tarjeta-siguiente').addEventListener('click', () => { cardIndex = (cardIndex + 1) % questions.length; cardAnswerVisible = false; renderFlashcard(); });
  $('#tarjeta-repasada').addEventListener('click', () => { if (!questions.length) return; const item = questions[cardIndex % questions.length]; item.reviewed = true; item.reviewedAt = todayISO(); write('studyhelp-dudas', questions); renderQuestions(); cardIndex = (cardIndex + 1) % questions.length; cardAnswerVisible = false; renderFlashcard(); });

  // Tutorial breve para la primera visita.
  const tutorialSteps = [
    ['Organiza tu semana', 'Crea tareas con fecha, prioridad y materia. La agenda te ayuda a ver qué sigue.'],
    ['Guarda lo que aprendes', 'Crea apuntes y dudas, relaciónalos con tus evaluaciones y consulta al Tutor IA para entender mejor tus temas.'],
    ['Estudia a tu ritmo', 'Usa el Pomodoro, registra tus calificaciones y descarga una copia de seguridad desde tu perfil.']
  ];
  let tutorialIndex = 0;
  function paintTutorial() { const step = tutorialSteps[tutorialIndex]; $('#tutorial-titulo').textContent = step[0]; $('#tutorial-texto').textContent = step[1]; $('#tutorial-paso').textContent = `Paso ${tutorialIndex + 1} de ${tutorialSteps.length}`; $('#siguiente-tutorial').textContent = tutorialIndex === tutorialSteps.length - 1 ? 'Empezar' : 'Siguiente'; }
  function finishTutorial() { localStorage.setItem('studyhelp-tutorial', 'v1'); $('#modal-tutorial').close(); }
  $('#siguiente-tutorial').addEventListener('click', () => { if (tutorialIndex < tutorialSteps.length - 1) { tutorialIndex++; paintTutorial(); } else finishTutorial(); }); $('#saltar-tutorial').addEventListener('click', finishTutorial); $('#cerrar-tutorial').addEventListener('click', finishTutorial);

  // Recupera borradores de formulario si el estudiante recarga o cierra la pestaña.
  function initDraftAutosave() {
    const primaryDraftFields = { 'form-tarea': ['entrada-tarea', 'detalle-tarea'], 'form-resumen': ['titulo-resumen', 'texto-resumen'], 'form-duda': ['pregunta', 'respuesta-personal'], 'form-calificacion': ['nombre-evaluacion', 'nota-obtenida'] };
    ['form-tarea', 'form-resumen', 'form-duda', 'form-calificacion'].forEach(formId => {
      const form = $(`#${formId}`); const editId = form.querySelector('input[type="hidden"]'); const key = `studyhelp-borrador-${formId}`;
      if (!editId?.value) {
        try { const savedDraft = JSON.parse(localStorage.getItem(key) || 'null'); if (savedDraft) Object.entries(savedDraft).forEach(([id, value]) => { const field = document.getElementById(id); if (field && field.form === form && field.type !== 'file') field.value = value; }); } catch { localStorage.removeItem(key); }
      }
      let draftTimer;
      const saveDraft = () => {
        if (editId?.value) return;
        clearTimeout(draftTimer); draftTimer = setTimeout(() => {
          const fields = [...form.querySelectorAll('input:not([type="hidden"]):not([type="file"]),textarea,select')]; const draft = Object.fromEntries(fields.map(field => [field.id, field.value]));
          const hasContent = primaryDraftFields[formId].some(id => document.getElementById(id).value.trim());
          if (hasContent) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key);
        }, 250);
      };
      form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);
      form.addEventListener('submit', () => setTimeout(() => { const hasContent = primaryDraftFields[formId].some(id => document.getElementById(id).value.trim()); if (!hasContent) localStorage.removeItem(key); else saveDraft(); }, 0));
      form.addEventListener('reset', () => setTimeout(() => localStorage.removeItem(key), 0));
    });
  }
  initDraftAutosave();

  const dateLabel = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#fecha-hoy').textContent = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  paintTimer(); renderTasks(); renderSummaries(); renderAgenda(); renderQuestions(); renderGrades(); updateWordCount(); renderTutorChat();
  if (!read('studyhelp-tutorial', null)) { paintTutorial(); openDialog($('#modal-tutorial')); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
})();

