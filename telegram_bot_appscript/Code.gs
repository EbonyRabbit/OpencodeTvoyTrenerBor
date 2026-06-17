const CONFIG = {
  SPREADSHEET_ID: '1XVoPSYgRx-liLPSZsmMhOva0AIxs60U6Hf7Cm8lLxK4',
  DEFAULT_DRIVE_ROOT_FOLDER_ID: '1V6L7BxLFgOxXNEUBBOf7amcKg_lMJzQh',
  PROGRAM_START_DATE: '2026-06-01',
  DEFAULT_TIMEZONE: 'Europe/Moscow',
  DEFAULT_PHOTO_FOLDER_NAME: 'Fitness Client Photos',
  SHEETS: {
    CLIENTS: 'Bot Clients',
    STATE: 'Bot State',
    SCHEDULE: 'Bot Schedule',
    RAW_RESULTS: 'Exercise Results Raw',
    PHOTO_UPLOADS: 'Photo Uploads',
    BODY_PROGRESS: 'Прогресс тела',
    PHOTOS: 'Фото и состав тела',
    LOGS: 'Bot Logs',
    PROGRAM_SCHEDULE: 'Bot Program Schedule',
    CHECKINS: 'Check-ins',
    PROGRAMS: 'Bot Programs',
  },
};

function getCommonSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getClientSpreadsheet(client) {
  if (client && client.spreadsheet_id) {
    return SpreadsheetApp.openById(client.spreadsheet_id);
  }
  return getCommonSpreadsheet();
}

function getSheetByName(client, sheetName) {
  return getClientSpreadsheet(client).getSheetByName(sheetName);
}

function getCommonSheet(sheetName) {
  return getCommonSpreadsheet().getSheetByName(sheetName);
}

function findClientById(clientId) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet);
  return clients.find((client) => String(client.client_id) === String(clientId));
}

function findClientByTelegramId(telegramId) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet);
  return clients.find((client) => String(client.telegram_id) === String(telegramId));
}

function connectClientByCode(chatId, code) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet);
  const client = clients.find((c) => String(c.connect_code).trim().toUpperCase() === String(code).trim().toUpperCase());
  if (!client) {
    sendMessage(chatId, 'Неверный код подключения. Проверьте код или свяжитесь с тренером.');
    return;
  }

  clients.forEach((c) => {
    if (String(c.telegram_id) === String(chatId) && String(c.client_id) !== String(client.client_id)) {
      updateClientField(c, 'telegram_id', '');
    }
  });

  updateClientField(client, 'telegram_id', String(chatId));
  updateClientField(client, 'status', 'active');
  clearState(chatId);

  if (client.spreadsheet_id) {
    try { ensureBotProgramSchedule(client); } catch (e) {
      Logger.log('ensureBotProgramSchedule error for ' + client.client_id + ': ' + e.message);
    }
  }

  sendMessage(chatId, 'Вы успешно подключены! Добро пожаловать в систему онлайн-коучинга.\n\nНаберите /menu для списка команд.');
  logBot(client.client_id, chatId, 'client_connected', 'success', 'code=' + code);
}

function ensureBotProgramSchedule(client) {
  if (!client || !client.spreadsheet_id) return;
  var clientSs = SpreadsheetApp.openById(client.spreadsheet_id);
  var existing = clientSs.getSheetByName(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  if (existing && existing.getLastRow() >= 5) return;

  if (existing) clientSs.deleteSheet(existing);
  var sheet = clientSs.insertSheet(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  sheet.hideSheet();

  var headers = ['client_id', 'program_week', 'cycle', 'week_number', 'sheet_name', 'start_date', 'end_date', 'focus', 'status', 'notes'];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold');

  var weekSheets = [];
  clientSs.getSheets().forEach(function(s) {
    var m = s.getName().match(/^W(\d+)$/);
    if (m) weekSheets.push({ num: parseInt(m[1]), name: s.getName() });
  });
  weekSheets.sort(function(a, b) { return a.num - b.num; });

  if (weekSheets.length === 0) return;

  var startDate = new Date();
  var rows = weekSheets.map(function(ws, i) {
    var d = new Date(startDate);
    d.setDate(d.getDate() + i * 7);
    var de = new Date(d);
    de.setDate(de.getDate() + 6);
    var focus = '';
    try {
      var w = clientSs.getSheetByName(ws.name);
      if (w) focus = String(w.getRange('A2').getDisplayValue() || '');
    } catch(e) {}
    return [client.client_id, ws.num, '', ws.num, ws.name, fmtDate(d), fmtDate(de), focus, 'active', ''];
  });
  sheet.getRange(5, 1, rows.length, rows[0].length).setValues(rows);
}

function findHeaderRow(sheet, requiredHeaders) {
  const rowsToCheck = Math.min(sheet.getLastRow(), 20);
  const values = sheet.getRange(1, 1, rowsToCheck, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const ok = requiredHeaders.every((header) => row.indexOf(header) !== -1);
    if (ok) return i + 1;
  }
  return null;
}

function findOrCreateWeekRow(sheet, headerRow, weekCol, weekNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow > headerRow) {
    const values = sheet.getRange(headerRow + 1, weekCol, lastRow - headerRow, 1).getDisplayValues();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0]) === String(weekNumber)) return headerRow + 1 + i;
    }
  }
  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, weekCol).setValue(weekNumber);
  return newRow;
}

function getActiveWeekSheetName(client) {
  const program = getActiveProgramForClient(client);
  const ss = getClientSpreadsheet(client);
  const candidates = ['Гип W', 'Инт W', 'W'];
  if (program.active_cycle === 'Гипертрофия') candidates.unshift('Гип W');
  for (const prefix of candidates) {
    const name = prefix + program.active_week;
    if (ss.getSheetByName(name)) return name;
  }
  return (program.active_cycle === 'Гипертрофия' ? 'Гип W' : 'W') + program.active_week;
}

function getActiveProgramForClient(client) {
  const ss = getClientSpreadsheet(client);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  if (!sheet) {
    return { active_cycle: client.active_cycle, active_week: client.active_week };
  }
  const rows = getSheetObjects(sheet).filter((row) => row.client_id === client.client_id && row.status === 'active');
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const today = parseDateKey(todayKey);
  const active = rows.find((row) => {
    const start = parseDateKey(row.start_date);
    const end = parseDateKey(row.end_date);
    return start && end && today >= start && today <= end;
  });
  if (!active) {
    return { active_cycle: client.active_cycle, active_week: client.active_week };
  }
  return {
    active_cycle: active.cycle,
    active_week: Number(active.week_number),
  };
}

function parseDateKey(value) {
  const text = String(value || '').trim();
  const matchIso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchIso) return new Date(Number(matchIso[1]), Number(matchIso[2]) - 1, Number(matchIso[3]));
  const matchRu = text.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (matchRu) return new Date(Number(matchRu[3]), Number(matchRu[2]) - 1, Number(matchRu[1]));
  return null;
}

function getStateByTelegramId(telegramId) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.STATE);
  const states = getSheetObjects(sheet);
  return states.find((state) => String(state.telegram_id) === String(telegramId));
}

function upsertState(state) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.STATE);
  ensureStateHeaders(sheet, Object.keys(state).concat(['updated_at']));
  const headers = sheet.getRange(4, 1, 1, sheet.getLastColumn()).getValues()[0];
  const states = getSheetObjects(sheet);
  const index = states.findIndex((item) => String(item.telegram_id) === String(state.telegram_id));
  const row = headers.map((header) => state[header] || '');
  row[headers.indexOf('updated_at')] = new Date();

  if (index === -1) sheet.appendRow(row);
  else sheet.getRange(index + 5, 1, 1, headers.length).setValues([row]);
}

function ensureStateHeaders(sheet, keys) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(4, 1, 1, lastCol).getValues()[0].filter(String);
  let nextCol = headers.length + 1;
  keys.forEach((key) => {
    if (key && headers.indexOf(key) === -1) {
      sheet.getRange(4, nextCol).setValue(key);
      headers.push(key);
      nextCol++;
    }
  });
}

function updateStateFields(telegramId, fields) {
  const state = getStateByTelegramId(telegramId) || { telegram_id: telegramId };
  Object.keys(fields).forEach((key) => state[key] = fields[key]);
  upsertState(state);
}

function clearState(telegramId) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.STATE);
  const states = getSheetObjects(sheet);
  const index = states.findIndex((item) => String(item.telegram_id) === String(telegramId));
  if (index !== -1) sheet.deleteRow(index + 5);
}

function appendRow(sheetName, row, optSs) {
  const ss = optSs || getCommonSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  sheet.appendRow(row);
}

function getSheetObjects(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 5) return [];
  const headers = sheet.getRange(4, 1, 1, lastCol).getDisplayValues()[0];
  const values = sheet.getRange(5, 1, lastRow - 4, lastCol).getDisplayValues();
  return values
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => headers.reduce((obj, header, index) => {
      obj[header] = row[index];
      return obj;
    }, {}));
}

function sendDueMessages() {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet).filter((client) => client.status === 'active' && client.telegram_id && (client.payment_status === 'paid' || !client.payment_status || client.spreadsheet_id));
  const now = new Date();

  const weekDays = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

  clients.forEach((client) => {
    const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
    const todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const todayWeekDay = weekDays[parseInt(Utilities.formatDate(now, tz, 'u'))];

    if (client.morning_time) {
      const sendKey = 'morning_sent_' + client.client_id + '_' + todayKey;
      const alreadySent = PropertiesService.getScriptProperties().getProperty(sendKey);
      if (!alreadySent && isTimeWithinWindow(now, tz, client.morning_time, 2)) {
        const sent = sendAutomaticWorkout(client);
        if (sent) {
          PropertiesService.getScriptProperties().setProperty(sendKey, new Date().toISOString());
          logBot(client.client_id, client.telegram_id, 'morning_notification_sent', 'success', client.morning_time);
        }
      }
    }

    if (client.measurement_time && client.measurement_day) {
      if (isMeasurementsSuppressed(client)) return;
      const measKey = 'meas_sent_' + client.client_id + '_' + todayKey;
      const measSent = PropertiesService.getScriptProperties().getProperty(measKey);
      if (!measSent && String(client.measurement_day).trim() === todayWeekDay && isTimeWithinWindow(now, tz, client.measurement_time, 2)) {
        sendMeasurementReminder(client);
        PropertiesService.getScriptProperties().setProperty(measKey, new Date().toISOString());
        logBot(client.client_id, client.telegram_id, 'measurement_reminder_sent', 'success', client.measurement_time);
      }
    }

    var workoutToday = getTodayWorkout(client, false);
    if (workoutToday && workoutToday.exercises.length > 0) {
      var skippedKey = 'workout_skipped_' + client.client_id + '_' + todayKey;
      var completedKey = 'workout_completed_' + client.client_id + '_' + todayKey;
      var polledKey = 'workout_polled_' + client.client_id + '_' + todayKey;
      if (!PropertiesService.getScriptProperties().getProperty(skippedKey) && !PropertiesService.getScriptProperties().getProperty(completedKey) && !PropertiesService.getScriptProperties().getProperty(polledKey) && isTimeWithinWindow(now, tz, '20:00', 4)) {
        sendMessage(client.telegram_id, '👋 Привет! Ты сегодня тренировался?', inlineKeyboard([[button('Да, тренируюсь', 'poll_workout_now')], [button('Пропустить', 'skip_workout')], [button('Перенести', 'poll_reschedule')]]));
        PropertiesService.getScriptProperties().setProperty(polledKey, new Date().toISOString());
        logBot(client.client_id, client.telegram_id, 'evening_poll_sent', 'info', '');
      }
    }
  });

  fireDueMeasurementReminders();
}
function startCheckin(client) {
  upsertState({
    client_id: client.client_id,
    telegram_id: client.telegram_id,
    action: 'checkin',
    step: 'wellbeing',
  });
  sendMessage(client.telegram_id, 'Еженедельный чек-ин. Как оцениваешь самочувствие за прошедшую неделю? (1 — ужасно, 10 — отлично)');
}

function continueCheckin(client, state, text) {
  const steps = ['wellbeing', 'sleep', 'stress', 'nutrition_adherence', 'missed_workouts', 'complaints', 'comment'];
  const prompts = {
    sleep: 'Сколько часов в среднем спал? (например: 7)',
    stress: 'Уровень стресса? (1 — полный покой, 10 — максимальный стресс)',
    nutrition_adherence: 'Насколько придерживался плана питания? (0–100%)',
    missed_workouts: 'Сколько тренировок пропустил? (0, 1, 2...)',
    complaints: 'Есть жалобы, боли, дискомфорт?',
    comment: 'Любой комментарий для тренера?',
  };
  const fieldMap = {
    wellbeing: 'temp_weight',
    sleep: 'temp_sets',
    stress: 'temp_reps',
    nutrition_adherence: 'temp_rpe',
    missed_workouts: 'temp_comment',
    complaints: 'exercise_name',
    comment: 'day_title',
  };

  const currentIndex = steps.indexOf(state.step);
  updateStateFields(client.telegram_id, { [fieldMap[state.step]]: text, step: steps[currentIndex + 1] || 'done' });

  if (currentIndex < steps.length - 1) {
    if (currentIndex === 0) {
      sendMessage(client.telegram_id, prompts[steps[currentIndex + 1]]);
    } else {
      sendMessage(client.telegram_id, prompts[steps[currentIndex + 1]]);
    }
    return;
  }

  const finalState = getStateByTelegramId(client.telegram_id);
  saveCheckin(client, finalState);
  clearState(client.telegram_id);
  sendMessage(client.telegram_id, 'Чек-ин записан. Спасибо!');
}

function saveCheckin(client, state) {
  const ss = getClientSpreadsheet(client);
  let sheet = ss.getSheetByName(CONFIG.SHEETS.CHECKINS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.CHECKINS);
    const headers = [
      'Дата', 'client_id', 'Неделя', 'Самочувствие', 'Сон (ч)', 'Стресс',
      'Питание (%)', 'Пропущено тренировок', 'Жалобы', 'Комментарий',
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    new Date(),
    client.client_id,
    client.active_week || '',
    state.temp_weight,
    state.temp_sets,
    state.temp_reps,
    state.temp_rpe,
    state.temp_comment,
    state.exercise_name,
    state.day_title,
  ]);
}

function startSettings(client) {
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  const text = [
    'Текущие настройки:',
    '',
    '🕐 Время тренировки: ' + (client.morning_time || 'не задано'),
    '📏 Время замеров: ' + (client.measurement_time || 'не задано'),
    '📅 День замеров: ' + (client.measurement_day || 'не задан'),
    '🌍 Часовой пояс: ' + tz,
    '',
    'Что меняем?',
  ].join('\n');

  upsertState({
    client_id: client.client_id,
    telegram_id: client.telegram_id,
    action: 'settings',
    step: 'select_field',
  });

  sendMessage(client.telegram_id, text, inlineKeyboard([
    [button('🕐 Время тренировки', 'settings_field:morning_time')],
    [button('📏 Время замеров', 'settings_field:measurement_time')],
    [button('📅 День замеров', 'settings_field:measurement_day')],
    [button('🌍 Часовой пояс', 'settings_field:timezone')],
  ]));
}

function showMenu(client) {
  var lines = ['📋 Доступные команды:', ''];
  if (client && (client.payment_status === 'paid' || client.spreadsheet_id)) {
    lines.push('/today — тренировка на сегодня');
    lines.push('/progress — замеры тела и динамика');
    lines.push('/checkin — еженедельный чек-ин');
  } else if (client && client.payment_status === 'pending') {
    lines.push('⏳ Программа ожидает подтверждения оплаты.');
  } else {
    lines.push('/programs — выбрать программу тренировок');
  }
  lines.push('/myprogram — моя программа');
  lines.push('/settings — настройки уведомлений');
  lines.push('/menu — список команд');
  lines.push('');
  lines.push('Есть вопросы? Пиши тренеру.');
  sendMessage(client.telegram_id, lines.join('\n'));
}

function setupBotCommands() {
  const commands = [
    { command: 'start', description: 'Главное меню / подключиться' },
    { command: 'programs', description: 'Каталог программ' },
    { command: 'myprogram', description: 'Моя программа' },
    { command: 'today', description: 'Тренировка на сегодня' },
    { command: 'progress', description: 'Замеры тела и динамика' },
    { command: 'checkin', description: 'Еженедельный чек-ин' },
    { command: 'settings', description: 'Настройки уведомлений' },
    { command: 'menu', description: 'Список команд' },
  ];

  const url = 'https://api.telegram.org/bot' + getBotToken() + '/setMyCommands';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ commands: commands }),
    muteHttpExceptions: true,
  });
  Logger.log(response.getContentText());
}

function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    if (update.callback_query) { handleCallback(update.callback_query); return ContentService.createTextOutput('ok'); }
    if (!update.message) return ContentService.createTextOutput('ok');
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const text = (msg.text || '').trim();

    const state = getStateByTelegramId(chatId);
    const client = findClientByTelegramId(chatId);

    if (text === '/start') {
      if (state && state.action === 'connect') { clearState(chatId); }
      if (state && (state.action === 'register_select' || state.action === 'await_name')) { clearState(chatId); }

      if (!client) {
        showWelcome(chatId);
        return;
      }

      if (client.status !== 'active') {
        upsertState({ telegram_id: chatId, action: 'connect', step: 'await_code' });
        sendMessage(chatId, 'Введите ваш персональный код подключения, который выдал тренер.');
        return;
      }

      showMenu(client);
      return;
    }

    if (state && state.action === 'register_select') {
      handleProgramSelection(chatId, text);
      return;
    }

    if (state && state.action === 'await_name') {
      registerClient(chatId, state.program_id, text);
      return;
    }

    if (state && state.action === 'connect') {
      connectClientByCode(chatId, text);
      return;
    }

    if (!client) {
      sendMessage(chatId, 'Сначала подключитесь через /start.');
      return;
    }

    if (client.status !== 'active') {
      sendMessage(chatId, 'Ваша подписка истекла. Для продления свяжитесь с тренером.');
      return;
    }

    if (text === '/programs') { showPrograms(chatId); return; }
    if (text === '/myprogram') { showMyProgram(client); return; }
    if (text === '/today') {
      if (client.payment_status !== 'paid' && !client.spreadsheet_id) { sendMessage(chatId, 'Программа ещё не активирована. Ожидайте подтверждения оплаты.'); return; }
      sendTodayWorkout(client); return;
    }
    if (text === '/progress') {
      if (client.payment_status !== 'paid' && !client.spreadsheet_id) { sendMessage(chatId, 'Программа ещё не активирована.'); return; }
      showProgressMenu(client); return;
    }
    if (text === '/checkin') {
      if (client.payment_status !== 'paid' && !client.spreadsheet_id) { sendMessage(chatId, 'Программа ещё не активирована.'); return; }
      startCheckin(client); return;
    }
    if (text === '/settings' && client) { startSettings(client); return; }
    if (text === '/menu' && client) { showMenu(client); return; }
    if (text === '/debug_today' && client) {
      if (client.payment_status !== 'paid' && !client.spreadsheet_id) { sendMessage(chatId, 'Программа ещё не активирована.'); return; }
      sendTodayDebug(client); return;
    }

    if (state) {
      if (state.action === 'checkin') { continueCheckin(client, state, text); return; }
      if (state.action === 'measurements') { continueMeasurements(client, state, text); return; }
      if (state.action === 'exercise_log') { continueExerciseLogging(client, state, text); return; }
      if (state.action === 'skip_reason') { saveWorkoutSkip(client, text); clearState(client.telegram_id); sendMessage(chatId, 'Тренировка пропущена. Причина записана. Отдыхайте!'); return; }
      if (state.action === 'photos' && msg.photo) { continuePhotoUpload(client, state, msg); return; }
    }

    const settingsField = PropertiesService.getScriptProperties().getProperty('settings_chat_' + chatId);
    if (settingsField) {
      PropertiesService.getScriptProperties().deleteProperty('settings_chat_' + chatId);
      continueSettings(client, settingsField, text);
      return;
    }

    if (msg.photo) {
      const state2 = getStateByTelegramId(chatId);
      if (state2 && state2.action === 'photos') { continuePhotoUpload(client, state2, msg); return; }
    }

    if (!state || !state.action) {
      sendMessage(chatId, 'Неизвестная команда. Наберите /menu.');
      return;
    }
  } catch (err) {
    Logger.log('doPost error: ' + err + ' ' + err.stack);
  }
  return ContentService.createTextOutput('ok');
}

function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const client = findClientByTelegramId(chatId);
  answerCallback(query.id);

  if (data === 'choose_program') {
    showPrograms(chatId);
    return;
  }

  if (data === 'welcome_connect') {
    upsertState({ telegram_id: chatId, action: 'connect', step: 'await_code' });
    sendMessage(chatId, 'Введите ваш персональный код подключения, который выдал тренер.');
    return;
  }

  if (data === 'welcome_programs') {
    showPrograms(chatId);
    return;
  }

  if (data.indexOf('program_buy:') === 0) {
    var programId = data.split(':')[1];
    upsertState({ telegram_id: chatId, action: 'register_select', program_id: programId });
    showPrograms(chatId);
    sendMessage(chatId, 'Напишите номер программы, которую хотите купить (1, 2, 3...):');
    return;
  }

  if (!client) {
    sendMessage(chatId, 'Сначала подключитесь через /start.');
    return;
  }

  if (client.status !== 'active') {
    sendMessage(chatId, 'Ваша подписка истекла. Для продления свяжитесь с тренером.');
    return;
  }

  if (client.payment_status !== 'paid' && !client.spreadsheet_id) {
    sendMessage(chatId, 'Программа ещё не активирована. Ожидайте подтверждения оплаты.');
    return;
  }

  if (data === 'today_open') {
    showExercise(client, 0);
    return;
  }

  if (data.indexOf('exercise_show:') === 0) {
    showExercise(client, Number(data.split(':')[1]));
    return;
  }

  if (data.indexOf('exercise_log:') === 0) {
    startExerciseLogging(client, Number(data.split(':')[1]));
    return;
  }

  if (data.indexOf('exercise_skip:') === 0) {
    showExercise(client, Number(data.split(':')[1]) + 1);
    return;
  }

  if (data === 'skip_workout') {
    clearState(client.telegram_id);
    updateStateFields(client.telegram_id, { action: 'skip_reason', step: 'reason' });
    sendMessage(chatId, 'Причина пропуска? (напишите или нажмите "Пропустить")', inlineKeyboard([[button('Пропустить вопрос', 'skip_no_reason')]]));
    return;
  }

  if (data === 'skip_no_reason') {
    saveWorkoutSkip(client, '');
    clearState(client.telegram_id);
    sendMessage(chatId, 'Тренировка пропущена. Отдыхайте!');
    return;
  }

  if (data === 'poll_workout_now') {
    showExercise(client, 0);
    return;
  }

  if (data === 'poll_reschedule') {
    sendMessage(chatId, 'Напишите тренеру — он подберёт удобное время для переноса тренировки.');
    return;
  }

  if (data === 'measurements_start') {
    startMeasurements(client);
    return;
  }

  if (data === 'photo_skip') {
    advancePhotoStep(client, 'skipped');
    return;
  }

  if (data === 'measurements_remind_later') {
    scheduleMeasurementReminder(client, chatId);
    return;
  }

  if (data === 'measurements_skip') {
    suppressMeasurementsForToday(client);
    sendMessage(chatId, 'Хорошо, пропускаем замеры сегодня.');
    return;
  }

  if (data === 'progress_dynamics') {
    showProgressDynamics(client);
    return;
  }

  if (data.indexOf('settings_field:') === 0) {
    const field = data.split(':')[1];
    if (field === 'measurement_day') {
      const weekDays = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
      const buttons = weekDays.map((day) => [button(day, 'settings_set_day:' + day)]);
      sendMessage(chatId, 'Выбери день для замеров:', inlineKeyboard(buttons));
    } else {
      PropertiesService.getScriptProperties().setProperty('settings_chat_' + chatId, field);
      const prompts = {
        morning_time: 'Введи новое время утренней тренировки в формате HH:MM (например: 07:00)',
        measurement_time: 'Введи новое время замеров в формате HH:MM (например: 07:30)',
        timezone: 'Введи часовой пояс (например: Europe/Moscow, Europe/Kyiv, Asia/Tokyo)',
      };
      sendMessage(chatId, prompts[field] || 'Введи новое значение:');
    }
    return;
  }

  if (data.indexOf('settings_set_day:') === 0) {
    const day = data.split(':')[1];
    updateClientField(client, 'measurement_day', day);
    sendMessage(chatId, 'День замеров изменён на ' + day + '.');
    return;
  }
}

function continueSettings(client, field, text) {
  let value = text.trim();

  if (field === 'morning_time' || field === 'measurement_time') {
    if (!/^\d{1,2}:\d{2}$/.test(value)) {
      sendMessage(client.telegram_id, 'Неверный формат. Используй HH:MM (например: 07:00).');
      return;
    }
  }

  updateClientField(client, field, value);
  sendMessage(client.telegram_id, 'Настройка сохранена. Чтобы изменить ещё что-то, нажми /settings.');
}

function updateClientField(client, field, value) {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  if (!sheet) return;

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const rawHeaders = sheet.getRange(4, 1, 1, lastCol).getDisplayValues()[0];
  const headers = rawHeaders.map((h) => String(h).trim());
  let colIndex = headers.indexOf(field) + 1;

  if (!colIndex) {
    colIndex = headers.length + 1;
    sheet.getRange(4, colIndex).setValue(field);
    headers.push(field);
    logBot(client.client_id, client.telegram_id, 'settings_column_created', 'info', field + ' at col ' + colIndex);
  }

  const data = getSheetObjects(sheet);
  const rowIndex = data.findIndex((r) => String(r.client_id).trim() === String(client.client_id).trim());
  if (rowIndex === -1) {
    logBot(client.client_id, client.telegram_id, 'settings_client_not_found', 'failed', 'row not found for client_id=' + client.client_id);
    return;
  }

  const rowNum = rowIndex + 5;
  sheet.getRange(rowNum, colIndex).setValue(value);
  logBot(client.client_id, client.telegram_id, 'settings_updated', 'success', field + '=' + value + ' col=' + colIndex + ' row=' + rowNum);
}

function sendTodayWorkout(client) {
  const workout = getTodayWorkout(client, false);
  if (!workout || workout.exercises.length === 0) {
    const restDay = getTodayWorkout(client, false, true);
    if (restDay && restDay.dayTitle) {
      sendMessage(client.telegram_id, 'Сегодня восстановление/выходной. Отдыхайте и набирайтесь сил.');
      return;
    }
    const nearest = getTodayWorkout(client, true);
    if (nearest && nearest.exercises.length > 0) {
      sendMessage(client.telegram_id, 'Сегодня тренировка не запланирована. Ближайшая тренировка:\n' + nearest.dayTitle, inlineKeyboard([[button('Открыть ближайшую', 'today_open')]]));
      return;
    }
    sendMessage(client.telegram_id, 'Сегодня тренировка не найдена. Отправьте /debug_today и пришлите тренеру ответ для проверки.');
    return;
  }
  const text = ['Доброе утро, ' + client.client_name + '.', '', 'Сегодня тренировка:', workout.dayTitle, '', workout.goal || 'Фокус: качественное выполнение плана.'].join('\n');
  sendMessage(client.telegram_id, text, inlineKeyboard([[button('Открыть тренировку', 'today_open')], [button('Замеры / фото', 'measurements_start')], [button('Пропустить тренировку', 'skip_workout')]]));
  logBot(client.client_id, client.telegram_id, 'today_workout_sent', 'success', workout.sheetName);
}

function getTodayWorkout(client, allowFallback, allowRest) {
  const ss = getClientSpreadsheet(client);
  const sheetName = getActiveWeekSheetName(client);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const values = sheet.getDataRange().getDisplayValues();
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  var weekDays = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  var today = weekDays[parseInt(Utilities.formatDate(new Date(), tz, 'u'))];
  const dayBlocks = parseDayBlocks(values);
  const todayBlock = dayBlocks.find((item) => item.dayTitle.indexOf(today) !== -1);
  if (todayBlock) {
    if (todayBlock.exercises.length > 0) return { sheetName, dayTitle: todayBlock.dayTitle, goal: todayBlock.goal, exercises: todayBlock.exercises };
    if (allowRest) return { sheetName, dayTitle: todayBlock.dayTitle, goal: '', exercises: [] };
  }
  if (allowFallback) {
    var todayNum = parseInt(Utilities.formatDate(new Date(), tz, 'u'));
    var dayIndices = dayBlocks.map(function(block) {
      for (var d = 0; d < weekDays.length; d++) {
        if (block.dayTitle.indexOf(weekDays[d]) !== -1) return d;
      }
      return -1;
    });
    Logger.log('getTodayWorkout fallback: todayNum=' + todayNum + ' dayIndices=' + JSON.stringify(dayIndices));
    for (var i = 0; i < dayBlocks.length; i++) {
      if (dayIndices[i] >= 0 && dayIndices[i] > todayNum && dayBlocks[i].exercises.length > 0) {
        return { sheetName, dayTitle: dayBlocks[i].dayTitle, goal: dayBlocks[i].goal, exercises: dayBlocks[i].exercises };
      }
    }
    for (var i = 0; i < dayBlocks.length; i++) {
      if (dayBlocks[i].exercises.length > 0) {
        return { sheetName, dayTitle: dayBlocks[i].dayTitle, goal: dayBlocks[i].goal, exercises: dayBlocks[i].exercises };
      }
    }
  }
  return null;
}

function sendAutomaticWorkout(client) {
  const workout = getTodayWorkout(client, false);
  if (!workout || workout.exercises.length === 0) {
    logBot(client.client_id, client.telegram_id, 'auto_no_workout_today', 'skipped', getActiveWeekSheetName(client));
    return false;
  }
  const text = ['Доброе утро, ' + client.client_name + '.', '', 'Сегодня тренировка:', workout.dayTitle, '', workout.goal || 'Фокус: качественное выполнение плана.'].join('\n');
  sendMessage(client.telegram_id, text, inlineKeyboard([[button('Открыть тренировку', 'today_open')]]));
  logBot(client.client_id, client.telegram_id, 'auto_workout_sent', 'success', workout.sheetName);
  return true;
}

function parseDayBlocks(values) {
  const blocks = [];
  let current = null;
  let headerRow = null;
  for (let i = 0; i < values.length; i++) {
    const first = String(values[i][0] || '').trim();
    const second = String(values[i][1] || '').trim();
    if (isWorkoutDayTitle(first)) {
      current = { dayTitle: first, goal: '', exercises: [] };
      blocks.push(current);
      headerRow = null;
      continue;
    }
    if (current && isGoalRow(first)) { current.goal = first; continue; }
    if (first === 'Раздел' && second === 'Упражнение') { headerRow = i; continue; }
    if (current && headerRow !== null && first && second && first !== 'Раздел' && values[i][2] !== '') {
      current.exercises.push({ row: i + 1, section: values[i][0], exercise: values[i][1], plannedSets: values[i][2], plannedReps: values[i][3], plannedWeight: values[i][4], rpeRir: values[i][5], tempo: values[i][6], rest: values[i][7] });
    }
  }
  return blocks;
}

function isWorkoutDayTitle(text) {
  if (!text) return false;
  return text.indexOf('|') !== -1 && /Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье/i.test(text);
}

function isGoalRow(text) {
  if (!text) return false;
  return text.indexOf('Неделя') !== -1 || text.indexOf('Цель') !== -1 || text.indexOf('Главный контроль') !== -1 || text.indexOf('Объемная работа') !== -1;
}

function showExercise(client, index) {
  const workout = getTodayWorkout(client, true);
  if (!workout || !workout.exercises[index]) {
    const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
    const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    PropertiesService.getScriptProperties().setProperty('workout_completed_' + client.client_id + '_' + todayKey, 'true');
    sendMessage(client.telegram_id, 'Все упражнения завершены. Отличная тренировка!');
    return;
  }
  const ex = workout.exercises[index];
  const lines = [workout.dayTitle, '', 'Упражнение ' + (index + 1) + '/' + workout.exercises.length + ':', '🏋️ ' + ex.exercise, '', 'Подходы: ' + ex.plannedSets + ' × ' + ex.plannedReps, 'Вес: ' + ex.plannedWeight, 'RPE/RIR: ' + ex.rpeRir, 'Темп: ' + ex.tempo, 'Отдых: ' + ex.rest];
  if (ex.section) lines.push('', 'Блок: ' + ex.section);
  sendMessage(client.telegram_id, lines.join('\n'), inlineKeyboard([[button('✅ Выполнил', 'exercise_log:' + index)], [button('⏭ Пропустить', 'exercise_skip:' + index)]]));
}

function startExerciseLogging(client, index) {
  const workout = getTodayWorkout(client, true);
  if (!workout || !workout.exercises[index]) { sendMessage(client.telegram_id, 'Ошибка: упражнение не найдено.'); return; }
  const ex = workout.exercises[index];
  upsertState({ client_id: client.client_id, telegram_id: client.telegram_id, action: 'exercise_log', step: 'sets', exercise_index: '' + index, day_title: workout.dayTitle, sheetName: workout.sheetName, exercise_name: ex.exercise, plannedSets: ex.plannedSets, plannedReps: ex.plannedReps, plannedWeight: ex.plannedWeight });
  sendMessage(client.telegram_id, 'Сколько подходов сделал? (план: ' + ex.plannedSets + ')');
}

function continueExerciseLogging(client, state, text) {
  if (state.step === 'sets') {
    updateStateFields(client.telegram_id, { temp_sets: text, step: 'reps' });
    sendMessage(client.telegram_id, 'Сколько повторений в среднем?');
  } else if (state.step === 'reps') {
    updateStateFields(client.telegram_id, { temp_reps: text, step: 'weight' });
    sendMessage(client.telegram_id, 'С каким весом работал?');
  } else if (state.step === 'weight') {
    updateStateFields(client.telegram_id, { temp_weight: text, step: 'rpe' });
    sendMessage(client.telegram_id, 'RPE от 1 до 10?');
  } else if (state.step === 'rpe') {
    updateStateFields(client.telegram_id, { temp_rpe: text, step: 'comment' });
    sendMessage(client.telegram_id, 'Комментарий (или "-" если без комментария):');
  } else if (state.step === 'comment') {
    updateStateFields(client.telegram_id, { temp_comment: text, step: 'done' });
    const finalState = getStateByTelegramId(client.telegram_id);
    logExerciseResult(client, finalState);
    clearState(client.telegram_id);
    const nextIndex = Number(finalState.exercise_index) + 1;
    showExercise(client, nextIndex);
  }
}

function logExerciseResult(client, state) {
  const ss = getClientSpreadsheet(client);
  const sheetName = state.sheetName;
  const weekSheet = ss.getSheetByName(sheetName);
  if (!weekSheet) return;
  const values = weekSheet.getDataRange().getDisplayValues();
  const ex = null;
  for (let i = 0; i < values.length; i++) {
    if (i + 1 === Number(state.exercise_index) + 0) continue;
  }
  const dayBlocks = parseDayBlocks(values);
  let ex2 = null;
  for (const block of dayBlocks) {
    for (const e of block.exercises) {
      if (e.exercise === state.exercise_name && e.row > 1) { ex2 = e; break; }
    }
    if (ex2) break;
  }
  if (ex2 && ex2.row) {
    var headerRow = findHeaderRow(weekSheet, ['Раздел', 'Упражнение']) || findHeaderRow(weekSheet, ['Блок', 'Упражнение']);
    if (headerRow) {
      var hValues = weekSheet.getRange(headerRow, 1, 1, weekSheet.getLastColumn()).getDisplayValues()[0];
      var factStart = 0;
      var factKeys = ['Факт подходы', 'Факт повторы', 'Факт вес', 'Факт RPE', 'Комментарий'];
      factKeys.forEach(function (key) {
        var idx = hValues.indexOf(key);
        if (idx !== -1 && (factStart === 0 || idx < factStart)) factStart = idx;
      });
      if (factStart > 0) {
        weekSheet.getRange(ex2.row, factStart + 1).setValue(state.temp_sets);
        weekSheet.getRange(ex2.row, factStart + 2).setValue(state.temp_reps);
        weekSheet.getRange(ex2.row, factStart + 3).setValue(state.temp_weight);
        weekSheet.getRange(ex2.row, factStart + 4).setValue(state.temp_rpe);
        weekSheet.getRange(ex2.row, factStart + 5).setValue(state.temp_comment);
      } else {
        weekSheet.getRange(ex2.row, 9).setValue(state.temp_sets);
        weekSheet.getRange(ex2.row, 10).setValue(state.temp_reps);
        weekSheet.getRange(ex2.row, 11).setValue(state.temp_weight);
        weekSheet.getRange(ex2.row, 12).setValue(state.temp_rpe);
        weekSheet.getRange(ex2.row, 13).setValue(state.temp_comment);
      }
    } else {
      weekSheet.getRange(ex2.row, 9).setValue(state.temp_sets);
      weekSheet.getRange(ex2.row, 10).setValue(state.temp_reps);
      weekSheet.getRange(ex2.row, 11).setValue(state.temp_weight);
      weekSheet.getRange(ex2.row, 12).setValue(state.temp_rpe);
      weekSheet.getRange(ex2.row, 13).setValue(state.temp_comment);
    }
  }
  appendRow(CONFIG.SHEETS.RAW_RESULTS, [new Date(), client.client_id, client.active_cycle, client.active_week, state.day_title, Number(state.exercise_index) + 1, state.exercise_name, '', '', '', state.temp_sets, state.temp_reps, state.temp_weight, state.temp_rpe, state.temp_comment, sheetName, ex2 ? ex2.row : ''], ss);
}

function startMeasurements(client) {
  upsertState({ client_id: client.client_id, telegram_id: client.telegram_id, action: 'measurements', step: 'weight', week: client.active_week });
  sendMessage(client.telegram_id, 'Начинаем замеры. Вес сегодня утром? Например: 84.6');
}

function continueMeasurements(client, state, text) {
  const steps = ['weight', 'waist', 'abdomen', 'chest', 'hips', 'glutes', 'left_thigh', 'right_thigh', 'left_arm', 'right_arm', 'body_fat', 'muscle_mass', 'visceral_fat', 'comment'];
  const prompts = { waist: 'Талия, см?', abdomen: 'Живот, см?', chest: 'Грудь, см?', hips: 'Бедра, см?', glutes: 'Ягодицы, см?', left_thigh: 'Левое бедро, см?', right_thigh: 'Правое бедро, см?', left_arm: 'Левая рука, см?', right_arm: 'Правая рука, см?', body_fat: 'Процент жира, если есть. Если нет, напиши -', muscle_mass: 'Мышечная масса, если есть. Если нет, напиши -', visceral_fat: 'Висцеральный жир, если весы показывают. Если нет, напиши -', comment: 'Комментарий по самочувствию/отекам/условиям замера?' };
  const fieldMap = { weight: 'temp_weight', waist: 'temp_sets', abdomen: 'temp_reps', chest: 'temp_rpe', hips: 'temp_comment', glutes: 'exercise_name', left_thigh: 'planned_sets', right_thigh: 'planned_reps', left_arm: 'planned_weight', right_arm: 'rpe_target', body_fat: 'tempo', muscle_mass: 'rest', visceral_fat: 'source_sheet', comment: 'day_title' };
  const currentIndex = steps.indexOf(state.step);
  updateStateFields(client.telegram_id, { [fieldMap[state.step]]: text, step: steps[currentIndex + 1] || 'done' });
  if (currentIndex < steps.length - 1) { sendMessage(client.telegram_id, prompts[steps[currentIndex + 1]]); return; }
  const finalState = getStateByTelegramId(client.telegram_id);
  saveMeasurements(client, finalState);
  upsertState({ client_id: client.client_id, telegram_id: client.telegram_id, action: 'photos', step: 'front', week: client.active_week });
  sendMessage(client.telegram_id, 'Замеры записаны. Теперь отправьте фото спереди.', inlineKeyboard([[button('Пропустить', 'photo_skip')]]));
}

function saveMeasurements(client, state) {
  const row = [new Date(), client.active_week, state.temp_weight, '', state.temp_sets, state.temp_reps, state.temp_rpe, state.temp_comment, state.exercise_name, state.planned_sets, state.planned_reps, state.planned_weight, state.rpe_target, state.tempo, state.rest, state.source_sheet, state.day_title, ''];
  appendRow(CONFIG.SHEETS.BODY_PROGRESS, row, getClientSpreadsheet(client));
}

function showProgressMenu(client) {
  sendMessage(client.telegram_id, 'Прогресс и замеры:', inlineKeyboard([[button('📏 Начать замеры', 'measurements_start')], [button('📊 Динамика', 'progress_dynamics')]]));
}

function showProgressDynamics(client) {
  const ss = getClientSpreadsheet(client);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.BODY_PROGRESS);
  if (!sheet || sheet.getLastRow() < 4) { sendMessage(client.telegram_id, 'Нет данных для отображения динамики. Начните замеры через 📏 Начать замеры.'); return; }
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
  const headers = values[2] || [];
  const dataRows = [];
  for (let i = 3; i < values.length; i++) { if (values[i][0]) dataRows.push(values[i]); }
  const last4 = dataRows.slice(-4);
  if (last4.length === 0) { sendMessage(client.telegram_id, 'Нет полных записей замеров.'); return; }
  const colMap = { 'Вес': 2, 'Талия': 4, 'Живот': 5, 'Грудь': 6, 'Бедра': 7, 'Ягодицы': 8, '% жира': 13 };
  const lines = ['📊 Динамика замеров (последние ' + last4.length + '):', ''];
  for (const [label, colIdx] of Object.entries(colMap)) {
    const vals = last4.map((r) => r[colIdx]).filter((v) => v && v !== '-').map(Number);
    if (vals.length < 2) continue;
    const current = vals[vals.length - 1];
    const previous = vals[0];
    const delta = (current - previous).toFixed(1);
    const arrow = delta > 0 ? '⬆' : delta < 0 ? '⬇' : '➡';
    const sign = delta > 0 ? '+' : '';
    lines.push(label + ': ' + current + ' (' + arrow + ' ' + sign + delta + ')');
  }
  lines.push('', 'Даты: ' + last4.map((r) => r[0]).join(' → '));
  sendMessage(client.telegram_id, lines.join('\n'));
}

function startPhotoUpload(client, state) {
  sendMessage(client.telegram_id, 'Отправьте фото спереди.', inlineKeyboard([[button('Пропустить', 'photo_skip')]]));
}

function continuePhotoUpload(client, state, msg) {
  if (!msg.photo || msg.photo.length === 0) { sendMessage(client.telegram_id, 'Пожалуйста, отправьте фото.'); return; }
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const upload = uploadPhotoToDrive(client, fileId, state.step);
  if (!upload) { sendMessage(client.telegram_id, 'Ошибка загрузки фото. Попробуйте еще раз.'); return; }
  savePhotoUpload(client, state, fileId, upload);
  writePhotoToClientSheet(client, state.step, upload);
  advancePhotoStep(client, 'uploaded');
}

function savePhotoUpload(client, state, fileId, upload) {
  appendRow(CONFIG.SHEETS.PHOTO_UPLOADS, [new Date(), client.client_id, client.active_week, state.step, fileId, upload.fileUrl, upload.folderUrl, CONFIG.SHEETS.PHOTOS, '', 'uploaded', ''], getClientSpreadsheet(client));
}

function writePhotoToClientSheet(client, photoType, upload) {
  const ss = getClientSpreadsheet(client);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.PHOTOS);
  if (!sheet) return;
  const headerRow = findHeaderRow(sheet, ['Неделя', 'Фото спереди', 'Фото сбоку', 'Фото сзади']);
  if (!headerRow) return;
  const headers2 = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const weekCol = headers2.indexOf('Неделя') + 1;
  if (weekCol === 0) return;
  const row = findOrCreateWeekRow(sheet, headerRow, weekCol, client.active_week);
  if (!row) return;
  const colMap = { front: 'Фото спереди', side: 'Фото сбоку', back: 'Фото сзади', body_composition: 'Скрин состава тела' };
  const colHeader = colMap[photoType];
  if (!colHeader) return;
  const col = headers2.indexOf(colHeader) + 1;
  if (col === 0) return;
  sheet.getRange(row, col).setValue(upload.fileUrl);
}

function uploadPhotoToDrive(client, fileId, step) {
  try {
    const blob = UrlFetchApp.fetch('https://api.telegram.org/bot' + getBotToken() + '/getFile?file_id=' + fileId);
    const fileInfo = JSON.parse(blob);
    if (!fileInfo.ok || !fileInfo.result.file_path) return null;
    const fileUrl = 'https://api.telegram.org/file/bot' + getBotToken() + '/' + fileInfo.result.file_path;
    const fileBlob = UrlFetchApp.fetch(fileUrl).getBlob();
    const clientFolder = getOrCreateFolder(client.client_name || client.client_id, getPhotoRootFolder());
    const weekFolder = getOrCreateFolder('W' + client.active_week + ' ' + Utilities.formatDate(new Date(), client.timezone || CONFIG.DEFAULT_TIMEZONE, 'yyyy-MM-dd'), clientFolder);
    const driveFile = weekFolder.createFile(fileBlob);
    driveFile.setName(step + '_' + Utilities.formatDate(new Date(), client.timezone || CONFIG.DEFAULT_TIMEZONE, 'yyyyMMdd_HHmmss'));
    return { fileUrl: driveFile.getUrl(), folderUrl: weekFolder.getUrl() };
  } catch (e) { Logger.log('uploadPhotoToDrive error: ' + e); return null; }
}

function sendTodayDebug(client) {
  const ss = getClientSpreadsheet(client);
  const sheetName = getActiveWeekSheetName(client);
  const sheet = ss.getSheetByName(sheetName);
  let msg = 'Debug today:\nclient=' + client.client_id + '\nsheet=' + sheetName + '\nweek=' + client.active_week + '\ncycle=' + client.active_cycle + '\nsheet_exists=' + !!sheet;
  if (sheet) {
    const values = sheet.getDataRange().getDisplayValues();
    msg += '\ndata_rows=' + values.length + '\ndata_cols=' + (values[0] ? values[0].length : 0);
    const blocks = parseDayBlocks(values);
    msg += '\nday_blocks=' + blocks.length;
    var weekDays = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
    var todayName = weekDays[parseInt(Utilities.formatDate(new Date(), client.timezone || CONFIG.DEFAULT_TIMEZONE, 'u'))];
    msg += '\ntoday=' + todayName;
    blocks.forEach((b, i) => { msg += '\nblock' + i + ': ' + b.dayTitle.substring(0, 40) + ' ex=' + b.exercises.length; if (b.dayTitle.indexOf(todayName) !== -1) msg += ' ← TODAY'; });
    var tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
    var todayNum = parseInt(Utilities.formatDate(new Date(), tz, 'u'));
    msg += '\ntodayNum=' + todayNum;
    var dayIndices = blocks.map(function(b) {
      for (var d = 0; d < weekDays.length; d++) { if (b.dayTitle.indexOf(weekDays[d]) !== -1) return d; }
      return -1;
    });
    msg += '\ndayIndices=' + JSON.stringify(dayIndices);
    for (var idx = 0; idx < blocks.length; idx++) {
      if (dayIndices[idx] >= 0 && dayIndices[idx] > todayNum && blocks[idx].exercises.length > 0) {
        msg += '\nnext_forward: ' + blocks[idx].dayTitle;
        break;
      }
    }
  }
  sendMessage(client.telegram_id, msg);
}

function sendMeasurementReminder(client) {
  const text = [
    'Сегодня день замеров и фото прогресса, ' + client.client_name + '.',
    '',
    'Нужно сделать:',
    '  • вес утром натощак',
    '  • талия, живот, грудь',
    '  • бедра, ягодицы',
    '  • левое/правое бедро, левая/правая рука',
    '  • фото спереди, сбоку, сзади',
    '  • скрин состава тела (если есть)',
    '',
    'Важно: одинаковый свет, одежда, поза.',
  ].join('\n');

  sendMessage(client.telegram_id, text, inlineKeyboard([
    [button('Начать замеры', 'measurements_start')],
    [button('Напомнить позже', 'measurements_remind_later')],
    [button('Пропустить сегодня', 'measurements_skip')],
  ]));
}

function clearAllSentFlags() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach((key) => {
    if (key.indexOf('morning_sent_') === 0 || key.indexOf('meas_sent_') === 0 || key.indexOf('meas_suppressed_') === 0 || key.indexOf('meas_remind_count_') === 0) props.deleteProperty(key);
  });
  Logger.log('All sent flags cleared');
}

function clearMorningSentFlags() {
  clearAllSentFlags();
}

function scheduleMeasurementReminder(client, chatId) {
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const propKey = 'meas_remind_count_' + client.client_id + '_' + todayKey;
  const props = PropertiesService.getScriptProperties();
  const currentCount = Number(props.getProperty(propKey) || 0);

  if (currentCount >= 2) {
    sendMessage(chatId, 'На сегодня напоминания закончены. Следующее уведомление о замерах придет на следующей неделе.');
    return;
  }

  const scheduleSheet = getCommonSpreadsheet().getSheetByName(CONFIG.SHEETS.SCHEDULE);
  const now = new Date();
  const remindTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const scheduleDate = Utilities.formatDate(remindTime, tz, 'yyyy-MM-dd');
  const scheduleHour = Utilities.formatDate(remindTime, tz, 'HH');
  const scheduleMin = Utilities.formatDate(remindTime, tz, 'mm');
  const scheduleTime = scheduleHour + ':' + scheduleMin;
  const scheduleEpoch = remindTime.getTime();

  const newCount = currentCount + 1;
  props.setProperty(propKey, String(newCount));

  scheduleSheet.appendRow([
    'sch_meas_' + client.client_id + '_' + Date.now(),
    client.client_id,
    'measurement_reminder',
    scheduleDate,
    scheduleTime,
    '',
    'pending',
    '',
    String(scheduleEpoch),
    String(newCount),
  ]);

  sendMessage(chatId, 'Хорошо. Напомню через 2 часа (попытка ' + newCount + ' из 2).');
  logBot(client.client_id, client.telegram_id, 'measurement_reminder_scheduled', 'success', 'count=' + newCount + ' at ' + scheduleTime);
}

function suppressMeasurementsForToday(client) {
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('meas_suppressed_' + client.client_id + '_' + todayKey, 'true');
  logBot(client.client_id, client.telegram_id, 'measurements_suppressed_today', 'success', '');
}

function isMeasurementsSuppressed(client) {
  const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  const todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('meas_suppressed_' + client.client_id + '_' + todayKey) === 'true';
}

function fireDueMeasurementReminders() {
  const ss = getCommonSpreadsheet();
  const scheduleSheet = ss.getSheetByName(CONFIG.SHEETS.SCHEDULE);
  if (!scheduleSheet) return;
  const rows = getSheetObjects(scheduleSheet).filter((row) => row.type === 'measurement_reminder' && row.status === 'pending');
  if (rows.length === 0) return;

  const now = Date.now();
  rows.forEach((row) => {
    if (!row.client_id || !row.error) return;
    const remindEpoch = Number(row.error);
    if (isNaN(remindEpoch)) return;

    if (now < remindEpoch) return;

    const client = findClientById(row.client_id);
    if (!client) return;
    if (isMeasurementsSuppressed(client)) return;
    if (isMeasurementDoneToday(client)) return;

    const count = Number(row.payload || 0);

    if (count >= 2) {
      sendMessage(client.telegram_id, 'На сегодня напоминания о замерах закончены. Следующее уведомление — на следующей неделе.');
      markScheduleEntryDone(scheduleSheet, row);
      return;
    }

    sendMeasurementReminder(client);
    markScheduleEntryDone(scheduleSheet, row);
    logBot(client.client_id, client.telegram_id, 'deferred_measurement_reminder_sent', 'success', 'count=' + count);
  });
}

function isMeasurementDoneToday(client) {
  const state = getStateByTelegramId(client.telegram_id);
  if (state && (state.action === 'measurements' || state.action === 'photos')) return true;
  return false;
}

function markScheduleEntryDone(sheet, row) {
  const data = getSheetObjects(sheet);
  const index = data.findIndex((r) => r.schedule_id === row.schedule_id);
  if (index !== -1) {
    sheet.getRange(index + 5, 7).setValue('done');
  }
}

function isTimeWithinWindow(now, timezone, targetTime, windowMinutes) {
  const currentDate = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const currentMinutes = Number(Utilities.formatDate(now, timezone, 'H')) * 60
    + Number(Utilities.formatDate(now, timezone, 'm'));
  const parsed = parseTimeToMinutes(targetTime);
  if (parsed === null) return false;
  return currentMinutes >= parsed && currentMinutes <= parsed + windowMinutes;
}

function parseTimeToMinutes(value) {
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function testSendDueMessagesNow() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet).filter((client) => client.status === 'active' && client.telegram_id && (client.payment_status === 'paid' || !client.payment_status || client.spreadsheet_id));
  clients.forEach((client) => {
    sendTodayWorkout(client);
    logBot(client.client_id, client.telegram_id, 'manual_test_notification_sent', 'success', 'testSendDueMessagesNow');
  });
}

function debugDueMessages() {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet).filter((client) => client.status === 'active' && client.telegram_id && (client.payment_status === 'paid' || !client.payment_status || client.spreadsheet_id));
  const now = new Date();
  const props = PropertiesService.getScriptProperties();

  const lines = clients.map((client) => {
    const tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
    const currentDate = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    const currentTime = Utilities.formatDate(now, tz, 'HH:mm:ss');
    const currentMinutes = Number(Utilities.formatDate(now, tz, 'H')) * 60
      + Number(Utilities.formatDate(now, tz, 'm'));
    const targetMinutes = parseTimeToMinutes(client.morning_time);
    const sendKey = 'morning_sent_' + client.client_id + '_' + currentDate;
    const alreadySent = props.getProperty(sendKey) || 'no';
    const inWindow = isTimeWithinWindow(now, tz, client.morning_time, 2);

    const weekDays = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
    const todayWeekDay = weekDays[parseInt(Utilities.formatDate(now, tz, 'u'))];
    const measSuppressed = isMeasurementsSuppressed(client);
    const measRemindCount = props.getProperty('meas_remind_count_' + client.client_id + '_' + currentDate) || '0';

    return [
      'client_id=' + client.client_id,
      'telegram_id=' + client.telegram_id,
      'timezone=' + tz,
      'current=' + currentDate + ' ' + currentTime,
      'morning_time=' + client.morning_time,
      'current_minutes=' + currentMinutes,
      'target_minutes=' + targetMinutes,
      'in_window=' + inWindow,
      'already_sent=' + alreadySent,
      'measurement_time=' + (client.measurement_time || '-'),
      'measurement_day=' + (client.measurement_day || '-'),
      'today=' + todayWeekDay,
      'meas_suppressed=' + measSuppressed,
      'meas_remind_count=' + measRemindCount,
    ].join(' | ');
  });

  Logger.log(lines.join('\n'));
  if (clients[0]) {
    sendMessage(clients[0].telegram_id, 'DEBUG уведомлений:\n' + lines.join('\n'));
  }
}

function setupProgramSchedule() {
  const ss = getCommonSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  sheet.clear();

  const headers = [
    'client_id', 'program_week', 'cycle', 'week_number', 'sheet_name', 'start_date', 'end_date',
    'focus', 'status', 'notes',
  ];
  sheet.getRange(1, 1).setValue('Bot Program Schedule | Автоматическое расписание всей программы');
  sheet.getRange(2, 1).setValue('Бот сам определяет текущую неделю по дате. Не нужно вручную менять active_week в Bot Clients.');
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);

  const start = parseDateKey(CONFIG.PROGRAM_START_DATE);
  const hypertrophyFocus = [
    'Адаптация к объему, техника, RPE 7',
    '+1 повтор или +2.5% веса, RPE 7-8',
    'Увеличение объема, тяжелые базовые RPE 8',
    'Разгрузка: -35% объема, RPE 6',
    'Новый блок: тяжелее, диапазон 6-10',
    'Рост объема: +1 подход в ключевых движениях',
    'Пиковая гипертрофия, RPE 8-9 без отказа',
    'Консолидация и контрольные AMRAP без отказа',
  ];
  const intervalFocus = [
    'База выносливости, интервалы умеренно',
    '+1 раунд в основных комплексах',
    'Сокращение отдыха, выше плотность',
    'Разгрузка: меньше раундов, техника',
    'Новый блок: тяжелее интервальная сила',
    'Пороговая работа и плотность',
    'Пиковая неделя: максимум качества',
    'Тестовая неделя: контрольные комплексы',
  ];

  const rows = [];
  for (let i = 0; i < 8; i++) {
    const weekStart = addDays(start, i * 7);
    rows.push([
      'alexey_ivanov', i + 1, 'Гипертрофия', i + 1, 'Гип W' + (i + 1),
      formatDateKey(weekStart), formatDateKey(addDays(weekStart, 6)), hypertrophyFocus[i], 'active', '',
    ]);
  }
  for (let i = 0; i < 8; i++) {
    const weekStart = addDays(start, (8 + i) * 7);
    rows.push([
      'alexey_ivanov', i + 9, 'Интервальная', i + 1, 'Инт W' + (i + 1),
      formatDateKey(weekStart), formatDateKey(addDays(weekStart, 6)), intervalFocus[i], 'active', '',
    ]);
  }

  sheet.getRange(5, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(4);
  sheet.autoResizeColumns(1, headers.length);
  Logger.log('Program schedule created: ' + rows.length + ' weeks');
}

function addDays(dateValue, days) {
  const copy = new Date(dateValue.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateKey(dateValue) {
  return Utilities.formatDate(dateValue, CONFIG.DEFAULT_TIMEZONE, 'yyyy-MM-dd');
}

function sendMessage(chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramRequest('sendMessage', payload);
}

function answerCallback(callbackQueryId) {
  return telegramRequest('answerCallbackQuery', { callback_query_id: callbackQueryId });
}

function telegramRequest(method, payload) {
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/' + method;
  return UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function button(text, callbackData) {
  return { text: text, callback_data: callbackData };
}

function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

function getBotToken() {
  const token = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!token) throw new Error('BOT_TOKEN is not set in Script Properties');
  return token;
}

function setBotToken() {
  PropertiesService.getScriptProperties().setProperty('BOT_TOKEN', 'PASTE_TELEGRAM_BOT_TOKEN_HERE');
}

function setWebhook() {
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  if (!webAppUrl) throw new Error('WEB_APP_URL is not set in Script Properties');
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/setWebhook?url=' + encodeURIComponent(webAppUrl);
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function setWorkerWebhook() {
  PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', 'https://fragrant-scene-755d.shoshiny-87.workers.dev');
  Logger.log('WEB_APP_URL set to Worker URL');
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/setWebhook?url=' + encodeURIComponent('https://fragrant-scene-755d.shoshiny-87.workers.dev');
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function getWebhookInfo() {
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/getWebhookInfo';
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function deleteWebhook() {
  const url = 'https://api.telegram.org/bot' + getBotToken() + '/deleteWebhook?drop_pending_updates=true';
  Logger.log(UrlFetchApp.fetch(url).getContentText());
}

function getOrCreateFolder(name, parent) {
  const iterator = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iterator.hasNext()) return iterator.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function getPhotoRootFolder() {
  const customFolderId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
  const folderId = customFolderId || CONFIG.DEFAULT_DRIVE_ROOT_FOLDER_ID;
  if (folderId) return DriveApp.getFolderById(folderId);
  return getOrCreateFolder(CONFIG.DEFAULT_PHOTO_FOLDER_NAME);
}

function ensureMeasurementTimeColumn() {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  if (!sheet) throw new Error('Bot Clients sheet not found');

  const ensureCol = (name) => {
    const headers = sheet.getRange(4, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx + 1;
    const newCol = headers.length + 1;
    sheet.getRange(4, newCol).setValue(name);
    Logger.log('created column ' + name + ' at ' + newCol);
    return newCol;
  };

  ensureCol('measurement_time');
  ensureCol('spreadsheet_id');
  ensureCol('measurement_day');
  ensureCol('morning_time');
  ensureCol('timezone');

  const data = getSheetObjects(sheet);
  const rowIndex = data.findIndex((r) => r.client_id === 'alexey_ivanov');
  if (rowIndex !== -1) {
    const rowNum = rowIndex + 5;
    const setIfEmpty = (colName, value) => {
      const headers = sheet.getRange(4, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
      const col = headers.indexOf(colName) + 1;
      if (col && !sheet.getRange(rowNum, col).getDisplayValue()) {
        sheet.getRange(rowNum, col).setValue(value);
        Logger.log('set ' + colName + '=' + value + ' for alexey_ivanov');
      }
    };
    setIfEmpty('measurement_time', '07:30');
    setIfEmpty('measurement_day', 'Понедельник');
    setIfEmpty('morning_time', '07:00');
    setIfEmpty('timezone', 'Europe/Moscow');
  }

  Logger.log('ensureMeasurementTimeColumn done');
}

function ensureClientProgramColumns() {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  if (!sheet) throw new Error('Bot Clients sheet not found');
  const ensureCol = (name) => {
    const headers = sheet.getRange(4, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    if (headers.indexOf(name) !== -1) { Logger.log(name + ' column already exists'); return; }
    const newCol = headers.length + 1;
    sheet.getRange(4, newCol).setValue(name);
    Logger.log('Created ' + name + ' column at ' + newCol);
  };
  ensureCol('program_file_id');
  ensureCol('program_populated');
  Logger.log('ensureClientProgramColumns done');
}

function populateClientProgram() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet);

  clients.forEach(function (client) {
    if (String(client.program_populated) === 'TRUE') return;
    if (!client.program_file_id) return;

    Logger.log('Processing: ' + client.client_id);

    var tempSsId = null;
    try {
      var fileId = String(client.program_file_id).trim();
      var file = DriveApp.getFileById(fileId);
      var mime = file.getMimeType();

      if (mime === MimeType.GOOGLE_SHEETS) {
        tempSsId = fileId;
      } else {
        logBot(client.client_id, client.telegram_id, 'populate_error', 'failed', 'Только Google Sheets. Конвертируйте Excel через Открыть с помощью > Google Sheets. MIME: ' + mime);
        return;
      }

      var tempSs = SpreadsheetApp.openById(tempSsId);
      var clientSs = getClientSpreadsheet(client);

      if (!clientSs) {
        logBot(client.client_id, client.telegram_id, 'populate_error', 'failed', 'No client spreadsheet');
        if (tempSsId !== fileId) DriveApp.getFileById(tempSsId).setTrashed(true);
        return;
      }

      createBotProgramSchedule(client, clientSs);

      for (var w = 1; w <= 12; w++) {
        var name = 'W' + w;
        var src = tempSs.getSheetByName(name);
        if (!src) {
          Logger.log('Sheet ' + name + ' not found in program file');
          continue;
        }
        var existing = clientSs.getSheetByName(name);
        if (existing) clientSs.deleteSheet(existing);
        src.copyTo(clientSs);
        var allSheets = clientSs.getSheets();
        allSheets[allSheets.length - 1].setName(name);
      }

      var cycleName = file.getName().replace(/\.\w+$/, '').replace(/_/g, ' ');
      fillProgramSchedule(client, clientSs, cycleName, tempSs);

      updateClientField(client, 'program_populated', 'TRUE');
      logBot(client.client_id, client.telegram_id, 'populate_success', 'success', 'W1-W12 + schedule done');

    } catch (e) {
      logBot(client.client_id, client.telegram_id, 'populate_error', 'failed', e.message);
      Logger.log(e.stack);
    } finally {
      if (tempSsId && tempSsId !== fileId) {
        try { DriveApp.getFileById(tempSsId).setTrashed(true); } catch (e) { Logger.log(e); }
      }
    }
  });
}

function createBotProgramSchedule(client, clientSs) {
  var existing = clientSs.getSheetByName(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  if (existing) clientSs.deleteSheet(existing);
  var sheet = clientSs.insertSheet(CONFIG.SHEETS.PROGRAM_SCHEDULE);
  sheet.hideSheet();

  sheet.getRange(1, 1).setValue('Bot Program Schedule | Автоматическое расписание всей программы');
  sheet.getRange(2, 1).setValue('Бот сам определяет текущую неделю по дате. Не нужно вручную менять active_week в Bot Clients.');

  var h = ['client_id', 'program_week', 'cycle', 'week_number', 'sheet_name', 'start_date', 'end_date', 'focus', 'status', 'notes'];
  sheet.getRange(4, 1, 1, h.length).setValues([h]);
  sheet.getRange(4, 1, 1, h.length).setFontWeight('bold');
  return sheet;
}

function parseProgramStartDate(tempSs) {
  var w1 = tempSs.getSheetByName('W1');
  if (!w1) return null;
  var cell = w1.getRange('A2').getDisplayValue();
  var match = cell.match(/Период:\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function fillProgramSchedule(client, clientSs, cycleName, tempSs) {
  var sheet = createBotProgramSchedule(client, clientSs);

  var startDate = parseProgramStartDate(tempSs);
  if (!startDate) startDate = new Date();

  var newRows = [];
  for (var w = 1; w <= 12; w++) {
    var ws = new Date(startDate);
    ws.setDate(ws.getDate() + (w - 1) * 7);
    var we = new Date(ws);
    we.setDate(we.getDate() + 6);
    newRows.push([client.client_id, w, cycleName, w, 'W' + w, fmtDate(ws), fmtDate(we), '', 'active', '']);
  }

  sheet.getRange(5, 1, newRows.length, newRows[0].length).setValues(newRows);
}

function saveWorkoutSkip(client, reason) {
  var tz = client.timezone || CONFIG.DEFAULT_TIMEZONE;
  var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var ss = getClientSpreadsheet(client);
  var sheetName = getActiveWeekSheetName(client);

  appendRow(CONFIG.SHEETS.RAW_RESULTS, [new Date(), client.client_id, client.active_cycle, client.active_week, 'Пропуск тренировки', 0, 'Пропуск', '', '', '', '', '', '', '', reason || '', sheetName, ''], ss);

  PropertiesService.getScriptProperties().setProperty('workout_skipped_' + client.client_id + '_' + todayKey, reason || 'no_reason');
  logBot(client.client_id, client.telegram_id, 'workout_skipped', 'info', reason || 'no_reason');
}

function fmtDate(date) {
  return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
}

function logBot(clientId, telegramId, action, status, details) {
  try {
    appendRow(CONFIG.SHEETS.LOGS, [new Date(), clientId, telegramId, action, status, details, '']);
  } catch (error) {
    Logger.log(error);
  }
}

function generateNewConnectCodes() {
  const ss = getCommonSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  const clients = getSheetObjects(sheet);
  var count = 0;
  clients.forEach((client) => {
    if (!client.connect_code) {
      var code = '';
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (var i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      updateClientField(client, 'connect_code', code);
      Logger.log('Generated code for ' + client.client_id + ': ' + code);
      count++;
    }
  });
  Logger.log('generateNewConnectCodes: generated ' + count + ' codes');
}

function showWelcome(chatId) {
  var text = [
    '🏋️ Добро пожаловать в систему онлайн-коучинга!',
    '',
    'Я помогу тренироваться по программе,',
    'отслеживать прогресс и получать напоминания.',
    '',
    '🔑 У меня есть код от тренера',
    '   или',
    '🎯 Хочу купить программу',
  ].join('\n');
  sendMessage(chatId, text, inlineKeyboard([
    [button('🔑 У меня есть код', 'welcome_connect')],
    [button('🎯 Купить программу', 'welcome_programs')],
  ]));
}

function getPrograms() {
  var ss = getCommonSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.PROGRAMS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.PROGRAMS);
    sheet.getRange(1, 1).setValue('Bot Programs | Каталог программ тренировок');
    sheet.getRange(2, 1).setValue('Заполните строки и запустите activatePendingPrograms() после оплаты.');
    var headers = ['id', 'title', 'description', 'equipment', 'price', 'template_id', 'active'];
    sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(4);
    sheet.autoResizeColumns(1, headers.length);
    return [];
  }
  return getSheetObjects(sheet).filter(function (p) { return String(p.active).toUpperCase() === 'TRUE'; });
}

function showPrograms(chatId) {
  var programs = getPrograms();
  if (programs.length === 0) {
    sendMessage(chatId, 'Пока нет доступных программ. Скоро появятся!');
    return;
  }

  var lines = ['🎯 Доступные программы тренировок:', ''];
  var buttons = [];

  programs.forEach(function (p, i) {
    lines.push((i + 1) + '. ' + p.title);
    lines.push('   ' + (p.description || ''));
    if (p.equipment) lines.push('   🏋️ ' + p.equipment);
    lines.push('   💰 ' + p.price + ' ₽');
    lines.push('');
    buttons.push([button((i + 1) + '. ' + p.title + ' — ' + p.price + ' ₽', 'program_buy:' + p.id)]);
  });

  sendMessage(chatId, lines.join('\n'), inlineKeyboard(buttons));
}

function showMyProgram(client) {
  if (!client.program_id && !client.spreadsheet_id) {
    sendMessage(client.telegram_id, 'У вас нет активной программы. Наберите /programs чтобы выбрать.');
    return;
  }

  if (client.payment_status !== 'paid' && !client.spreadsheet_id) {
    sendMessage(client.telegram_id, 'Программа ожидает подтверждения оплаты. Как только тренер подтвердит — вы получите доступ.');
    return;
  }

  var programs = getPrograms();
  var program = programs.find(function (p) { return p.id === client.program_id; });
  var lines = ['📋 Моя программа:', ''];
  if (program) lines.push(program.title);
  else if (client.spreadsheet_id) lines.push('Персональная программа');
  else lines.push(client.program_id);

  if (client.spreadsheet_id) {
    var url = 'https://docs.google.com/spreadsheets/d/' + client.spreadsheet_id + '/edit';
    lines.push('');
    lines.push('🔗 <a href="' + url + '">Открыть таблицу программы</a>');
  }
  if (client.connect_code) {
    lines.push('🔑 Код для переподключения: ' + client.connect_code);
  }
  sendMessage(client.telegram_id, lines.join('\n'));
}

function handleProgramSelection(chatId, text) {
  var programs = getPrograms();
  var index = parseInt(text) - 1;
  if (isNaN(index) || index < 0 || index >= programs.length) {
    sendMessage(chatId, 'Пожалуйста, выберите номер из списка (1, 2, 3...).');
    return;
  }
  var program = programs[index];
  upsertState({ telegram_id: chatId, action: 'await_name', program_id: program.id });
  sendMessage(chatId, 'Отличный выбор! Напишите ваше имя и фамилию:');
}

function registerClient(chatId, programId, name) {
  var nameClean = String(name || '').trim();
  if (!nameClean) {
    sendMessage(chatId, 'Пожалуйста, напишите ваше имя.');
    return;
  }

  var clientId = nameClean.replace(/\s+/g, '_').toLowerCase() + '_' + chatId;
  var ss = getCommonSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);

  var headers = sheet.getRange(4, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var ensureCol = function (name) {
    var idx = headers.indexOf(name);
    if (idx !== -1) return idx + 1;
    var newCol = headers.length + 1;
    sheet.getRange(4, newCol).setValue(name);
    headers.push(name);
    return newCol;
  };

  var row = [];
  row[ensureCol('client_id') - 1] = clientId;
  row[ensureCol('telegram_id') - 1] = chatId;
  row[ensureCol('status') - 1] = 'active';
  row[ensureCol('payment_status') - 1] = 'pending';
  row[ensureCol('program_id') - 1] = programId;
  row[ensureCol('name') - 1] = nameClean;
  row[ensureCol('timezone') - 1] = CONFIG.DEFAULT_TIMEZONE;

  var emptyRow = [];
  for (var i = 0; i < headers.length; i++) emptyRow.push('');
  row.forEach(function (val, idx) { if (val !== undefined) emptyRow[idx] = val; });
  sheet.appendRow(emptyRow);

  clearState(chatId);
  sendMessage(chatId, '✅ Заявка отправлена! После подтверждения оплаты тренером вы получите доступ к программе и персональный код подключения.');
  logBot(clientId, chatId, 'client_registered', 'info', 'program=' + programId + ' name=' + nameClean);
}

function activatePendingPrograms() {
  ensureBotClientPaymentColumns();
  var ss = getCommonSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  var clients = getSheetObjects(sheet).filter(function (c) {
    return String(c.payment_status).trim() === 'paid' && !String(c.spreadsheet_id || '').trim() && c.program_id && c.telegram_id;
  });

  if (clients.length === 0) {
    Logger.log('activatePendingPrograms: no pending clients');
    return;
  }

  var programs = getPrograms();

  clients.forEach(function (client) {
    try {
      var program = programs.find(function (p) { return p.id === client.program_id; });
      if (!program || !program.template_id) {
        Logger.log('activatePendingPrograms: program not found for ' + client.client_id);
        return;
      }

      var templateId = String(program.template_id).trim();
      var clientSs = createClientSpreadsheet(client, program);
      var clientSsId = clientSs.getId();

      fillProgramSchedule(client, clientSs, program.title, SpreadsheetApp.openById(templateId));

      var code = '';
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (var i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      updateClientField(client, 'connect_code', code);

      var url = 'https://docs.google.com/spreadsheets/d/' + clientSsId + '/edit';
      var msg = [
        '✅ Оплата подтверждена! Программа активирована.',
        '',
        '📋 Программа: ' + program.title,
        '🔗 Ссылка на таблицу: <a href="' + url + '">открыть</a>',
        '',
        '🔑 Ваш код для переподключения: <b>' + code + '</b>',
        '',
        'Настройте время уведомлений через /settings.',
        'С завтрашнего утра я начну присылать тренировки.',
      ].join('\n');
      sendMessage(client.telegram_id, msg);

      logBot(client.client_id, client.telegram_id, 'program_activated', 'success', 'spreadsheet=' + clientSs.getId());
    } catch (e) {
      Logger.log('activatePendingPrograms error for ' + client.client_id + ': ' + e.message + ' ' + e.stack);
      logBot(client.client_id, client.telegram_id, 'program_activate_error', 'failed', e.message);
    }
  });

  Logger.log('activatePendingPrograms: processed ' + clients.length + ' clients');
}

function createClientSpreadsheet(client, program) {
  var templateId = String(program.template_id).trim();
  var templateSs = SpreadsheetApp.openById(templateId);
  var name = (client.name || client.client_id) + ' — ' + program.title;
  var copySs = templateSs.copy(name);
  var copyId = copySs.getId();

  var file = DriveApp.getFileById(copyId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  ensureSystemSheets(copySs);

  var folder = DriveApp.getFolderById(CONFIG.DEFAULT_DRIVE_ROOT_FOLDER_ID);
  folder.addFile(file);

  var clientsSheet = getCommonSheet(CONFIG.SHEETS.CLIENTS);
  updateClientField(client, 'spreadsheet_id', copyId);

  return copySs;
}

function ensureSystemSheets(ss) {
  var existingNames = ss.getSheets().map(function (s) { return s.getName(); });

  var systemSheets = [
    { name: CONFIG.SHEETS.RAW_RESULTS, hidden: true },
    { name: CONFIG.SHEETS.PROGRAM_SCHEDULE, hidden: true },
    { name: CONFIG.SHEETS.BODY_PROGRESS, hidden: false },
    { name: CONFIG.SHEETS.PHOTOS, hidden: false },
  ];

  systemSheets.forEach(function (info) {
    if (existingNames.indexOf(info.name) === -1) {
      var s = ss.insertSheet(info.name);
      if (info.hidden) s.hideSheet();
      if (info.name === CONFIG.SHEETS.BODY_PROGRESS) {
        s.getRange(1, 1, 1, 8).setValues([['Дата', 'Вес', 'Талия', 'Живот', 'Грудь', 'Бёдра', 'Ягодицы', 'Комментарий']]);
      }
      if (info.name === CONFIG.SHEETS.PHOTOS) {
        s.getRange(1, 1, 1, 3).setValues([['Дата', 'Фото', 'Ракурс']]);
      }
      if (info.name === CONFIG.SHEETS.PROGRAM_SCHEDULE) {
        s.getRange(1, 1).setValue('Bot Program Schedule');
        s.getRange(4, 1, 1, 10).setValues([['client_id', 'program_week', 'cycle', 'week_number', 'sheet_name', 'start_date', 'end_date', 'focus', 'status', 'notes']]);
      }
    }
  });
}

function ensureBotClientPaymentColumns() {
  var ss = getCommonSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CLIENTS);
  var headers = sheet.getRange(4, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var needed = ['payment_status', 'program_id'];
  var added = [];
  needed.forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      var col = headers.length + 1;
      sheet.getRange(4, col).setValue(name);
      headers.push(name);
      added.push(name);
    }
  });
  Logger.log('ensureBotClientPaymentColumns: added ' + added.join(', '));
}

function recalcClientSchedule(clientId) {
  var sheet = getCommonSheet(CONFIG.SHEETS.CLIENTS);
  var clients = getSheetObjects(sheet);
  var client = clients.find(function (c) { return String(c.client_id).trim() === String(clientId).trim(); });
  if (!client || !client.spreadsheet_id || !client.program_id) {
    Logger.log('recalcClientSchedule: client not found or no spreadsheet/program: ' + clientId);
    return;
  }
  var programs = getPrograms();
  var program = programs.find(function (p) { return p.id === client.program_id; });
  if (!program || !program.template_id) {
    Logger.log('recalcClientSchedule: program not found: ' + client.program_id);
    return;
  }
  var clientSs = SpreadsheetApp.openById(client.spreadsheet_id);
  var tempSs = SpreadsheetApp.openById(String(program.template_id).trim());
  fillProgramSchedule(client, clientSs, program.title, tempSs);
  Logger.log('recalcClientSchedule: done for ' + clientId);
}

function recalcTestClientSchedule() {
  recalcClientSchedule('shoshin_iurii_7664217215');
}

function recalcAllClientSchedules() {
  var sheet = getCommonSheet(CONFIG.SHEETS.CLIENTS);
  var clients = getSheetObjects(sheet).filter(function (c) { return c.spreadsheet_id && c.program_id; });
  clients.forEach(function (client) { recalcClientSchedule(client.client_id); });
  Logger.log('recalcAllClientSchedules: processed ' + clients.length + ' clients');
}
