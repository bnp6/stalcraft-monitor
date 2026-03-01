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

    // ПОЛНЫЙ список игроков (33 человека)
    const PLAYERS = [
      "Ohhaaayo", "Emersons", "Yammito", "SNIXCED", "LegedaryForigeb",
      "BAVGUNNER", "Kokosmos", "FoOrty", "Bembel", "RakovaiVixyxol",
      "Pavvvvel", "ТурбоТанкер", "MaeSTRaG", "Talos_O", "Sosiska_killeru",
      "Cid_Kageno", "GRUZOPEREVOZKA", "MashVandet", "FELPYYYY", "Rkkqq",
      "ZXCBOCHKA", "Лелуш__Ламперуж", "hamerxxray", "topormafii",
      "ValeraBanan", "Milkoos", "LLlmaLb", "Том_Грязный", "PVPabuser",
      "FedorBritva", "Andrey_Nifedov", "FuRySMiLe"
    ];

    // Временные окна (МСК)
    const TIME_WINDOWS = [
      { name: "ТЕСТ 23:02-23:08", start: "23:18", end: "23:20", days: [0] },
      { name: "20:00-20:28", start: "20:00", end: "20:28", days: [4, 5, 6, 0] },
      { name: "20:30-20:58", start: "20:30", end: "20:58", days: [4, 5, 6, 0] },
      { name: "21:00-21:28", start: "21:00", end: "21:28", days: [4, 5, 6, 0] }
    ];

    // Подключаем хранилище
    const store = getStore('grenade-monitor-store');
    
    // Получаем текущее время (МСК)
    const now = new Date();
    const mskTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const currentHour = String(mskTime.getHours()).padStart(2, '0');
    const currentMinute = String(mskTime.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}`;
    const currentDay = mskTime.getDay();

    // Проверяем, входит ли в окно
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

    // ПОЛУЧАЕМ СТАТИСТИКУ (исправленная версия)
    console.log(`🎯 Окно: ${currentWindow.name}`);
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
        
        if (!response.ok) {
          console.log(`❌ ${player}: HTTP ${response.status}`);
          stats[player] = 0;
          continue;
        }
        
        const data = await response.json();
        
        // Ищем gre-thr в stats (как в Python скрипте)
        let greThr = 0;
        if (data?.stats && Array.isArray(data.stats)) {
          const stat = data.stats.find(s => s.id === 'gre-thr');
          greThr = stat?.value || 0;
          console.log(`✅ ${player}: gre-thr = ${greThr}`);
        } else {
          console.log(`⚠️ ${player}: нет stats, данные:`, Object.keys(data));
        }
        
        stats[player] = greThr;
        
      } catch (error) {
        console.error(`❌ ${player}: ${error.message}`);
        stats[player] = 0;
      }
    }

    // Загружаем состояние из хранилища
    let state = await store.get('state', { type: 'json' }) || {
      baseline: {},
      currentWindow: null
    };

    // Если это первый запуск в окне
    if (state.currentWindow !== currentWindow.name || Object.keys(state.baseline).length === 0) {
      state.baseline = stats;
      state.currentWindow = currentWindow.name;
      await store.setJSON('state', state);
      
      return new Response(JSON.stringify({ 
        message: `📝 Первый запуск в окне ${currentWindow.name}, базовые значения сохранены`,
        baseline: stats
      }));
    }

    // Считаем изменения
    const changes = [];
    for (const [player, current] of Object.entries(stats)) {
      const baseline = state.baseline[player] || 0;
      const diff = current - baseline;
      if (diff > 0) {
        changes.push({ player, diff });
      }
    }
    changes.sort((a, b) => b.diff - a.diff);

    // ФОРМИРУЕМ ОТЧЕТ СО ВСЕМИ ИГРОКАМИ
    const allPlayers = PLAYERS.sort();
    let reportText = `**📊 ИТОГИ ЗА ${currentWindow.name}**\n\n**Брошено гранат:**\n`;
    let total = 0;

    for (const player of allPlayers) {
      const change = changes.find(c => c.player === player);
      const diff = change?.diff || 0;
      total += diff;
      
      // Определяем эмодзи
      let emoji = "⚫";
      if (changes.length > 0 && changes[0]?.player === player) emoji = "🥇";
      else if (changes.length > 1 && changes[1]?.player === player) emoji = "🥈";
      else if (changes.length > 2 && changes[2]?.player === player) emoji = "🥉";
      else if (diff > 100) emoji = "🟢";
      else if (diff >= 50) emoji = "🟡";
      else if (diff > 0) emoji = "🔴";
      
      reportText += `${emoji} **${player}**: ${diff} шт.\n`;
    }

    reportText += `\n**Всего брошено:** ${total} гранат`;

    // Добавляем топ-3 если есть
    if (changes.length > 0) {
      reportText += `\n\n**🏆 Топ-3:**\n`;
      for (let i = 0; i < Math.min(3, changes.length); i++) {
        const medal = ["🥇", "🥈", "🥉"][i];
        reportText += `${medal} ${changes[i].player}: ${changes[i].diff} шт.\n`;
      }
    }

    // Если это конец окна - отправляем отчёт
    if (currentTime === currentWindow.end) {
      const embed = {
        title: `💣 Отчёт за ${currentWindow.name}`,
        color: changes.length > 0 ? 0x00FF00 : 0x808080,
        description: reportText,
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
      changes: changes.length,
      total: total
    }));

  } catch (error) {
    console.error('❌ Ошибка:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
