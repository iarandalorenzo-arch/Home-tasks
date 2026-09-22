import { getAll, put, putMany, remove, clearStore, resetDatabase } from './db.js';

const APP_VERSION = '5.0.0';
const SYNCABLE_STORES = ['rooms', 'users', 'tasks', 'history', 'templates'];
const LS_SYNC_PROVIDER = 'hometasks-sync-provider';
const LS_SYNC_ENDPOINT = 'hometasks-appsscript-endpoint';
const LS_SYNC_HOUSE_KEY = 'hometasks-appsscript-house-key';
const LS_CLOUD_LINKED = 'hometasks-sync-linked';
const LS_LAST_SYNC = 'hometasks-sync-last-sync';
const LS_AUTO_SYNC = 'hometasks-sync-auto';
const LS_CLOUD_DIRTY = 'hometasks-sync-dirty';
const LS_DEVICE_ID = 'hometasks-device-id';
const LS_LAST_SYNC_ATTEMPT = 'hometasks-sync-last-attempt';
const LS_LAST_SYNC_RESULT = 'hometasks-sync-last-result';
const LS_LOCAL_REVISION = 'hometasks-local-revision';


const makeId = () => (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
  ? globalThis.crypto.randomUUID()
  : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const localISO = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const todayISO = () => localISO(new Date());
const addDaysISO = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localISO(d);
};


const isoDate = value => new Date(`${value}T12:00:00`);
const addDaysToDate = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
const mondayOfWeek = (date = new Date()) => {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
};
const weekStartForOffset = offset => addDaysToDate(mondayOfWeek(new Date()), offset * 7);

const defaultRooms = [
  { id: 'entry', name: 'Recibidor', order: 1 },
  { id: 'kitchen', name: 'Cocina', order: 2 },
  { id: 'balcony', name: 'Balcón', order: 3 },
  { id: 'bath2', name: 'Baño 2', order: 4 },
  { id: 'lucia', name: 'Dormitorio Lucía', order: 5 },
  { id: 'living', name: 'Salón', order: 6 },
  { id: 'hall', name: 'Pasillo', order: 7 },
  { id: 'pablo', name: 'Dormitorio Pablo', order: 8 },
  { id: 'bath1', name: 'Baño 1', order: 9 },
  { id: 'master', name: 'Dormitorio principal', order: 10 },
];

function normalizeRooms(items = []) {
  const byId = new Map((Array.isArray(items) ? items : []).filter(item => item && item.id).map(item => [item.id, item]));
  return defaultRooms.map(def => {
    const existing = byId.get(def.id);
    return existing ? { ...def, ...existing, id: def.id, order: def.order } : { ...def };
  });
}

const floorLayout = [
  { id: 'entry', type: 'rect', x: 35, y: 40, w: 175, h: 170, labelX: 122, labelY: 116, bubbleX: 122, bubbleY: 158, base: 'room-base-a' },
  { id: 'kitchen', type: 'rect', x: 220, y: 40, w: 380, h: 290, labelX: 410, labelY: 160, bubbleX: 410, bubbleY: 205, base: 'room-base-b' },
  { id: 'balcony', type: 'rect', x: 610, y: 40, w: 145, h: 145, labelX: 682, labelY: 98, bubbleX: 682, bubbleY: 140, base: 'room-base-c', labelSize: 'small' },
  { id: 'bath2', type: 'rect', x: 610, y: 185, w: 145, h: 145, labelX: 682, labelY: 238, bubbleX: 682, bubbleY: 280, base: 'room-base-c', labelSize: 'small' },
  { id: 'lucia', type: 'rect', x: 770, y: 185, w: 240, h: 220, labelX: 890, labelY: 270, bubbleX: 890, bubbleY: 316, base: 'room-base-a', labelSize: 'small' },
  { id: 'living', type: 'path', d: 'M35 225 H210 V340 H435 V690 H35 Z', labelX: 235, labelY: 430, bubbleX: 235, bubbleY: 480, base: 'room-base-a' },
  { id: 'hall', type: 'rect', x: 445, y: 340, w: 310, h: 100, labelX: 600, labelY: 385, bubbleX: 600, bubbleY: 420, base: 'room-base-neutral' },
  { id: 'pablo', type: 'rect', x: 445, y: 450, w: 270, h: 240, labelX: 580, labelY: 555, bubbleX: 580, bubbleY: 603, base: 'room-base-d', labelSize: 'small' },
  { id: 'bath1', type: 'rect', x: 770, y: 415, w: 240, h: 120, labelX: 890, labelY: 458, bubbleX: 890, bubbleY: 496, base: 'room-base-c', labelSize: 'small' },
  { id: 'master', type: 'rect', x: 770, y: 545, w: 240, h: 145, labelX: 890, labelY: 610, bubbleX: 890, bubbleY: 652, base: 'room-base-e', labelSize: 'small' },
];

const legacyRoomMap = {
  kitchen: 'kitchen',
  living: 'living',
  bathroom: 'bath2',
  hall: 'hall',
  bedroom: 'master',
};


const defaultTemplates = [
  { id: 'tpl-kitchen-dishwasher-start', title: 'Poner lavavajillas', roomId: 'kitchen', recurrence: 'none', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-kitchen-dishwasher-empty', title: 'Vaciar lavavajillas', roomId: 'kitchen', recurrence: 'none', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-kitchen-clean', title: 'Limpiar cocina', roomId: 'kitchen', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-kitchen-pots', title: 'Fregar cazuelas', roomId: 'kitchen', recurrence: 'none', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-kitchen-cook', title: 'Hacer la comida', roomId: 'kitchen', recurrence: 'daily', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-living-vacuum', title: 'Aspirar salón', roomId: 'living', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-living-dust', title: 'Quitar polvo', roomId: 'living', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-entry-clean', title: 'Limpiar recibidor', roomId: 'entry', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-hall-vacuum', title: 'Aspirar pasillo', roomId: 'hall', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-balcony-sweep', title: 'Barrer balcón', roomId: 'balcony', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-bath1-clean', title: 'Limpiar Baño 1', roomId: 'bath1', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-bath1-towels', title: 'Cambiar toallas', roomId: 'bath1', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-bath2-clean', title: 'Limpiar Baño 2', roomId: 'bath2', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-bath2-towels', title: 'Cambiar toallas', roomId: 'bath2', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-lucia-sheets', title: 'Cambiar sábanas', roomId: 'lucia', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-lucia-vacuum', title: 'Aspirar dormitorio', roomId: 'lucia', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-pablo-sheets', title: 'Cambiar sábanas', roomId: 'pablo', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-pablo-vacuum', title: 'Aspirar dormitorio', roomId: 'pablo', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-master-sheets', title: 'Cambiar sábanas', roomId: 'master', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
  { id: 'tpl-master-vacuum', title: 'Aspirar dormitorio', roomId: 'master', recurrence: 'weekly', recurrenceDays: null, priority: 'normal' },
].map((item, index) => ({ ...item, assigneeId: null, createdAt: index + 1 }));

const recurrenceLabels = {
  none: 'Sin repetición',
  daily: 'Diaria',
  weekly: 'Semanal',
  monthly: 'Mensual',
  custom: 'Personalizada',
};

function recurrenceText(item) {
  const type = item?.recurrence || 'none';
  if (type === 'custom') return `Cada ${Math.max(2, Number(item.recurrenceDays) || 2)} días`;
  return recurrenceLabels[type] || recurrenceLabels.none;
}

function addMonthsClamped(date, months = 1) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function nextRecurrenceDate(task) {
  const type = task.recurrence || 'none';
  if (type === 'none') return '';
  let date = new Date(`${task.dueDate || todayISO()}T12:00:00`);
  const today = new Date(`${todayISO()}T12:00:00`);
  const advance = () => {
    if (type === 'monthly') {
      date = addMonthsClamped(date, 1);
    } else {
      const days = type === 'daily' ? 1 : type === 'weekly' ? 7 : Math.max(2, Number(task.recurrenceDays) || 2);
      date.setDate(date.getDate() + days);
    }
  };
  do { advance(); } while (date <= today);
  return localISO(date);
}

const freshDemoTasks = () => [
  { id: makeId(), title: 'Poner lavavajillas', roomId: 'kitchen', assigneeId: null, dueDate: todayISO(), priority: 'normal', completed: false, createdAt: Date.now() - 280000 },
  { id: makeId(), title: 'Limpiar cocina', roomId: 'kitchen', assigneeId: null, dueDate: todayISO(), priority: 'normal', completed: false, createdAt: Date.now() - 240000 },
  { id: makeId(), title: 'Fregar cazuelas', roomId: 'kitchen', assigneeId: null, dueDate: addDaysISO(1), priority: 'normal', completed: false, createdAt: Date.now() - 220000 },
  { id: makeId(), title: 'Aspirar', roomId: 'living', assigneeId: null, dueDate: addDaysISO(1), priority: 'normal', completed: false, createdAt: Date.now() - 180000 },
  { id: makeId(), title: 'Limpiar lavabo', roomId: 'bath2', assigneeId: null, dueDate: addDaysISO(-1), priority: 'high', completed: false, createdAt: Date.now() - 150000 },
  { id: makeId(), title: 'Cambiar sábanas', roomId: 'master', assigneeId: null, dueDate: addDaysISO(3), priority: 'normal', completed: false, createdAt: Date.now() - 120000 },
  { id: makeId(), title: 'Recoger ropa', roomId: 'lucia', assigneeId: null, dueDate: addDaysISO(2), priority: 'normal', completed: false, createdAt: Date.now() - 90000 },
  { id: makeId(), title: 'Ordenar escritorio', roomId: 'pablo', assigneeId: null, dueDate: addDaysISO(2), priority: 'normal', completed: false, createdAt: Date.now() - 70000 },
].map(task => ({ ...task, recurrence: 'none', recurrenceDays: null }));

const state = {
  rooms: [],
  users: [],
  tasks: [],
  history: [],
  settings: [],
  templates: [],
  view: 'today',
  editingTaskId: null,
  editingRoutineId: null,
  planWeekOffset: 0,
  syncStatus: null,
  syncBusy: false,
  syncTimer: null,
  syncProgress: { visible: false, active: false, percent: 0, label: '', detail: '', state: 'idle' },
  syncProgressHideTimer: null,
  syncError: '',
  installPrompt: null,
};

const els = {};

function cacheElements() {
  [
    'connectionBadge','syncHeaderBadge','pendingCount','overdueCount','todayCount','completedTodayCount','nextTask','floorPlan','roomSummary','houseNameDisplay','clearRoomFilterButton',
    'roomFilter','statusFilter','assigneeFilter','taskSearch','taskList','activeRoomHint','newTaskButton',
    'todayDateLabel','todayAssigneeFilter','todayNewTaskButton','todayOpenPlanButton','todayDashboardPending','todayDashboardOverdue','todayDashboardDone','todayDashboardUnassigned','todayTaskList','todayOverdueList','todayTomorrowList','todayRecentHistory',
    'historyUserFilter','historyRoomFilter','historyList',
    'routineRoomFilter','routineSearch','routineList','newRoutineButton','templateCount','activeRoutineCount',
    'planPrevWeek','planTodayWeek','planNextWeek','planWeekLabel','planAssigneeFilter','weeklyPlanner','planBacklog','workloadSummary',
    'houseNameInput','saveHouseNameButton','addUserForm','newUserName','userList','roomSettingsList','saveRoomNamesButton',
    'taskDialog','taskForm','taskDialogEyebrow','taskDialogTitle','taskTitle','taskRoom','taskAssignee','taskDueDate','taskPriority','taskRecurrence','taskRecurrenceDays','taskRecurrenceDaysWrap','saveTaskButton','closeDialogButton','cancelDialogButton',
    'routineDialog','routineForm','routineDialogEyebrow','routineDialogTitle','routineTitle','routineRoom','routineAssignee','routinePriority','routineRecurrence','routineRecurrenceDays','routineRecurrenceDaysWrap','closeRoutineDialogButton','cancelRoutineDialogButton',
    'resetButton','themeButton','toast','offlineReady','installButton','installHelp','forceAppUpdateButton','appVersionDisplay','lastForcedUpdate','syncSettingsCard',
    'syncStateSummary','syncStatusPill','syncEndpoint','syncHouseKey','generateSyncKeyButton','saveSyncConfigButton','testSyncButton','syncConnectedPanel','syncCloudStatus','syncLastSync','syncLastAttempt','syncLastResult','syncDeviceId','createCloudButton','adoptCloudButton','syncNowButton','unlinkCloudButton','autoSyncToggle','syncHelpText','syncProgress','syncProgressBar','syncProgressLabel','syncProgressPercent','syncProgressDetail','exportBackupButton','importBackupButton','importBackupFile'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function settingValue(id, fallback = '') {
  return state.settings.find(item => item.id === id)?.value ?? fallback;
}

function roomById(id) {
  return state.rooms.find(room => room.id === id);
}

function userById(id) {
  return state.users.find(user => user.id === id);
}

function userName(id, fallback = 'Sin asignar') {
  if (!id) return fallback || 'Sin asignar';
  return userById(id)?.name || fallback || 'Usuario eliminado';
}

function isOverdue(task) {
  return !task.completed && task.dueDate && task.dueDate < todayISO();
}

function roomStats(roomId) {
  const pending = state.tasks.filter(task => task.roomId === roomId && !task.completed);
  return { count: pending.length, overdue: pending.some(isOverdue) };
}

async function ensureV1Data() {
  const settings = await getAll('settings');
  const isInitialized = settings.some(item => item.id === 'v1-initialized' && item.value === true);
  const structureMigrated = settings.some(item => item.id === 'v1-structure-102' && item.value === true);

  const [existingRooms, existingTasks, existingHistory, existingUsers] = await Promise.all([
    getAll('rooms'), getAll('tasks'), getAll('history'), getAll('users')
  ]);

  const users = [...existingUsers];
  const findOrCreateUser = name => {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName === 'Sin asignar') return null;
    let user = users.find(item => item.name.toLocaleLowerCase('es') === cleanName.toLocaleLowerCase('es'));
    if (!user) {
      user = { id: `user-${slugify(cleanName) || makeId()}`, name: cleanName, createdAt: Date.now() };
      if (users.some(item => item.id === user.id)) user.id = makeId();
      users.push(user);
    }
    return user;
  };

  const mappedTasks = existingTasks.map(task => {
    const legacyUser = findOrCreateUser(task.assignee);
    return {
      ...task,
      roomId: legacyRoomMap[task.roomId] || task.roomId,
      assigneeId: task.assigneeId || legacyUser?.id || null,
      assigneeName: task.assigneeName || (legacyUser ? legacyUser.name : undefined),
    };
  });

  const mappedHistory = existingHistory.map(item => {
    const legacyUser = findOrCreateUser(item.assignee);
    const mappedRoomId = legacyRoomMap[item.roomId] || item.roomId;
    const mappedRoomName = defaultRooms.find(room => room.id === mappedRoomId)?.name || item.roomName;
    return {
      ...item,
      roomId: mappedRoomId,
      roomName: mappedRoomName,
      assigneeId: item.assigneeId || legacyUser?.id || null,
      assigneeName: item.assigneeName || (legacyUser ? legacyUser.name : item.assignee || 'Sin asignar'),
    };
  });

  if (!isInitialized) {
    await clearStore('rooms');
    await putMany('rooms', defaultRooms);
    await putMany('users', users);

    if (mappedTasks.length) {
      await putMany('tasks', mappedTasks);
    } else {
      await putMany('tasks', freshDemoTasks());
    }
    if (mappedHistory.length) await putMany('history', mappedHistory);
    if (!settings.some(item => item.id === 'houseName')) await put('settings', { id: 'houseName', value: 'Mi casa' });
    await put('settings', { id: 'v1-initialized', value: true });
    await put('settings', { id: 'v1-structure-102', value: true });
    await put('settings', { id: 'appVersion', value: APP_VERSION });
    if (existingRooms.length && !existingRooms.some(room => defaultRooms.some(def => def.id === room.id))) {
      console.info('HomeTasks V1: estancias de V0 sustituidas por el plano real.');
    }
    return;
  }

  if (!structureMigrated) {
    const mergedRooms = defaultRooms.map(def => {
      const existing = existingRooms.find(room => room.id === def.id);
      return existing ? { ...def, name: existing.name || def.name } : def;
    });
    await clearStore('rooms');
    await putMany('rooms', mergedRooms);
    if (users.length !== existingUsers.length) await putMany('users', users);
    await put('settings', { id: 'v1-structure-102', value: true });
  }

  await put('settings', { id: 'appVersion', value: APP_VERSION });
}

async function ensureV2Data() {
  const settings = await getAll('settings');
  if (!settings.some(item => item.id === 'v2-initialized' && item.value === true)) {
    const templates = await getAll('templates');
    if (!templates.length) await putMany('templates', defaultTemplates);
    await put('settings', { id: 'v2-initialized', value: true });
  }
  await put('settings', { id: 'appVersion', value: APP_VERSION });
}


async function ensureV3Data() {
  const settings = await getAll('settings');
  if (!settings.some(item => item.id === 'v3-initialized' && item.value === true)) {
    await put('settings', { id: 'v3-initialized', value: true });
  }
  await put('settings', { id: 'appVersion', value: APP_VERSION });
}

async function ensureV4Data() {
  const settings = await getAll('settings');
  if (!settings.some(item => item.id === 'v4-initialized' && item.value === true)) {
    if (!settings.some(item => item.id === 'homeId')) {
      await put('settings', { id: 'homeId', value: makeId(), modifiedAt: Date.now() });
    }
    await put('settings', { id: 'v4-initialized', value: true });
  }
  await put('settings', { id: 'appVersion', value: APP_VERSION });
}

async function ensureV41Data() {
  const settings = await getAll('settings');
  if (!settings.some(item => item.id === 'v41-initialized' && item.value === true)) {
    await put('settings', { id: 'v41-initialized', value: true });
  }
  await put('settings', { id: 'appVersion', value: APP_VERSION });
}

async function loadState() {
  [state.rooms, state.users, state.tasks, state.history, state.settings, state.templates] = await Promise.all([
    getAll('rooms'), getAll('users'), getAll('tasks'), getAll('history'), getAll('settings'), getAll('templates')
  ]);

  // Las estancias forman parte de la estructura fija de la vivienda. Si una
  // sincronización antigua/incompleta deja el store vacío o sin alguna estancia,
  // lo autorreparamos sin perder nombres personalizados existentes.
  const normalizedRooms = normalizeRooms(state.rooms);
  const roomStructureNeedsRepair = state.rooms.length !== normalizedRooms.length ||
    normalizedRooms.some(room => !state.rooms.some(existing => existing.id === room.id));
  state.rooms = normalizedRooms;
  if (roomStructureNeedsRepair) await putMany('rooms', normalizedRooms);

  state.rooms.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  state.users.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  state.tasks = state.tasks.map(task => ({ recurrence: 'none', recurrenceDays: null, ...task }));
  state.tasks.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.createdAt - a.createdAt);
  state.history.sort((a, b) => b.completedAt - a.completedAt);
  state.templates = state.templates.map(template => ({ recurrence: 'none', recurrenceDays: null, priority: 'normal', assigneeId: null, ...template }));
  state.templates.sort((a, b) => (roomById(a.roomId)?.order ?? 999) - (roomById(b.roomId)?.order ?? 999) || a.title.localeCompare(b.title, 'es'));
}

function renderShape(layout, extraClass = '') {
  if (layout.type === 'path') return `<path class="${extraClass}" d="${layout.d}" />`;
  return `<rect class="${extraClass}" x="${layout.x}" y="${layout.y}" width="${layout.w}" height="${layout.h}" rx="8" />`;
}

function labelMarkup(room, layout) {
  const name = escapeHTML(room.name);
  const size = layout.labelSize ? ` ${layout.labelSize}` : '';
  const words = room.name.split(' ');
  if (room.name.length <= 16) {
    return `<text class="floor-label${size}" x="${layout.labelX}" y="${layout.labelY}" text-anchor="middle">${name}</text>`;
  }
  const splitAt = Math.ceil(words.length / 2);
  const line1 = escapeHTML(words.slice(0, splitAt).join(' '));
  const line2 = escapeHTML(words.slice(splitAt).join(' '));
  return `<text class="floor-label${size}" x="${layout.labelX}" y="${layout.labelY - 10}" text-anchor="middle"><tspan x="${layout.labelX}">${line1}</tspan><tspan x="${layout.labelX}" dy="21">${line2}</tspan></text>`;
}

function renderFloorPlan() {
  const roomsMarkup = floorLayout.map(layout => {
    const room = roomById(layout.id) || defaultRooms.find(item => item.id === layout.id);
    if (!room) return '';
    const stats = roomStats(room.id);
    const stateClass = stats.overdue ? 'room-state-overdue' : stats.count > 0 ? 'room-state-pending' : 'room-state-ok';
    const statusText = stats.count === 0 ? 'al dia' : `${stats.count} pendiente${stats.count === 1 ? '' : 's'}`;
    return `
      <g class="floor-room ${stateClass}" data-room-id="${room.id}" role="button" tabindex="0" aria-label="${escapeHTML(room.name)}: ${statusText}">
        ${renderShape(layout, `room-shape ${layout.base}`)}
        ${renderShape(layout, 'room-overlay')}
        ${labelMarkup(room, layout)}
        <circle class="count-bubble" cx="${layout.bubbleX}" cy="${layout.bubbleY}" r="19"></circle>
        <text class="count-number" x="${layout.bubbleX}" y="${layout.bubbleY}">${stats.count}</text>
      </g>`;
  }).join('');

  els.floorPlan.innerHTML = `
    <svg viewBox="0 0 1045 725" role="img" aria-label="Plano simplificado de la vivienda">
      ${roomsMarkup}
      <text class="floor-caption" x="522" y="715">Plano simplificado · HomeTasks V3</text>
    </svg>`;

  els.floorPlan.querySelectorAll('.floor-room').forEach(roomEl => {
    const openRoom = () => openRoomTasks(roomEl.dataset.roomId);
    roomEl.addEventListener('click', openRoom);
    roomEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRoom();
      }
    });
  });
}

function openRoomTasks(roomId) {
  els.roomFilter.value = roomId;
  els.statusFilter.value = 'pending';
  els.assigneeFilter.value = 'all';
  switchView('tasks');
  renderTasks();
  renderActiveRoomHint();
}

function renderRoomSummary() {
  els.roomSummary.innerHTML = state.rooms.map(room => {
    const stats = roomStats(room.id);
    const status = stats.overdue ? 'overdue' : stats.count > 0 ? 'pending' : 'ok';
    return `<button class="room-summary-row" type="button" data-room-id="${room.id}"><span>${escapeHTML(room.name)}</span><b class="room-summary-count ${status}">${stats.count}</b></button>`;
  }).join('');
  els.roomSummary.querySelectorAll('.room-summary-row').forEach(button => button.addEventListener('click', () => openRoomTasks(button.dataset.roomId)));
}

function optionMarkup(items, getValue, getLabel) {
  return items.map(item => `<option value="${escapeHTML(getValue(item))}">${escapeHTML(getLabel(item))}</option>`).join('');
}

function renderFilters() {
  const selectedRoom = els.roomFilter.value || 'all';
  const selectedAssignee = els.assigneeFilter.value || 'all';
  const selectedHistoryRoom = els.historyRoomFilter.value || 'all';
  const selectedHistoryUser = els.historyUserFilter.value || 'all';
  const selectedTaskRoom = els.taskRoom.value;
  const selectedTaskAssignee = els.taskAssignee.value;
  const selectedRoutineRoomFilter = els.routineRoomFilter.value || 'all';
  const selectedRoutineRoom = els.routineRoom.value;
  const selectedRoutineAssignee = els.routineAssignee.value;
  const selectedPlanAssignee = els.planAssigneeFilter.value || 'all';
  const selectedTodayAssignee = els.todayAssigneeFilter?.value || 'all';

  const roomOptions = optionMarkup(normalizeRooms(state.rooms), room => room.id, room => room.name);
  const userOptions = optionMarkup(state.users, user => user.id, user => user.name);

  els.roomFilter.innerHTML = `<option value="all">Todas</option>${roomOptions}`;
  els.historyRoomFilter.innerHTML = `<option value="all">Todas</option>${roomOptions}`;
  els.routineRoomFilter.innerHTML = `<option value="all">Todas</option>${roomOptions}`;
  els.taskRoom.innerHTML = roomOptions;
  els.routineRoom.innerHTML = roomOptions;

  els.assigneeFilter.innerHTML = `<option value="all">Todos</option><option value="unassigned">Sin asignar</option>${userOptions}`;
  els.planAssigneeFilter.innerHTML = `<option value="all">Todas</option><option value="unassigned">Sin asignar</option>${userOptions}`;
  if (els.todayAssigneeFilter) els.todayAssigneeFilter.innerHTML = `<option value="all">Toda la casa</option><option value="unassigned">Sin asignar</option>${userOptions}`;
  els.historyUserFilter.innerHTML = `<option value="all">Todas</option><option value="unassigned">Sin asignar</option>${userOptions}`;
  els.taskAssignee.innerHTML = `<option value="">Sin asignar</option>${userOptions}`;
  els.routineAssignee.innerHTML = `<option value="">Sin asignar</option>${userOptions}`;

  setSelectValueIfPresent(els.roomFilter, selectedRoom);
  setSelectValueIfPresent(els.assigneeFilter, selectedAssignee);
  setSelectValueIfPresent(els.historyRoomFilter, selectedHistoryRoom);
  setSelectValueIfPresent(els.historyUserFilter, selectedHistoryUser);
  setSelectValueIfPresent(els.taskRoom, selectedTaskRoom);
  setSelectValueIfPresent(els.taskAssignee, selectedTaskAssignee);
  setSelectValueIfPresent(els.routineRoomFilter, selectedRoutineRoomFilter);
  setSelectValueIfPresent(els.routineRoom, selectedRoutineRoom);
  setSelectValueIfPresent(els.routineAssignee, selectedRoutineAssignee);
  setSelectValueIfPresent(els.planAssigneeFilter, selectedPlanAssignee);
  if (els.todayAssigneeFilter) setSelectValueIfPresent(els.todayAssigneeFilter, selectedTodayAssignee);
}

function setSelectValueIfPresent(select, value) {
  if (value && [...select.options].some(option => option.value === value)) select.value = value;
}

function formatDate(dateString) {
  if (!dateString) return 'Sin fecha';
  const date = new Date(`${dateString}T12:00:00`);
  if (dateString === todayISO()) return 'Hoy';
  if (dateString === addDaysISO(1)) return 'Mañana';
  if (dateString === addDaysISO(-1)) return 'Ayer';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(date);
}

function renderSummary() {
  const pending = state.tasks.filter(task => !task.completed);
  const overdue = pending.filter(isOverdue);
  const today = pending.filter(task => task.dueDate === todayISO());
  const completedToday = state.history.filter(item => localISO(new Date(item.completedAt)) === todayISO());

  els.pendingCount.textContent = pending.length;
  els.overdueCount.textContent = overdue.length;
  els.todayCount.textContent = today.length;
  els.completedTodayCount.textContent = completedToday.length;

  const next = [...pending].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt - b.createdAt)[0];
  if (!next) {
    els.nextTask.className = 'next-task empty-state';
    els.nextTask.textContent = 'No hay tareas pendientes.';
  } else {
    const person = userName(next.assigneeId, next.assigneeName);
    els.nextTask.className = 'next-task';
    els.nextTask.innerHTML = `<strong>${escapeHTML(next.title)}</strong><span>${escapeHTML(roomById(next.roomId)?.name || 'Sin estancia')} · ${escapeHTML(person)} · ${formatDate(next.dueDate)}</span>`;
  }
}

function todayMatchesAssignee(task, selected = els.todayAssigneeFilter?.value || 'all') {
  if (selected === 'all') return true;
  if (selected === 'unassigned') return !task.assigneeId;
  return task.assigneeId === selected;
}

function todayTaskMarkup(task, { showDate = false } = {}) {
  const room = roomById(task.roomId)?.name || 'Sin estancia';
  const person = userName(task.assigneeId, task.assigneeName);
  const datePart = showDate ? `<span class="task-date ${isOverdue(task) ? 'overdue' : ''}">${formatDate(task.dueDate)}</span>` : '';
  return `<div class="today-task-row ${task.priority === 'high' ? 'high' : ''}" data-task-id="${task.id}">
    <button class="today-task-check" type="button" aria-label="Completar ${escapeHTML(task.title)}">✓</button>
    <button class="today-task-open" type="button" title="Editar tarea">
      <strong>${escapeHTML(task.title)}</strong>
      <span>${escapeHTML(room)} · ${escapeHTML(person)}${task.recurrence && task.recurrence !== 'none' ? ' · ↻' : ''}</span>
    </button>
    ${datePart}
  </div>`;
}

function bindTodayTaskEvents(root) {
  if (!root) return;
  root.querySelectorAll('.today-task-row').forEach(row => {
    const id = row.dataset.taskId;
    row.querySelector('.today-task-check')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleTask(id);
    });
    row.querySelector('.today-task-open')?.addEventListener('click', () => openTaskDialog(id));
  });
}

function renderToday() {
  if (!els.todayTaskList) return;
  const selected = els.todayAssigneeFilter?.value || 'all';
  const today = todayISO();
  const tomorrow = addDaysISO(1);
  const pending = state.tasks.filter(task => !task.completed && todayMatchesAssignee(task, selected));
  const dueToday = pending.filter(task => task.dueDate === today);
  const overdue = pending.filter(task => task.dueDate && task.dueDate < today);
  const tomorrowTasks = pending.filter(task => task.dueDate === tomorrow);
  const doneToday = state.history.filter(item => localISO(new Date(item.completedAt)) === today && (selected === 'all' || (selected === 'unassigned' ? !item.assigneeId : item.assigneeId === selected)));
  const unassigned = state.tasks.filter(task => !task.completed && !task.assigneeId && (task.dueDate === today || (task.dueDate && task.dueDate < today))).length;

  els.todayDateLabel.textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  els.todayDashboardPending.textContent = dueToday.length;
  els.todayDashboardOverdue.textContent = overdue.length;
  els.todayDashboardDone.textContent = doneToday.length;
  els.todayDashboardUnassigned.textContent = unassigned;

  const renderList = (element, tasks, emptyText, options = {}) => {
    element.innerHTML = tasks.length ? tasks.map(task => todayTaskMarkup(task, options)).join('') : `<div class="today-empty">${emptyText}</div>`;
    bindTodayTaskEvents(element);
  };

  renderList(els.todayTaskList, dueToday, 'No hay tareas pendientes para hoy.');
  renderList(els.todayOverdueList, overdue, 'No hay tareas vencidas.', { showDate: true });
  renderList(els.todayTomorrowList, tomorrowTasks.slice(0, 6), 'No hay tareas previstas para mañana.');

  const recent = [...state.history]
    .filter(item => selected === 'all' || (selected === 'unassigned' ? !item.assigneeId : item.assigneeId === selected))
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 6);
  els.todayRecentHistory.innerHTML = recent.length ? recent.map(item => {
    const room = roomById(item.roomId)?.name || item.roomName || 'Sin estancia';
    const person = userName(item.assigneeId, item.assigneeName);
    const when = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.completedAt));
    return `<div class="today-history-row"><span class="today-history-check">✓</span><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(room)} · ${escapeHTML(person)}</small></span><time>${when}</time></div>`;
  }).join('') : '<div class="today-empty">Todavía no hay actividad reciente.</div>';
}

function getFilteredTasks() {
  const room = els.roomFilter.value;
  const status = els.statusFilter.value;
  const assignee = els.assigneeFilter.value;
  const search = els.taskSearch.value.trim().toLocaleLowerCase('es');

  return state.tasks.filter(task => {
    if (room !== 'all' && task.roomId !== room) return false;
    if (status === 'pending' && task.completed) return false;
    if (status === 'completed' && !task.completed) return false;
    if (assignee === 'unassigned' && task.assigneeId) return false;
    if (assignee !== 'all' && assignee !== 'unassigned' && task.assigneeId !== assignee) return false;
    const roomName = roomById(task.roomId)?.name || '';
    const person = userName(task.assigneeId, task.assigneeName);
    const haystack = `${task.title} ${person} ${roomName}`.toLocaleLowerCase('es');
    return !search || haystack.includes(search);
  });
}

function renderActiveRoomHint() {
  const roomId = els.roomFilter.value;
  if (!roomId || roomId === 'all') {
    els.activeRoomHint.hidden = true;
    els.clearRoomFilterButton.hidden = true;
    return;
  }
  const room = roomById(roomId);
  els.activeRoomHint.textContent = `Mostrando ${room?.name || 'estancia seleccionada'}`;
  els.activeRoomHint.hidden = false;
  els.clearRoomFilterButton.hidden = false;
}

function renderTasks() {
  renderActiveRoomHint();
  const tasks = getFilteredTasks();
  if (tasks.length === 0) {
    els.taskList.innerHTML = '<div class="list-empty">No hay tareas que coincidan con estos filtros.</div>';
    return;
  }

  els.taskList.innerHTML = tasks.map(task => {
    const room = roomById(task.roomId)?.name || 'Sin estancia';
    const person = userName(task.assigneeId, task.assigneeName);
    return `<article class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
      <button class="task-check" type="button" aria-label="${task.completed ? 'Reabrir' : 'Completar'} ${escapeHTML(task.title)}">${task.completed ? '✓' : ''}</button>
      <div class="task-main">
        <div class="task-title-row"><span class="task-title">${escapeHTML(task.title)}</span>${task.priority === 'high' ? '<i class="priority-dot" title="Prioridad alta"></i>' : ''}</div>
        <div class="task-meta">
          <span>${escapeHTML(room)}</span>
          <span>${escapeHTML(person)}</span>
          <span class="task-date ${isOverdue(task) ? 'overdue' : ''}">${formatDate(task.dueDate)}</span>
          ${(task.recurrence && task.recurrence !== 'none') ? `<span class="recurrence-badge">↻ ${escapeHTML(recurrenceText(task))}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action edit" type="button" aria-label="Editar tarea" title="Editar">✎</button>
        <button class="task-action delete" type="button" aria-label="Eliminar tarea" title="Eliminar">×</button>
      </div>
    </article>`;
  }).join('');

  els.taskList.querySelectorAll('.task-item').forEach(item => {
    const id = item.dataset.taskId;
    item.querySelector('.task-check').addEventListener('click', () => toggleTask(id));
    item.querySelector('.edit').addEventListener('click', () => openTaskDialog(id));
    item.querySelector('.delete').addEventListener('click', () => deleteTask(id));
  });
}

function getFilteredHistory() {
  const user = els.historyUserFilter.value;
  const room = els.historyRoomFilter.value;
  return state.history.filter(item => {
    if (room !== 'all' && item.roomId !== room) return false;
    if (user === 'unassigned' && item.assigneeId) return false;
    if (user !== 'all' && user !== 'unassigned' && item.assigneeId !== user) return false;
    return true;
  });
}

function renderHistory() {
  const history = getFilteredHistory();
  if (history.length === 0) {
    els.historyList.innerHTML = '<div class="list-empty" style="margin:14px">Todavia no hay actividades completadas para estos filtros.</div>';
    return;
  }

  els.historyList.innerHTML = history.map(item => {
    const date = new Date(item.completedAt);
    const time = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
    const roomName = roomById(item.roomId)?.name || item.roomName || 'Sin estancia';
    const person = userName(item.assigneeId, item.assigneeName);
    return `<div class="history-row">
      <div class="history-time">${time}</div>
      <div><div class="history-title">${escapeHTML(item.title)}</div><div class="history-meta">${escapeHTML(roomName)}</div></div>
      <div class="history-user">${escapeHTML(person)}</div>
    </div>`;
  }).join('');
}

function renderUsers() {
  if (!state.users.length) {
    els.userList.innerHTML = '<div class="users-empty">Todavia no hay personas. Anade los miembros de la casa para poder asignar tareas.</div>';
    return;
  }
  els.userList.innerHTML = state.users.map(user => `<div class="user-row" data-user-id="${user.id}">
    <div class="user-avatar">${escapeHTML(user.name.trim().charAt(0).toUpperCase() || '?')}</div>
    <div class="user-name">${escapeHTML(user.name)}</div>
    <button class="user-delete" type="button" aria-label="Eliminar ${escapeHTML(user.name)}" title="Eliminar">×</button>
  </div>`).join('');
  els.userList.querySelectorAll('.user-row').forEach(row => row.querySelector('.user-delete').addEventListener('click', () => deleteUser(row.dataset.userId)));
}

function renderRoomSettings() {
  els.roomSettingsList.innerHTML = state.rooms.map(room => `<label class="room-name-field">
    <span>${escapeHTML(defaultRooms.find(item => item.id === room.id)?.name || room.id)}</span>
    <input type="text" maxlength="40" value="${escapeHTML(room.name)}" data-room-id="${room.id}" />
  </label>`).join('');
}

function getFilteredTemplates() {
  const room = els.routineRoomFilter.value;
  const search = els.routineSearch.value.trim().toLocaleLowerCase('es');
  return state.templates.filter(template => {
    if (room !== 'all' && template.roomId !== room) return false;
    const roomName = roomById(template.roomId)?.name || '';
    const person = userName(template.assigneeId, 'Sin asignar');
    const haystack = `${template.title} ${roomName} ${person} ${recurrenceText(template)}`.toLocaleLowerCase('es');
    return !search || haystack.includes(search);
  });
}

function renderRoutines() {
  els.templateCount.textContent = state.templates.length;
  els.activeRoutineCount.textContent = state.tasks.filter(task => !task.completed && task.recurrence && task.recurrence !== 'none').length;
  const templates = getFilteredTemplates();
  if (!templates.length) {
    els.routineList.innerHTML = '<div class="list-empty">No hay rutinas que coincidan con estos filtros.</div>';
    return;
  }
  els.routineList.innerHTML = templates.map(template => {
    const room = roomById(template.roomId)?.name || 'Sin estancia';
    const person = userName(template.assigneeId, 'Sin asignar');
    return `<article class="routine-card" data-template-id="${template.id}">
      <div class="routine-main">
        <div class="routine-title-row"><strong>${escapeHTML(template.title)}</strong>${template.priority === 'high' ? '<i class="priority-dot" title="Prioridad alta"></i>' : ''}</div>
        <div class="task-meta"><span>${escapeHTML(room)}</span><span>${escapeHTML(person)}</span><span class="recurrence-badge">${template.recurrence && template.recurrence !== 'none' ? '↻ ' : ''}${escapeHTML(recurrenceText(template))}</span></div>
      </div>
      <div class="routine-actions">
        <button class="secondary-button routine-create" type="button">Crear hoy</button>
        <button class="task-action routine-edit" type="button" aria-label="Editar rutina" title="Editar">✎</button>
        <button class="task-action routine-delete" type="button" aria-label="Eliminar rutina" title="Eliminar">×</button>
      </div>
    </article>`;
  }).join('');
  els.routineList.querySelectorAll('.routine-card').forEach(card => {
    const id = card.dataset.templateId;
    card.querySelector('.routine-create').addEventListener('click', () => createTaskFromTemplate(id));
    card.querySelector('.routine-edit').addEventListener('click', () => openRoutineDialog(id));
    card.querySelector('.routine-delete').addEventListener('click', () => deleteRoutine(id));
  });
}

function updateCustomRecurrenceVisibility() {
  els.taskRecurrenceDaysWrap.hidden = els.taskRecurrence.value !== 'custom';
  els.routineRecurrenceDaysWrap.hidden = els.routineRecurrence.value !== 'custom';
}

function openRoutineDialog(templateId = null) {
  state.editingRoutineId = templateId;
  renderFilters();
  const template = templateId ? state.templates.find(item => item.id === templateId) : null;
  if (template) {
    els.routineDialogEyebrow.textContent = 'Editar plantilla';
    els.routineDialogTitle.textContent = 'Editar rutina';
    els.routineTitle.value = template.title;
    els.routineRoom.value = template.roomId;
    els.routineAssignee.value = template.assigneeId || '';
    els.routinePriority.value = template.priority || 'normal';
    els.routineRecurrence.value = template.recurrence || 'none';
    els.routineRecurrenceDays.value = template.recurrenceDays || 2;
  } else {
    els.routineDialogEyebrow.textContent = 'Plantilla doméstica';
    els.routineDialogTitle.textContent = 'Nueva rutina';
    els.routineForm.reset();
    els.routinePriority.value = 'normal';
    els.routineRecurrence.value = 'weekly';
    els.routineRecurrenceDays.value = 2;
    els.routineAssignee.value = '';
    if (els.routineRoomFilter.value !== 'all') els.routineRoom.value = els.routineRoomFilter.value;
  }
  updateCustomRecurrenceVisibility();
  els.routineDialog.showModal();
  setTimeout(() => els.routineTitle.focus(), 50);
}

async function saveRoutine(event) {
  event.preventDefault();
  const title = els.routineTitle.value.trim();
  if (!title) return;
  const existing = state.editingRoutineId ? state.templates.find(item => item.id === state.editingRoutineId) : null;
  const template = {
    ...(existing || {}),
    id: existing?.id || makeId(),
    title,
    roomId: els.routineRoom.value,
    assigneeId: els.routineAssignee.value || null,
    priority: els.routinePriority.value,
    recurrence: els.routineRecurrence.value,
    recurrenceDays: els.routineRecurrence.value === 'custom' ? Math.max(2, Number(els.routineRecurrenceDays.value) || 2) : null,
    createdAt: existing?.createdAt || Date.now(),
    modifiedAt: Date.now(),
  };
  await put('templates', template);
  els.routineDialog.close();
  state.editingRoutineId = null;
  await loadState();
  renderAll();
  showToast(existing ? 'Rutina actualizada' : 'Rutina creada');
  touchCloudDirty();
}

async function deleteRoutine(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  if (!confirm(`¿Eliminar la rutina "${template.title}"? Las tareas ya creadas no se borrarán.`)) return;
  await markDeleted('templates', id);
  await remove('templates', id);
  await loadState();
  renderAll();
  showToast('Rutina eliminada');
  touchCloudDirty();
}

async function createTaskFromTemplate(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  const existing = state.tasks.find(task => task.templateId === template.id && !task.completed);
  if (existing) {
    els.roomFilter.value = template.roomId;
    els.statusFilter.value = 'pending';
    switchView('tasks');
    renderTasks();
    showToast('Esta rutina ya tiene una tarea pendiente');
    return;
  }
  await put('tasks', {
    id: makeId(), templateId: template.id, title: template.title, roomId: template.roomId,
    assigneeId: template.assigneeId || null,
    assigneeName: template.assigneeId ? userName(template.assigneeId, '') : undefined,
    dueDate: todayISO(), priority: template.priority || 'normal',
    recurrence: template.recurrence || 'none', recurrenceDays: template.recurrenceDays || null,
    completed: false, createdAt: Date.now(), modifiedAt: Date.now(),
  });
  await loadState();
  els.roomFilter.value = template.roomId;
  els.statusFilter.value = 'pending';
  switchView('tasks');
  renderAll();
  showToast('Tarea creada desde rutina');
  touchCloudDirty();
}


function taskMatchesPlanAssignee(task) {
  const selected = els.planAssigneeFilter.value || 'all';
  if (selected === 'all') return true;
  if (selected === 'unassigned') return !task.assigneeId;
  return task.assigneeId === selected;
}

function formatWeekLabel(start, end) {
  const monthName = date => new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(date).replace('.', '');
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}–${end.getDate()} ${monthName(end)} ${end.getFullYear()}`;
  return `${start.getDate()} ${monthName(start)} – ${end.getDate()} ${monthName(end)} ${end.getFullYear()}`;
}

function planTaskMarkup(task) {
  const room = roomById(task.roomId)?.name || 'Sin estancia';
  const person = userName(task.assigneeId, task.assigneeName);
  return `<div class="plan-task ${task.priority === 'high' ? 'high' : ''}" data-task-id="${task.id}">
    <button class="plan-task-check" type="button" aria-label="Completar ${escapeHTML(task.title)}">✓</button>
    <button class="plan-task-open" type="button" title="Editar tarea">
      <strong>${escapeHTML(task.title)}</strong>
      <span>${escapeHTML(room)}</span>
      <small>${escapeHTML(person)}${task.recurrence && task.recurrence !== 'none' ? ' · ↻' : ''}</small>
    </button>
  </div>`;
}

function bindPlanTaskEvents(root) {
  root.querySelectorAll('.plan-task').forEach(row => {
    const id = row.dataset.taskId;
    row.querySelector('.plan-task-check')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleTask(id);
    });
    row.querySelector('.plan-task-open')?.addEventListener('click', () => openTaskDialog(id));
  });
}

function renderPlan() {
  if (!els.weeklyPlanner) return;
  const start = weekStartForOffset(state.planWeekOffset);
  const end = addDaysToDate(start, 6);
  const startISO = localISO(start);
  const endISO = localISO(end);
  els.planWeekLabel.textContent = formatWeekLabel(start, end);

  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDate(start, index));
  els.weeklyPlanner.innerHTML = days.map((date, index) => {
    const iso = localISO(date);
    const tasks = state.tasks.filter(task => !task.completed && task.dueDate === iso && taskMatchesPlanAssignee(task));
    const isToday = iso === todayISO();
    return `<article class="plan-day card ${isToday ? 'today' : ''}" data-date="${iso}">
      <div class="plan-day-head">
        <div><span>${dayNames[index]}</span><strong>${date.getDate()}</strong></div>
        <button class="plan-add-day" type="button" aria-label="Añadir tarea el ${iso}" title="Nueva tarea">+</button>
      </div>
      <div class="plan-day-count">${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'}</div>
      <div class="plan-day-tasks">${tasks.length ? tasks.map(planTaskMarkup).join('') : '<div class="plan-day-empty">Sin tareas</div>'}</div>
    </article>`;
  }).join('');

  els.weeklyPlanner.querySelectorAll('.plan-add-day').forEach(button => button.addEventListener('click', () => {
    const date = button.closest('.plan-day').dataset.date;
    openTaskDialog(null, date);
  }));
  bindPlanTaskEvents(els.weeklyPlanner);

  const backlog = state.tasks.filter(task => !task.completed && taskMatchesPlanAssignee(task) && (!task.dueDate || task.dueDate < todayISO()));
  if (!backlog.length) {
    els.planBacklog.innerHTML = '<div class="planner-empty">No hay tareas vencidas ni sin fecha.</div>';
  } else {
    els.planBacklog.innerHTML = backlog.map(task => {
      const room = roomById(task.roomId)?.name || 'Sin estancia';
      const dateText = task.dueDate ? `Vencida · ${formatDate(task.dueDate)}` : 'Sin fecha';
      return `<button class="backlog-row" type="button" data-task-id="${task.id}"><span><strong>${escapeHTML(task.title)}</strong><small>${escapeHTML(room)}</small></span><b>${escapeHTML(dateText)}</b></button>`;
    }).join('');
    els.planBacklog.querySelectorAll('.backlog-row').forEach(button => button.addEventListener('click', () => openTaskDialog(button.dataset.taskId)));
  }

  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  const workloadRows = state.users.map(user => {
    const pending = state.tasks.filter(task => !task.completed && task.assigneeId === user.id).length;
    const week = state.tasks.filter(task => !task.completed && task.assigneeId === user.id && task.dueDate >= startISO && task.dueDate <= endISO).length;
    const done = state.history.filter(item => item.assigneeId === user.id && item.completedAt >= thirtyDaysAgo).length;
    return { id: user.id, name: user.name, pending, week, done };
  });
  const unassigned = state.tasks.filter(task => !task.completed && !task.assigneeId).length;
  if (!workloadRows.length && !unassigned) {
    els.workloadSummary.innerHTML = '<div class="planner-empty">Añade personas para ver el reparto.</div>';
  } else {
    const rows = workloadRows.map(item => `<button class="workload-row" type="button" data-user-id="${item.id}">
      <span class="workload-name"><i>${escapeHTML(item.name.charAt(0).toUpperCase())}</i>${escapeHTML(item.name)}</span>
      <span><b>${item.week}</b><small>esta semana</small></span>
      <span><b>${item.pending}</b><small>pendientes</small></span>
      <span><b>${item.done}</b><small>hechas 30 d</small></span>
    </button>`).join('');
    const unassignedRow = unassigned ? `<button class="workload-row unassigned" type="button" data-user-id="unassigned">
      <span class="workload-name"><i>?</i>Sin asignar</span><span><b>—</b><small>esta semana</small></span><span><b>${unassigned}</b><small>pendientes</small></span><span><b>—</b><small>hechas 30 d</small></span>
    </button>` : '';
    els.workloadSummary.innerHTML = rows + unassignedRow;
    els.workloadSummary.querySelectorAll('.workload-row').forEach(row => row.addEventListener('click', () => {
      els.assigneeFilter.value = row.dataset.userId;
      els.statusFilter.value = 'pending';
      switchView('tasks');
      renderTasks();
    }));
  }
}

function renderSettings() {
  const houseName = settingValue('houseName', 'Mi casa');
  els.houseNameDisplay.textContent = houseName;
  els.houseNameInput.value = houseName;
  renderUsers();
  renderRoomSettings();
  if (els.appVersionDisplay) els.appVersionDisplay.textContent = APP_VERSION;
  if (els.lastForcedUpdate) els.lastForcedUpdate.textContent = formatSyncTime(localStorage.getItem('hometasks-last-forced-update'));
  renderSyncPanel();
}

function renderAll() {
  renderFilters();
  renderToday();
  renderSummary();
  renderFloorPlan();
  renderRoomSummary();
  renderTasks();
  renderPlan();
  renderRoutines();
  renderHistory();
  renderSettings();
}

function openTaskDialog(taskId = null, presetDate = null) {
  state.editingTaskId = taskId;
  renderFilters();
  const task = taskId ? state.tasks.find(item => item.id === taskId) : null;

  if (task) {
    els.taskDialogEyebrow.textContent = 'Editar actividad';
    els.taskDialogTitle.textContent = 'Editar tarea';
    els.saveTaskButton.textContent = 'Guardar cambios';
    els.taskTitle.value = task.title;
    els.taskRoom.value = task.roomId;
    els.taskAssignee.value = task.assigneeId || '';
    els.taskDueDate.value = task.dueDate || '';
    els.taskPriority.value = task.priority || 'normal';
    els.taskRecurrence.value = task.recurrence || 'none';
    els.taskRecurrenceDays.value = task.recurrenceDays || 2;
    updateCustomRecurrenceVisibility();
  } else {
    els.taskDialogEyebrow.textContent = 'Nueva actividad';
    els.taskDialogTitle.textContent = 'Anadir tarea';
    els.saveTaskButton.textContent = 'Guardar tarea';
    els.taskForm.reset();
    els.taskDueDate.value = presetDate || todayISO();
    els.taskPriority.value = 'normal';
    els.taskAssignee.value = '';
    els.taskRecurrence.value = 'none';
    els.taskRecurrenceDays.value = 2;
    updateCustomRecurrenceVisibility();
    if (els.roomFilter.value !== 'all') els.taskRoom.value = els.roomFilter.value;
  }

  els.taskDialog.showModal();
  setTimeout(() => els.taskTitle.focus(), 50);
}

async function saveTask(event) {
  event.preventDefault();
  const title = els.taskTitle.value.trim();
  if (!title) return;

  if (state.editingTaskId) {
    const existing = state.tasks.find(item => item.id === state.editingTaskId);
    if (!existing) return;
    await put('tasks', {
      ...existing,
      title,
      roomId: els.taskRoom.value,
      assigneeId: els.taskAssignee.value || null,
      assigneeName: els.taskAssignee.value ? userName(els.taskAssignee.value, '') : undefined,
      dueDate: els.taskDueDate.value || '',
      priority: els.taskPriority.value,
      recurrence: els.taskRecurrence.value,
      recurrenceDays: els.taskRecurrence.value === 'custom' ? Math.max(2, Number(els.taskRecurrenceDays.value) || 2) : null,
      modifiedAt: Date.now(),
    });
    showToast('Tarea actualizada');
  } else {
    await put('tasks', {
      id: makeId(),
      title,
      roomId: els.taskRoom.value,
      assigneeId: els.taskAssignee.value || null,
      assigneeName: els.taskAssignee.value ? userName(els.taskAssignee.value, '') : undefined,
      dueDate: els.taskDueDate.value || '',
      priority: els.taskPriority.value,
      recurrence: els.taskRecurrence.value,
      recurrenceDays: els.taskRecurrence.value === 'custom' ? Math.max(2, Number(els.taskRecurrenceDays.value) || 2) : null,
      completed: false,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    });
    showToast('Tarea creada');
  }

  els.taskDialog.close();
  state.editingTaskId = null;
  await loadState();
  renderAll();
  touchCloudDirty();
}

async function toggleTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  const completing = !task.completed;

  if (completing && task.recurrence && task.recurrence !== 'none') {
    const completedAt = Date.now();
    const nextDueDate = nextRecurrenceDate(task);
    await put('history', {
      id: makeId(), taskId: task.id, title: task.title, roomId: task.roomId,
      roomName: roomById(task.roomId)?.name || 'Sin estancia',
      assigneeId: task.assigneeId || null, assigneeName: userName(task.assigneeId, task.assigneeName),
      completedAt, recurring: true, modifiedAt: completedAt,
    });
    await put('tasks', { ...task, completed: false, completedAt: null, lastCompletedAt: completedAt, dueDate: nextDueDate, modifiedAt: completedAt });
    await loadState();
    renderAll();
    showToast(`Completada · próxima ${formatDate(nextDueDate)}`);
    touchCloudDirty();
    return;
  }

  const updated = { ...task, completed: completing, completedAt: completing ? Date.now() : null, modifiedAt: Date.now() };
  await put('tasks', updated);
  if (completing) {
    await put('history', {
      id: makeId(), taskId: task.id, title: task.title, roomId: task.roomId,
      roomName: roomById(task.roomId)?.name || 'Sin estancia',
      assigneeId: task.assigneeId || null, assigneeName: userName(task.assigneeId, task.assigneeName),
      completedAt: updated.completedAt, modifiedAt: updated.completedAt,
    });
    showToast('Tarea completada');
  } else {
    const matchingHistory = state.history.filter(item => item.taskId === task.id && !item.recurring);
    for (const item of matchingHistory) { await markDeleted('history', item.id); await remove('history', item.id); }
    showToast('Tarea reabierta');
  }
  await loadState();
  renderAll();
  touchCloudDirty();
}

async function deleteTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  if (!confirm(`¿Eliminar "${task.title}"?`)) return;
  await markDeleted('tasks', id);
  await remove('tasks', id);
  await loadState();
  renderAll();
  showToast('Tarea eliminada · histórico conservado');
  touchCloudDirty();
}

async function addUser(event) {
  event.preventDefault();
  const name = els.newUserName.value.trim();
  if (!name) return;
  const duplicate = state.users.some(user => user.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
  if (duplicate) {
    showToast('Ese nombre ya existe');
    return;
  }
  await put('users', { id: makeId(), name, createdAt: Date.now(), modifiedAt: Date.now() });
  els.newUserName.value = '';
  await loadState();
  renderAll();
  showToast('Persona anadida');
  touchCloudDirty();
}

async function deleteUser(id) {
  const user = userById(id);
  if (!user) return;
  if (!confirm(`¿Eliminar a ${user.name}? Las tareas pendientes quedaran sin asignar.`)) return;

  const affectedTasks = state.tasks.filter(task => task.assigneeId === id).map(task => ({ ...task, assigneeId: null, assigneeName: undefined, modifiedAt: Date.now() }));
  if (affectedTasks.length) await putMany('tasks', affectedTasks);
  const affectedTemplates = state.templates.filter(template => template.assigneeId === id).map(template => ({ ...template, assigneeId: null, modifiedAt: Date.now() }));
  if (affectedTemplates.length) await putMany('templates', affectedTemplates);
  await markDeleted('users', id);
  await remove('users', id);
  await loadState();
  renderAll();
  showToast('Persona eliminada');
  touchCloudDirty();
}

async function saveHouseName() {
  const value = els.houseNameInput.value.trim() || 'Mi casa';
  await put('settings', { id: 'houseName', value, modifiedAt: Date.now() });
  await loadState();
  renderSettings();
  showToast('Nombre guardado');
  touchCloudDirty();
}

async function saveRoomNames() {
  const inputs = [...els.roomSettingsList.querySelectorAll('input[data-room-id]')];
  const updated = inputs.map(input => {
    const room = roomById(input.dataset.roomId);
    return { ...room, name: input.value.trim() || room.name, modifiedAt: Date.now() };
  });
  await putMany('rooms', updated);
  await loadState();
  renderAll();
  showToast('Estancias actualizadas');
  touchCloudDirty();
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.getElementById('mainContent').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncConfigured() {
  return Boolean(localStorage.getItem(LS_SYNC_ENDPOINT) && localStorage.getItem(LS_SYNC_HOUSE_KEY));
}

function syncLinked() {
  return localStorage.getItem(LS_CLOUD_LINKED) === '1';
}

function normalizeAppsScriptUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('La URL de Apps Script no es válida.'); }
  if (url.protocol !== 'https:') throw new Error('La URL de Apps Script debe usar HTTPS.');
  if (!/script\.google\.com$/i.test(url.hostname)) throw new Error('Usa la URL /exec proporcionada por Google Apps Script.');
  if (!/\/exec\/?$/i.test(url.pathname)) throw new Error('La URL debe ser la implementación de Apps Script terminada en /exec.');
  return url.toString().replace(/\/$/, '');
}

function updateConnection() {
  const online = navigator.onLine;
  if (!online) {
    els.connectionBadge.textContent = 'Offline · datos locales';
    els.connectionBadge.classList.add('offline');
  } else {
    els.connectionBadge.classList.remove('offline');
    if (syncConfigured() && syncLinked()) {
      els.connectionBadge.textContent = 'Nube · vinculada';
    } else {
      els.connectionBadge.textContent = 'Online · datos locales';
    }
  }
  renderHeaderSyncStatus();
}

function getDeviceId() {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = `device-${makeId().slice(0, 12)}`;
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

function itemTimestamp(item) {
  return Number(item?.modifiedAt || item?.updatedAt || item?.completedAt || item?.createdAt || 0);
}

async function markDeleted(store, entityId, deletedAt = Date.now()) {
  await put('sync', {
    id: `tombstone:${store}:${entityId}`,
    kind: 'tombstone', store, entityId, deletedAt, deviceId: getDeviceId(),
  });
}

function getLocalRevision() {
  return Number(localStorage.getItem(LS_LOCAL_REVISION) || 0);
}

function bumpLocalRevision() {
  const current = getLocalRevision();
  const next = Math.max(Date.now(), current + 1);
  localStorage.setItem(LS_LOCAL_REVISION, String(next));
  return next;
}

function scheduleSyncSoon(delay = 1400) {
  if (state.syncTimer) clearTimeout(state.syncTimer);
  if (!els.autoSyncToggle?.checked || !syncConfigured() || !syncLinked() || !navigator.onLine) return;
  state.syncTimer = setTimeout(() => {
    state.syncTimer = null;
    if (state.syncBusy) {
      scheduleSyncSoon(1200);
      return;
    }
    syncNow({ silent: true });
  }, delay);
}

function touchCloudDirty() {
  localStorage.setItem(LS_CLOUD_DIRTY, '1');
  bumpLocalRevision();
  scheduleSyncSoon(2200);
  renderSyncPanel();
}

function formatSyncTime(value) {
  const n = Number(value || 0);
  if (!n) return 'Nunca';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(n));
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== 'hometasks-sync' || !snapshot.data) throw new Error('El archivo no es una copia válida de HomeTasks.');
  for (const store of SYNCABLE_STORES) if (!Array.isArray(snapshot.data[store])) snapshot.data[store] = [];
  if (!Array.isArray(snapshot.tombstones)) snapshot.tombstones = [];
  return snapshot;
}

async function buildSyncSnapshot() {
  const [rooms, users, tasks, history, templates, settings, syncEntries] = await Promise.all([
    getAll('rooms'), getAll('users'), getAll('tasks'), getAll('history'), getAll('templates'), getAll('settings'), getAll('sync')
  ]);
  const houseName = settings.find(item => item.id === 'houseName') || { id: 'houseName', value: 'Mi casa', modifiedAt: 0 };
  let homeId = settings.find(item => item.id === 'homeId')?.value;
  if (!homeId) {
    homeId = makeId();
    await put('settings', { id: 'homeId', value: homeId, modifiedAt: Date.now() });
  }
  return {
    format: 'hometasks-sync', schemaVersion: 1, appVersion: APP_VERSION,
    homeId, updatedAt: Date.now(), sourceDeviceId: getDeviceId(),
    data: { rooms, users, tasks, history, templates, houseName },
    tombstones: syncEntries.filter(item => item.kind === 'tombstone'),
  };
}

function mergeEntityArrays(localItems = [], remoteItems = []) {
  const map = new Map();
  for (const item of [...localItems, ...remoteItems]) {
    const previous = map.get(item.id);
    if (!previous || itemTimestamp(item) > itemTimestamp(previous)) map.set(item.id, item);
  }
  return [...map.values()];
}

function mergeTombstones(localItems = [], remoteItems = []) {
  const map = new Map();
  for (const item of [...localItems, ...remoteItems]) {
    const key = `${item.store}:${item.entityId}`;
    const previous = map.get(key);
    if (!previous || Number(item.deletedAt || 0) > Number(previous.deletedAt || 0)) map.set(key, item);
  }
  return [...map.values()];
}

function reconcileTaskCompletionFromHistory(data) {
  const completedByTask = new Map();
  for (const entry of data.history || []) {
    if (!entry?.taskId || entry.recurring) continue;
    const previous = completedByTask.get(entry.taskId);
    if (!previous || Number(entry.completedAt || 0) > Number(previous.completedAt || 0)) {
      completedByTask.set(entry.taskId, entry);
    }
  }

  data.tasks = (data.tasks || []).map(task => {
    // Recurring tasks intentionally become pending again after each completion.
    if (task.recurrence && task.recurrence !== 'none') return task;
    const completion = completedByTask.get(task.id);
    if (!completion) return task;
    const completedAt = Number(completion.completedAt || completion.modifiedAt || 0);
    if (!completedAt) return task;
    if (task.completed && Number(task.completedAt || 0) >= completedAt) return task;
    return {
      ...task,
      completed: true,
      completedAt,
      modifiedAt: Math.max(itemTimestamp(task), itemTimestamp(completion), completedAt),
    };
  });
  return data;
}

function mergeSnapshots(localSnapshot, remoteSnapshot) {
  const local = validateSnapshot(structuredClone(localSnapshot));
  const remote = validateSnapshot(structuredClone(remoteSnapshot));

  // V4.1.5: delete-wins. A tombstone represents an explicit user deletion and
  // must dominate every older/same-ID copy, even if device clocks differ.
  // We lift deletedAt above the newest known copy so the existing Apps Script
  // backend (which compares timestamps) also honours the deletion unchanged.
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones).map(tomb => {
    let newestEntityTimestamp = 0;
    for (const snapshot of [local, remote]) {
      const entity = snapshot.data[tomb.store]?.find(item => item.id === tomb.entityId);
      if (entity) newestEntityTimestamp = Math.max(newestEntityTimestamp, itemTimestamp(entity));
    }
    const deletedAt = Math.max(Number(tomb.deletedAt || 0), newestEntityTimestamp + 1);
    return { ...tomb, deletedAt };
  });
  const deleted = new Map(tombstones.map(item => [`${item.store}:${item.entityId}`, Number(item.deletedAt || 0)]));
  const data = {};

  for (const store of SYNCABLE_STORES) {
    data[store] = mergeEntityArrays(local.data[store], remote.data[store]).filter(item => {
      const deletedAt = deleted.get(`${store}:${item.id}`) || 0;
      return !deletedAt || itemTimestamp(item) > deletedAt;
    });
    if (store === 'rooms') data[store] = normalizeRooms(data[store]);
  }

  const localHouse = local.data.houseName || { id: 'houseName', value: 'Mi casa', modifiedAt: 0 };
  const remoteHouse = remote.data.houseName || { id: 'houseName', value: 'Mi casa', modifiedAt: 0 };
  data.houseName = itemTimestamp(remoteHouse) > itemTimestamp(localHouse) ? remoteHouse : localHouse;

  reconcileTaskCompletionFromHistory(data);

  const survivingTombstones = tombstones.filter(tomb => {
    const item = data[tomb.store]?.find(entry => entry.id === tomb.entityId);
    return !item || Number(tomb.deletedAt || 0) >= itemTimestamp(item);
  });

  return {
    format: 'hometasks-sync', schemaVersion: 1, appVersion: APP_VERSION,
    homeId: remote.homeId || local.homeId,
    updatedAt: Date.now(), sourceDeviceId: getDeviceId(),
    data, tombstones: survivingTombstones,
  };
}

async function applySnapshot(snapshot, { replace = true } = {}) {
  const snap = validateSnapshot(structuredClone(snapshot));
  const tombstoneKeys = new Set(snap.tombstones.map(item => `${item.store}:${item.entityId}`));
  for (const store of SYNCABLE_STORES) {
    snap.data[store] = snap.data[store].filter(item => !tombstoneKeys.has(`${store}:${item.id}`));
  }
  reconcileTaskCompletionFromHistory(snap.data);

  if (replace) {
    for (const store of SYNCABLE_STORES) await clearStore(store);
    await clearStore('sync');
  }

  for (const store of SYNCABLE_STORES) {
    let incoming = snap.data[store];
    if (!replace) {
      const current = await getAll(store);
      incoming = mergeEntityArrays(current, incoming).filter(item => !tombstoneKeys.has(`${store}:${item.id}`));
      if (store === 'tasks') {
        const mergedHistory = mergeEntityArrays(await getAll('history'), snap.data.history || [])
          .filter(item => !tombstoneKeys.has(`history:${item.id}`));
        const safeData = { tasks: incoming, history: mergedHistory };
        reconcileTaskCompletionFromHistory(safeData);
        incoming = safeData.tasks;
      }
    }
    if (store === 'rooms') incoming = normalizeRooms(incoming);
    if (incoming.length) await putMany(store, incoming);
  }

  // Tombstones are explicit deletions and must be applied even during a non-destructive sync.
  for (const tomb of snap.tombstones) {
    if (SYNCABLE_STORES.includes(tomb.store)) await remove(tomb.store, tomb.entityId);
  }
  if (snap.tombstones.length) await putMany('sync', snap.tombstones);

  const currentSettings = await getAll('settings');
  const houseName = snap.data.houseName || { id: 'houseName', value: 'Mi casa', modifiedAt: 0 };
  const currentHouse = currentSettings.find(item => item.id === 'houseName');
  if (replace || !currentHouse || itemTimestamp(houseName) >= itemTimestamp(currentHouse)) await put('settings', houseName);
  if (snap.homeId) await put('settings', { id: 'homeId', value: snap.homeId, modifiedAt: snap.updatedAt || Date.now() });
  for (const marker of ['v1-initialized','v1-structure-102','v2-initialized','v3-initialized','v4-initialized','v41-initialized']) {
    if (!currentSettings.some(item => item.id === marker)) await put('settings', { id: marker, value: true });
  }
  await put('settings', { id: 'appVersion', value: APP_VERSION });
}

function downloadSnapshot(snapshot, filename) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportLocalBackup() {
  const snapshot = await buildSyncSnapshot();
  downloadSnapshot(snapshot, `HomeTasks_backup_${todayISO()}.json`);
  showToast('Copia local exportada');
}

async function importLocalBackup(file) {
  if (!file) return;
  try {
    const snapshot = validateSnapshot(JSON.parse(await file.text()));
    if (!confirm('¿Restaurar esta copia? Los datos locales actuales serán sustituidos.')) return;
    await applySnapshot(snapshot, { replace: true });
    await loadState();
    renderAll();
    touchCloudDirty();
    showToast('Copia restaurada');
  } catch (error) {
    console.error(error);
    alert(`No se ha podido importar la copia.\n\n${error.message}`);
  } finally {
    els.importBackupFile.value = '';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function syncTransportError(message, code = 'transport_error', retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function jsonpRequestOnce(endpoint, action, houseKey, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const callback = `__ht_jsonp_${Date.now()}_${Math.random().toString(16).slice(2)}`.replace(/[^A-Za-z0-9_$]/g, '_');
    const url = new URL(endpoint);
    url.searchParams.set('action', action);
    url.searchParams.set('key', houseKey);
    url.searchParams.set('callback', callback);
    url.searchParams.set('clientVersion', APP_VERSION);
    url.searchParams.set('_', String(Date.now()));
    let timer;
    const script = document.createElement('script');
    script.referrerPolicy = 'no-referrer';
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      try { delete globalThis[callback]; } catch { globalThis[callback] = undefined; }
    };
    globalThis[callback] = payload => {
      cleanup();
      if (!payload?.ok) {
        const code = payload?.error || 'server_rejected';
        reject(syncTransportError(payload?.message || code, code, false));
        return;
      }
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(syncTransportError('No se ha podido cargar la respuesta de Google Apps Script.', 'script_load_error', true));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(syncTransportError('Apps Script está tardando más de lo esperado en responder.', 'timeout', true));
    }, timeoutMs);
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function jsonpRequest(endpoint, action, houseKey, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  const baseTimeout = Math.max(10000, Number(options.timeoutMs || 25000));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await jsonpRequestOnce(endpoint, action, houseKey, baseTimeout + ((attempt - 1) * 10000));
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt >= attempts) break;
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, error });
      await sleep(900 * attempt);
    }
  }
  if (lastError?.code === 'timeout') {
    throw syncTransportError('Google Apps Script no ha respondido tras varios intentos. HomeTasks volverá a intentarlo en la próxima sincronización.', 'timeout', true);
  }
  throw lastError || syncTransportError('No se ha podido contactar con Apps Script.');
}

async function noCorsPost(endpoint, payload, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 2));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000 + ((attempt - 1) * 10000));
    try {
      await fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-store',
        redirect: 'follow',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt >= attempts) break;
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, error });
      await sleep(1000 * attempt);
    }
  }
  if (lastError?.name === 'AbortError') throw syncTransportError('Apps Script no ha confirmado el envío dentro del tiempo esperado.', 'post_timeout', true);
  throw syncTransportError('No se han podido enviar los cambios a Apps Script.', 'post_error', true);
}

const syncProviders = {
  appsScript: {
    id: 'appsScript',
    name: 'Google Apps Script',
    config() {
      return {
        endpoint: normalizeAppsScriptUrl(localStorage.getItem(LS_SYNC_ENDPOINT) || ''),
        houseKey: localStorage.getItem(LS_SYNC_HOUSE_KEY) || '',
      };
    },
    async ping(options = {}) {
      const { endpoint, houseKey } = this.config();
      if (!endpoint || !houseKey) throw new Error('Configura primero la URL y la clave de la casa.');
      try {
        const response = await jsonpRequest(endpoint, 'ping', houseKey, { attempts: 2, timeoutMs: 18000, onRetry: options.onRetry });
        return {
          hasCloud: Boolean(response.hasCloud),
          updatedAt: Number(response.updatedAt || 0),
          homeId: response.homeId || null,
          provider: response.provider || this.name,
          protocolVersion: Number(response.protocolVersion || 2),
        };
      } catch (error) {
        // Compatible with the V4.1.x backend, which did not have a ping action.
        if (error?.code === 'bad_action') return this.status(options);
        throw error;
      }
    },
    async status(options = {}) {
      const { endpoint, houseKey } = this.config();
      if (!endpoint || !houseKey) throw new Error('Configura primero la URL y la clave de la casa.');
      const response = await jsonpRequest(endpoint, 'status', houseKey, { attempts: 3, timeoutMs: 22000, onRetry: options.onRetry });
      return {
        hasCloud: Boolean(response.hasCloud),
        updatedAt: Number(response.updatedAt || 0),
        homeId: response.homeId || null,
        provider: response.provider || this.name,
        protocolVersion: Number(response.protocolVersion || 1),
      };
    },
    async pull(options = {}) {
      const { endpoint, houseKey } = this.config();
      if (!endpoint || !houseKey) throw new Error('Configura primero la URL y la clave de la casa.');
      const response = await jsonpRequest(endpoint, 'pull', houseKey, { attempts: 3, timeoutMs: 25000, onRetry: options.onRetry });
      return response.snapshot ? validateSnapshot(response.snapshot) : null;
    },
    async push(snapshot, options = {}) {
      const { endpoint, houseKey } = this.config();
      if (!endpoint || !houseKey) throw new Error('Configura primero la URL y la clave de la casa.');
      await noCorsPost(endpoint, {
        action: 'push',
        key: houseKey,
        deviceId: getDeviceId(),
        clientVersion: APP_VERSION,
        snapshot,
      }, { attempts: 2, onRetry: options.onRetry });
      // doPost is no-CORS. Pull back the server copy as the acknowledgement.
      await sleep(1100);
      return this.pull(options);
    },
  },
};

function activeSyncProvider() {
  const id = localStorage.getItem(LS_SYNC_PROVIDER) || 'appsScript';
  return syncProviders[id] || syncProviders.appsScript;
}

function generateHouseKey() {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function recordSyncResult(ok, message) {
  localStorage.setItem(LS_LAST_SYNC_ATTEMPT, String(Date.now()));
  localStorage.setItem(LS_LAST_SYNC_RESULT, `${ok ? 'ok' : 'error'}|${String(message || '')}`);
  state.syncError = ok ? '' : String(message || 'Error de sincronización');
}

function readSyncResult() {
  const raw = localStorage.getItem(LS_LAST_SYNC_RESULT) || '';
  if (!raw) return { ok: null, message: '—' };
  const split = raw.indexOf('|');
  const kind = split >= 0 ? raw.slice(0, split) : raw;
  const message = split >= 0 ? raw.slice(split + 1) : '';
  return { ok: kind === 'ok', message: message || (kind === 'ok' ? 'Correcto' : 'Error') };
}

function updateSyncProgressDom() {
  if (!els.syncProgress) return;
  const progress = state.syncProgress || {};
  els.syncProgress.hidden = !progress.visible;
  els.syncProgress.classList.toggle('success', progress.state === 'success');
  els.syncProgress.classList.toggle('error', progress.state === 'error');
  const percent = Math.min(100, Math.max(0, Number(progress.percent || 0)));
  els.syncProgressBar.style.width = `${percent}%`;
  els.syncProgressPercent.textContent = `${Math.round(percent)}%`;
  els.syncProgressLabel.textContent = progress.label || 'Sincronizando…';
  els.syncProgressDetail.textContent = progress.detail || '';
}

function setSyncProgress(percent, label, detail = '') {
  clearTimeout(state.syncProgressHideTimer);
  state.syncProgress = { visible: true, active: true, percent, label, detail, state: 'running' };
  updateSyncProgressDom();
  renderSyncPanel();
}

function finishSyncProgress(ok, label, detail = '') {
  clearTimeout(state.syncProgressHideTimer);
  state.syncProgress = { visible: true, active: false, percent: 100, label, detail, state: ok ? 'success' : 'error' };
  updateSyncProgressDom();
  renderSyncPanel();
  if (ok) {
    state.syncProgressHideTimer = setTimeout(() => {
      state.syncProgress.visible = false;
      updateSyncProgressDom();
      renderSyncPanel();
    }, 2600);
  }
}

function renderHeaderSyncStatus() {
  if (!els.syncHeaderBadge) return;
  const linked = syncLinked();
  const configured = syncConfigured();
  const dirty = localStorage.getItem(LS_CLOUD_DIRTY) === '1';
  els.syncHeaderBadge.className = 'sync-header-badge';
  if (!navigator.onLine) {
    els.syncHeaderBadge.textContent = linked ? 'Offline' : 'Local';
    els.syncHeaderBadge.classList.add('offline');
  } else if (!configured) {
    els.syncHeaderBadge.textContent = 'Sin nube';
  } else if (!linked) {
    els.syncHeaderBadge.textContent = 'Nube lista';
  } else if (state.syncBusy) {
    els.syncHeaderBadge.textContent = '↻ Sync';
    els.syncHeaderBadge.classList.add('busy');
  } else if (state.syncError) {
    els.syncHeaderBadge.textContent = '! Sync';
    els.syncHeaderBadge.classList.add('error');
  } else if (dirty) {
    els.syncHeaderBadge.textContent = '↑ Pendiente';
    els.syncHeaderBadge.classList.add('pending');
  } else {
    els.syncHeaderBadge.textContent = '✓ Sync';
    els.syncHeaderBadge.classList.add('ok');
  }
}

function renderSyncPanel() {
  if (!els.syncEndpoint) return;
  const endpoint = localStorage.getItem(LS_SYNC_ENDPOINT) || '';
  const houseKey = localStorage.getItem(LS_SYNC_HOUSE_KEY) || '';
  const linked = syncLinked();
  const dirty = localStorage.getItem(LS_CLOUD_DIRTY) === '1';
  const configured = Boolean(endpoint && houseKey);
  const lastResult = readSyncResult();

  if (document.activeElement !== els.syncEndpoint) els.syncEndpoint.value = endpoint;
  if (document.activeElement !== els.syncHouseKey) els.syncHouseKey.value = houseKey;
  els.autoSyncToggle.checked = localStorage.getItem(LS_AUTO_SYNC) === '1';
  els.syncDeviceId.textContent = getDeviceId().replace('device-', '').slice(0, 12);
  els.syncLastSync.textContent = formatSyncTime(localStorage.getItem(LS_LAST_SYNC));
  els.syncLastAttempt.textContent = formatSyncTime(localStorage.getItem(LS_LAST_SYNC_ATTEMPT));
  els.syncLastResult.textContent = lastResult.message;
  els.syncLastResult.classList.toggle('sync-result-ok', lastResult.ok === true);
  els.syncLastResult.classList.toggle('sync-result-error', lastResult.ok === false);
  els.syncConnectedPanel.hidden = !configured;
  els.createCloudButton.hidden = true;
  els.adoptCloudButton.hidden = true;
  els.syncNowButton.hidden = true;
  els.unlinkCloudButton.hidden = !linked;

  if (!configured) {
    els.syncStatusPill.textContent = 'Sin configurar';
    els.syncStateSummary.textContent = 'Sin configurar';
    els.syncCloudStatus.textContent = '—';
    els.syncHelpText.textContent = 'Configura la URL /exec y la clave privada de la casa.';
  } else if (!state.syncStatus) {
    els.syncStatusPill.textContent = linked ? 'Vinculado' : 'Preparado';
    els.syncStateSummary.textContent = linked ? 'Vinculado' : 'Preparado';
    els.syncCloudStatus.textContent = 'Sin comprobar';
    if (linked) els.syncNowButton.hidden = false;
    els.syncHelpText.textContent = state.syncError || 'Pulsa “Probar conexión” para comprobar Apps Script.';
  } else if (linked) {
    els.syncStatusPill.textContent = dirty ? 'Cambios locales' : 'Sincronizado';
    els.syncStateSummary.textContent = 'Apps Script';
    els.syncCloudStatus.textContent = state.syncStatus.hasCloud ? `Disponible${state.syncStatus.updatedAt ? ` · ${formatSyncTime(state.syncStatus.updatedAt)}` : ''}` : 'No creada';
    els.syncNowButton.hidden = false;
    els.syncHelpText.textContent = state.syncError || (dirty ? 'Hay cambios locales pendientes de sincronizar.' : 'Este dispositivo está vinculado con la nube de HomeTasks.');
  } else if (state.syncStatus.hasCloud) {
    els.syncStatusPill.textContent = 'Nube encontrada';
    els.syncStateSummary.textContent = 'Nube encontrada';
    els.syncCloudStatus.textContent = `Disponible · ${formatSyncTime(state.syncStatus.updatedAt)}`;
    els.adoptCloudButton.hidden = false;
    els.syncHelpText.textContent = 'Hay datos de HomeTasks en la nube. “Usar datos de la nube” sustituirá los datos locales tras crear una copia de seguridad.';
  } else {
    els.syncStatusPill.textContent = 'Conectado';
    els.syncStateSummary.textContent = 'Apps Script';
    els.syncCloudStatus.textContent = 'Todavía no existe';
    els.createCloudButton.hidden = false;
    els.syncHelpText.textContent = 'La conexión funciona. Crea la nube con los datos de este dispositivo.';
  }

  if (state.syncBusy) {
    els.syncStatusPill.textContent = 'Sincronizando…';
    els.syncStatusPill.classList.add('busy');
    els.syncNowButton.hidden = true;
  } else {
    els.syncStatusPill.classList.remove('busy');
  }
  if (state.syncProgress?.active) els.syncNowButton.hidden = true;
  updateSyncProgressDom();
  updateConnection();
  renderHeaderSyncStatus();
}

async function saveSyncConfig({ quiet = false } = {}) {
  try {
    const endpoint = normalizeAppsScriptUrl(els.syncEndpoint.value);
    const key = els.syncHouseKey.value.trim();
    if (!endpoint) throw new Error('Introduce la URL /exec de Apps Script.');
    if (key.length < 20) throw new Error('Usa una clave de al menos 20 caracteres.');
    const changed = endpoint !== localStorage.getItem(LS_SYNC_ENDPOINT) || key !== localStorage.getItem(LS_SYNC_HOUSE_KEY);
    localStorage.setItem(LS_SYNC_PROVIDER, 'appsScript');
    localStorage.setItem(LS_SYNC_ENDPOINT, endpoint);
    localStorage.setItem(LS_SYNC_HOUSE_KEY, key);
    if (changed) {
      localStorage.removeItem(LS_CLOUD_LINKED);
      localStorage.removeItem(LS_LAST_SYNC);
      state.syncStatus = null;
      state.syncError = '';
    }
    renderSyncPanel();
    if (!quiet) showToast('Configuración de sincronización guardada');
    return true;
  } catch (error) {
    if (!quiet) alert(error.message);
    else throw error;
    return false;
  }
}

async function testSyncConnection() {
  if (!navigator.onLine) {
    showToast('Necesitas conexión a Internet');
    return;
  }
  try {
    await saveSyncConfig({ quiet: true });
    els.testSyncButton.disabled = true;
    els.testSyncButton.textContent = 'Comprobando…';
    const provider = activeSyncProvider();
    state.syncStatus = await provider.ping({
      onRetry: ({ nextAttempt }) => { els.testSyncButton.textContent = `Reintentando (${nextAttempt})…`; }
    });
    // Old backends may report no metadata on ping; status is still compatible.
    if (!state.syncStatus || state.syncStatus.protocolVersion >= 2 && state.syncStatus.hasCloud === false) {
      try { state.syncStatus = await provider.status(); } catch (_) {}
    }
    state.syncError = '';
    renderSyncPanel();
    showToast('Conexión con Apps Script correcta');
  } catch (error) {
    console.error(error);
    state.syncStatus = null;
    state.syncError = error.message;
    renderSyncPanel();
    showToast('No se ha podido conectar con Apps Script');
  } finally {
    els.testSyncButton.disabled = false;
    els.testSyncButton.textContent = 'Probar conexión';
  }
}

async function createCloudFromLocal() {
  if (!navigator.onLine || state.syncBusy) return;
  try {
    state.syncBusy = true;
    const provider = activeSyncProvider();
    const status = await provider.status();
    if (status.hasCloud) {
      state.syncStatus = status;
      renderSyncPanel();
      throw new Error('Ya existe una nube HomeTasks. Usa “Usar datos de la nube” para este dispositivo.');
    }
    const local = await buildSyncSnapshot();
    const confirmed = await provider.push(local);
    if (!confirmed) throw new Error('Apps Script no confirmó la creación de la nube.');
    await applySnapshot(mergeSnapshots(local, confirmed), { replace: true });
    localStorage.setItem(LS_CLOUD_LINKED, '1');
    localStorage.setItem(LS_LAST_SYNC, String(Date.now()));
    localStorage.setItem(LS_CLOUD_DIRTY, '0');
    state.syncStatus = await provider.status();
    await loadState();
    renderAll();
    showToast('Nube HomeTasks creada');
  } catch (error) {
    console.error(error);
    alert(`No se ha podido crear la nube.\n\n${error.message}`);
  } finally {
    state.syncBusy = false;
    renderSyncPanel();
  }
}

async function adoptCloudData() {
  if (!navigator.onLine || state.syncBusy) return;
  if (!confirm('¿Usar los datos de la nube en este dispositivo? Antes intentaremos descargar una copia de seguridad de los datos locales.')) return;

  const startedAt = Date.now();
  localStorage.setItem(LS_LAST_SYNC_ATTEMPT, String(startedAt));
  try {
    state.syncBusy = true;
    state.syncError = '';
    setSyncProgress(8, 'Preparando este dispositivo', 'Creando una copia de seguridad de los datos locales antes de sustituirlos.');
    renderSyncPanel();

    const provider = activeSyncProvider();
    const localBackup = await buildSyncSnapshot();

    // On some Android PWAs a programmatic download may be blocked. The backup is
    // useful, but it must never prevent adopting an already existing cloud.
    try {
      downloadSnapshot(localBackup, `HomeTasks_antes_de_nube_${todayISO()}.json`);
    } catch (backupError) {
      console.warn('No se pudo descargar la copia local previa:', backupError);
    }

    setSyncProgress(28, 'Contactando con Apps Script', 'Descargando la copia de HomeTasks almacenada en la nube.');
    const remote = await provider.pull({
      onRetry: ({ nextAttempt }) => {
        setSyncProgress(36, 'Apps Script está tardando', `Reintentando la descarga automáticamente · intento ${nextAttempt} de 3.`);
      }
    });
    if (!remote) throw new Error('La nube HomeTasks está vacía.');

    setSyncProgress(68, 'Datos recibidos', 'Validando la copia de la nube antes de reemplazar los datos locales.');
    const validated = validateSnapshot(remote);

    setSyncProgress(84, 'Aplicando datos de la nube', 'Sustituyendo la base local de este dispositivo.');
    await applySnapshot(validated, { replace: true });

    const completedAt = Date.now();
    localStorage.setItem(LS_CLOUD_LINKED, '1');
    localStorage.setItem(LS_LAST_SYNC, String(completedAt));
    localStorage.setItem(LS_CLOUD_DIRTY, '0');
    state.syncStatus = {
      hasCloud: true,
      updatedAt: Number(validated.updatedAt || completedAt),
      homeId: validated.homeId || null,
      provider: provider.name,
    };

    await loadState();
    recordSyncResult(true, 'Datos de la nube cargados');
    renderAll();
    finishSyncProgress(true, 'Dispositivo vinculado', `Datos de la nube cargados en ${((Date.now() - startedAt) / 1000).toFixed(1)} s.`);
    showToast('Datos de la nube cargados');
  } catch (error) {
    console.error(error);
    recordSyncResult(false, error.message);
    state.syncError = error.message;
    finishSyncProgress(false, 'No se pudo usar la nube', error.message);
    showToast('No se pudieron cargar los datos de la nube');
  } finally {
    state.syncBusy = false;
    renderSyncPanel();
  }
}

async function syncNow(options = {}) {
  const silent = options?.silent === true;
  if (!navigator.onLine || !syncConfigured() || !syncLinked()) return;
  if (state.syncBusy) {
    if (localStorage.getItem(LS_CLOUD_DIRTY) === '1') scheduleSyncSoon(1200);
    return;
  }

  const startedAt = Date.now();
  localStorage.setItem(LS_LAST_SYNC_ATTEMPT, String(startedAt));
  let syncedRevision = getLocalRevision();
  try {
    state.syncBusy = true;
    state.syncError = '';
    if (!silent) setSyncProgress(6, 'Preparando sincronización', 'Leyendo los datos locales de este dispositivo.');
    renderSyncPanel();

    const provider = activeSyncProvider();
    const dirtyAtStart = localStorage.getItem(LS_CLOUD_DIRTY) === '1';
    let local = await buildSyncSnapshot();

    if (!silent) setSyncProgress(18, 'Contactando con Apps Script', 'Solicitando la copia más reciente de la nube.');
    const remote = await provider.pull({
      onRetry: ({ nextAttempt }) => {
        if (!silent) setSyncProgress(24, 'Apps Script está tardando', `Reintentando la descarga automáticamente · intento ${nextAttempt} de 3.`);
      }
    });

    if (!silent) setSyncProgress(43, 'Comparando cambios', 'Fusionando los cambios del PC, móvil y nube sin perder datos.');
    let finalSnapshot = remote ? mergeSnapshots(local, remote) : local;
    let mustPush = dirtyAtStart;

    // A local modification may happen while the network request is in flight.
    // Re-read and merge until the local revision is stable, so a sync can never
    // overwrite a completion/history entry created during that same sync.
    for (let pass = 0; pass < 3; pass++) {
      const currentRevision = getLocalRevision();
      if (currentRevision !== syncedRevision) {
        syncedRevision = currentRevision;
        mustPush = true;
        if (!silent) setSyncProgress(52 + pass * 6, 'Incorporando cambios recientes', 'Se detectaron cambios locales mientras se sincronizaba. Se incorporan antes de continuar.');
        local = await buildSyncSnapshot();
        finalSnapshot = mergeSnapshots(local, finalSnapshot);
      }

      if (!mustPush) break;
      if (!silent) setSyncProgress(64 + pass * 5, 'Enviando cambios', 'Guardando en la nube la versión fusionada.');
      const confirmed = await provider.push(finalSnapshot, {
        onRetry: ({ nextAttempt }) => {
          if (!silent) setSyncProgress(72, 'Esperando a Apps Script', `Google está tardando en responder. Reintento automático ${nextAttempt}.`);
        }
      });
      if (confirmed) finalSnapshot = mergeSnapshots(finalSnapshot, confirmed);

      const afterPushRevision = getLocalRevision();
      if (afterPushRevision === syncedRevision) {
        mustPush = false;
        break;
      }
      syncedRevision = afterPushRevision;
      mustPush = true;
      local = await buildSyncSnapshot();
      finalSnapshot = mergeSnapshots(local, finalSnapshot);
    }

    // One final local merge protects changes made after the last confirmation.
    const revisionBeforeApply = getLocalRevision();
    if (revisionBeforeApply !== syncedRevision) {
      syncedRevision = revisionBeforeApply;
      const latestLocal = await buildSyncSnapshot();
      finalSnapshot = mergeSnapshots(latestLocal, finalSnapshot);
      mustPush = true;
    }

    if (!silent) setSyncProgress(88, 'Aplicando cambios', 'Actualizando la base local sin borrar cambios creados durante la sincronización.');
    await applySnapshot(finalSnapshot, { replace: false });

    const stable = getLocalRevision() === syncedRevision && !mustPush;
    localStorage.setItem(LS_CLOUD_DIRTY, stable ? '0' : '1');
    const completedAt = Date.now();
    localStorage.setItem(LS_LAST_SYNC, String(completedAt));
    state.syncStatus = {
      hasCloud: true,
      updatedAt: Number(finalSnapshot.updatedAt || completedAt),
      homeId: finalSnapshot.homeId || null,
      provider: provider.name,
    };
    await loadState();
    recordSyncResult(true, stable ? 'Sincronización completada' : 'Cambios locales pendientes de confirmación');
    renderAll();

    if (!stable) scheduleSyncSoon(900);
    if (!silent) {
      finishSyncProgress(true, stable ? 'Sincronización completada' : 'Cambios protegidos', stable
        ? `Proceso terminado en ${((Date.now() - startedAt) / 1000).toFixed(1)} s.`
        : 'Se detectó un cambio mientras sincronizabas. HomeTasks lo ha conservado y lo enviará automáticamente.');
      showToast(stable ? 'Sincronización completada' : 'Cambios guardados · sincronizando de nuevo');
    }
  } catch (error) {
    console.error(error);
    localStorage.setItem(LS_CLOUD_DIRTY, '1');
    recordSyncResult(false, error.message);
    state.syncError = error.message;
    scheduleSyncSoon(2500);
    if (!silent) {
      finishSyncProgress(false, 'Error de sincronización', error.message);
      showToast('Sincronización incompleta');
    }
  } finally {
    state.syncBusy = false;
    if (els.syncNowButton) els.syncNowButton.disabled = false;
    renderSyncPanel();
  }
}

function unlinkCloudDevice() {
  if (!confirm('¿Desvincular este dispositivo de la nube? Los datos locales no se borrarán.')) return;
  localStorage.removeItem(LS_CLOUD_LINKED);
  localStorage.removeItem(LS_LAST_SYNC);
  state.syncStatus = null;
  renderSyncPanel();
  showToast('Dispositivo desvinculado');
}

function setupAutoSync() {
  const canAutoSync = () => els.autoSyncToggle?.checked && syncConfigured() && syncLinked() && navigator.onLine;

  // Pull shortly after startup so a second device sees remote changes without waiting.
  setTimeout(() => {
    if (canAutoSync()) syncNow({ silent: true });
  }, 1200);

  // While HomeTasks is open, refresh the cloud periodically.
  setInterval(() => {
    if (canAutoSync()) syncNow({ silent: true });
  }, 60000);

  // Always refresh when the app returns to the foreground, even when this device
  // has no local changes. This is essential for receiving changes from other devices.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && canAutoSync()) syncNow({ silent: true });
  });

  window.addEventListener('online', () => {
    if (canAutoSync()) setTimeout(() => syncNow({ silent: true }), 500);
  });
}

async function forceAppUpdate() {
  if (!confirm('¿Forzar la descarga de la versión publicada más reciente? Tus tareas, URL de Apps Script, clave y preferencias se conservarán.')) return;
  const button = els.forceAppUpdateButton;
  const original = button?.textContent || 'Forzar actualización de la aplicación';
  if (button) {
    button.disabled = true;
    button.textContent = 'Limpiando caché…';
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('hometasks-')).map(key => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    localStorage.setItem('hometasks-last-forced-update', String(Date.now()));
    const url = new URL(window.location.href);
    url.searchParams.set('refresh', String(Date.now()));
    window.location.replace(url.toString());
  } catch (error) {
    console.error(error);
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
    showToast('No se pudo forzar la actualización');
  }
}

function setupTheme() {
  const saved = localStorage.getItem('hometasks-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  els.themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('hometasks-theme', next);
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    els.offlineReady.textContent = 'No compatible';
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    els.offlineReady.textContent = 'Preparado';
    return registration;
  } catch (error) {
    console.warn('Service Worker no registrado:', error);
    els.offlineReady.textContent = 'Requiere HTTP(S)';
  }
}

function setupInstallPrompt() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) els.installHelp.textContent = 'En iPhone/iPad: Safari > Compartir > Anadir a pantalla de inicio.';

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
    els.installHelp.textContent = 'Este dispositivo permite instalar HomeTasks como aplicacion.';
  });

  els.installButton.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    els.installButton.hidden = true;
  });
}

function setupEvents() {
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  [els.roomFilter, els.statusFilter, els.assigneeFilter].forEach(el => el.addEventListener('change', renderTasks));
  els.taskSearch.addEventListener('input', renderTasks);
  [els.historyUserFilter, els.historyRoomFilter].forEach(el => el.addEventListener('change', renderHistory));
  els.routineRoomFilter.addEventListener('change', renderRoutines);
  els.routineSearch.addEventListener('input', renderRoutines);
  els.planAssigneeFilter.addEventListener('change', renderPlan);
  els.todayAssigneeFilter?.addEventListener('change', renderToday);
  els.planPrevWeek.addEventListener('click', () => { state.planWeekOffset -= 1; renderPlan(); });
  els.planTodayWeek.addEventListener('click', () => { state.planWeekOffset = 0; renderPlan(); });
  els.planNextWeek.addEventListener('click', () => { state.planWeekOffset += 1; renderPlan(); });

  els.newTaskButton.addEventListener('click', () => openTaskDialog());
  els.todayNewTaskButton?.addEventListener('click', () => openTaskDialog(null, todayISO()));
  els.todayOpenPlanButton?.addEventListener('click', () => switchView('plan'));
  els.syncHeaderBadge?.addEventListener('click', () => { switchView('settings'); setTimeout(() => els.syncSettingsCard?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); });
  els.newRoutineButton.addEventListener('click', () => openRoutineDialog());
  els.closeDialogButton.addEventListener('click', () => { state.editingTaskId = null; els.taskDialog.close(); });
  els.cancelDialogButton.addEventListener('click', () => { state.editingTaskId = null; els.taskDialog.close(); });
  els.taskForm.addEventListener('submit', saveTask);
  els.taskRecurrence.addEventListener('change', updateCustomRecurrenceVisibility);
  els.routineRecurrence.addEventListener('change', updateCustomRecurrenceVisibility);
  els.routineForm.addEventListener('submit', saveRoutine);
  els.closeRoutineDialogButton.addEventListener('click', () => { state.editingRoutineId = null; els.routineDialog.close(); });
  els.cancelRoutineDialogButton.addEventListener('click', () => { state.editingRoutineId = null; els.routineDialog.close(); });

  els.clearRoomFilterButton.addEventListener('click', () => {
    els.roomFilter.value = 'all';
    renderTasks();
  });

  els.addUserForm.addEventListener('submit', addUser);
  els.saveHouseNameButton.addEventListener('click', saveHouseName);
  els.saveRoomNamesButton.addEventListener('click', saveRoomNames);
  els.generateSyncKeyButton.addEventListener('click', () => {
    els.syncHouseKey.type = 'text';
    els.syncHouseKey.value = generateHouseKey();
    els.syncHouseKey.focus();
    els.syncHouseKey.select();
    showToast('Clave generada. Cópiala también en Code.gs');
  });
  els.saveSyncConfigButton.addEventListener('click', saveSyncConfig);
  els.testSyncButton.addEventListener('click', testSyncConnection);
  els.createCloudButton.addEventListener('click', createCloudFromLocal);
  els.adoptCloudButton.addEventListener('click', adoptCloudData);
  els.syncNowButton.addEventListener('click', () => syncNow());
  els.unlinkCloudButton.addEventListener('click', unlinkCloudDevice);
  els.autoSyncToggle.addEventListener('change', () => {
    localStorage.setItem(LS_AUTO_SYNC, els.autoSyncToggle.checked ? '1' : '0');
    renderSyncPanel();
  });
  els.exportBackupButton.addEventListener('click', exportLocalBackup);
  els.importBackupButton.addEventListener('click', () => els.importBackupFile.click());
  els.importBackupFile.addEventListener('change', () => importLocalBackup(els.importBackupFile.files?.[0]));
  els.forceAppUpdateButton?.addEventListener('click', forceAppUpdate);

  els.resetButton.addEventListener('click', async () => {
    if (!confirm('¿Restablecer todos los datos locales de HomeTasks V5 en este dispositivo?')) return;
    await resetDatabase();
    await ensureV1Data();
    await ensureV2Data();
    await ensureV3Data();
    await ensureV4Data();
    await ensureV41Data();
    await loadState();
    els.roomFilter.value = 'all';
    els.statusFilter.value = 'pending';
    els.assigneeFilter.value = 'all';
    renderAll();
    showToast('V5 restablecida');
  });

  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
}

async function init() {
  cacheElements();
  setupTheme();
  updateConnection();
  setupEvents();
  setupInstallPrompt();
  await ensureV1Data();
  await ensureV2Data();
  await ensureV3Data();
  await ensureV4Data();
  await ensureV41Data();
  await loadState();
  renderAll();
  setupAutoSync();
  await setupServiceWorker();
}

init().catch(error => {
  console.error(error);
  document.body.innerHTML = `<main style="padding:24px;font-family:system-ui"><h1>HomeTasks</h1><p>No se ha podido iniciar la base local.</p><pre>${escapeHTML(error.message)}</pre></main>`;
});
