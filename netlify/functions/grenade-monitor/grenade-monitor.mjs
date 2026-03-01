import { getStore } from '@netlify/blobs';

export default async (request) => {
  try {
    // Конфигурация
    const CONFIG = {
      clientId: "1071",
      clientSecret: "LEjjaQzmIqfdTxsRsXkQOunnzEIMdVMTOrhwLLeW",
      discordWebhook: "https://discord.com/api/webhooks/1477683130667237561/xnoLigk0sPveJ3FJNgFaY8lEwYH_HATO7PHIVcjh2bQo4PBk-vRsSGKA0-8Sy8zw_lo-",
      region: "ru"
    };

    const PLAYERS = [
      "Ohhaaayo", "Emersons", "Yammito", "SNIXCED", "LegedaryForigeb", "BAVGUNNER",
      "Kokosmos", "FoOrty", "Bembel", "RakovaiVixyxol", "Pavvvvel", "ТурбоТанкер",
      "MaeSTRaG", "Talos_O", "Sosiska_killeru", "Cid_Kageno", "GRUZOPEREVOZKA",
      "MashVandet", "FELPYYYY", "Rkkqq", "ZXCBOCHKA", "Лелуш__Ламперуж", "hamerxxray",
      "topormafii", "ValeraBanan", "Milkoos", "LLlmaLb", "Том_Грязный", "PVPabuser",
      "FedorBritva", "Andrey_Nifedov", "FuRySMiLe"
    ];

    const TIME_WINDOWS = [
      { name: "ТЕСТ 22:40-22:45", start: "22:40", end: "22:45", days: [1] },
      { name: "20:00-20:28", start: "20:00", end: "20:28", days: [4, 5, 6, 0] },
      { name: "20:30-20:58", start: "20:30", end: "20:58", days: [4, 5, 6, 0] },
      { name: "21:00-21:28", start: "21:00", end: "21:28", days: [4, 5, 6, 0] }
    ];

    // ===== ИСПОЛЬЗУЕМ ПОСТОЯННОЕ ХРАНИЛИЩЕ =====
    const store = getStore('grenade-monitor-store');
    
    // Текущее время
    const now = new Date();
    const mskTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const currentHour = String(mskTime.getHours()).padStart(2, '0');
    const currentMinute = String(mskTime.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}`;
    const currentDay = mskTime.getDay();

    // Определяем окно
    const currentWindow = TIME_WINDOWS.find(w =>
      w.days.includes(currentDay) &&
      w.start <= currentTime &&
      currentTime <= w.end
    );

    if (!currentWindow) {
      return new Response(JSON.stringify({ 
        message: `⏰ Вне окон мониторинга (${currentTime})` 
      }));
    }

    // Получаем статистику игроков
    const stats = {};
    for (const player of PLAYERS) {
      try {
        const url = `https://eapi.stalcraft.net/${CONFIG.region}/character/${encodeURIComponent(player)}`;
        const response = await fetch(url, {
          headers: {
            'Client-Id': CONFIG.clientId,
            'Client-Secret': CONFIG.clientSecret
          }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        let greThr = 0;
        if (data?.statistics) {
          const stat = data.statistics.find(s => s.id === 'gre-thr');
          greThr = stat?.value || 0;
        }
        stats[player] = greThr;
      } catch (error) {
        console.error(`Ошибка ${player}: ${error.message}`);
        stats[player] = 0;
      }
    }

    // ===== ЗАГРУЖАЕМ СОСТОЯНИЕ ИЗ ХРАНИЛИЩА =====
    let state = await store.get('state', { type: 'json' }) || {
      baseline: {},
      currentWindow: null,
      firstRun: true
    };

    // Если новое окно или первый запуск
    if (state.currentWindow !== currentWindow.name || Object.keys(state.baseline).length === 0) {
      state.baseline = stats;
      state.currentWindow = currentWindow.name;
      state.firstRun = false;
      
      // Сохраняем в хранилище
      await store.setJSON('state', state);
      
      return new Response(JSON.stringify({ 
        message: `📝 Первый запуск в окне ${currentWindow.name}, базовые значения сохранены`,
        time: currentTime
      }));
    }

    // Считаем изменения
    const changes = [];
    for (const [player, current] of Object.entries(stats)) {
      const baseline = state.baseline[player] || 0;
      const diff = current - baseline;
      if (diff > 0) changes.push({ player, diff });
    }
    changes.sort((a, b) => b.diff - a.diff);

    // Если конец окна - отправляем отчёт
    if (currentTime === currentWindow.end) {
      // Отправляем в Discord
      const embed = {
        title: `💣 Отчёт за ${currentWindow.name}`,
        color: changes.length > 0 ? 0x00FF00 : 0x808080,
        description: formatReport(currentWindow.name, changes),
        footer: { text: `🕐 ${currentTime} МСК` }
      };

      await fetch(CONFIG.discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });

      // Очищаем состояние
      await store.delete('state');
      
      return new Response(JSON.stringify({ 
        message: `📊 Отчёт отправлен за ${currentWindow.name}`,
        changes: changes.length
      }));
    }

    // Промежуточный запуск
    return new Response(JSON.stringify({ 
      message: `⏳ Мониторинг (${currentTime})`,
      changes: changes.length
    }));

  } catch (error) {
    console.error('❌ Ошибка:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// Функция форматирования отчёта
function formatReport(windowName, changes) {
  if (changes.length === 0) {
    return "За этот период никто не бросал гранаты.";
  }
  
  let text = `**📊 ИТОГИ ЗА ${windowName}**\n\n**Брошено гранат:**\n`;
  let total = 0;
  
  changes.forEach((c, i) => {
    total += c.diff;
    let emoji = "⚫";
    if (i === 0) emoji = "🥇";
    else if (i === 1) emoji = "🥈";
    else if (i === 2) emoji = "🥉";
    else if (c.diff > 100) emoji = "🟢";
    else if (c.diff >= 50) emoji = "🟡";
    else if (c.diff > 0) emoji = "🔴";
    
    text += `${emoji} **${c.player}**: ${c.diff} шт.\n`;
  });
  
  text += `\n**Всего брошено:** ${total} гранат`;
  
  if (changes.length >= 3) {
    text += `\n\n**🏆 Топ-3:**\n`;
    for (let i = 0; i < 3; i++) {
      const medal = ["🥇", "🥈", "🥉"][i];
      text += `${medal} ${changes[i].player}: ${changes[i].diff} шт.\n`;
    }
  }
  
  return text;
}
