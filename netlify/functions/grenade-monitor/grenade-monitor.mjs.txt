// Этот файл будет жить по пути: netlify/functions/grenade-monitor/grenade-monitor.js
import { Buffer } from 'node:buffer';

// Конфигурация (ваши данные уже вставлены)
const CONFIG = {
  clientId: "1071",
  clientSecret: "LEjjaQzmIqfdTxsRsXkQOunnzEIMdVMTOrhwLLeW",
  discordWebhook: "https://discord.com/api/webhooks/1477683130667237561/xnoLigk0sPveJ3FJNgFaY8lEwYH_HATO7PHIVcjh2bQo4PBk-vRsSGKA0-8Sy8zw_lo-",
  region: "ru"
};

// Список игроков (ваш полный список)
const PLAYERS = [
  "Ohhaaayo", "Emersons", "Yammito", "SNIXCED", "LegedaryForigeb", "BAVGUNNER",
  "Kokosmos", "FoOrty", "Bembel", "RakovaiVixyxol", "Pavvvvel", "ТурбоТанкер",
  "MaeSTRaG", "Talos_O", "Sosiska_killeru", "Cid_Kageno", "GRUZOPEREVOZKA",
  "MashVandet", "FELPYYYY", "Rkkqq", "ZXCBOCHKA", "Лелуш__Ламперуж", "hamerxxray",
  "topormafii", "ValeraBanan", "Milkoos", "LLlmaLb", "Том_Грязный", "PVPabuser",
  "FedorBritva", "Andrey_Nifedov", "FuRySMiLe"
];

// Временные окна (МСК)
const TIME_WINDOWS = [
  { name: "20:00-20:28", start: "20:00", end: "20:28", days: [4, 5, 6, 0] },
  { name: "20:30-20:58", start: "20:30", end: "20:58", days: [4, 5, 6, 0] },
  { name: "21:00-21:28", start: "21:00", end: "21:28", days: [4, 5, 6, 0] }
];

// Простое in-memory хранилище (между вызовами функции будет сбрасываться,
// но для нашей логики "первый запуск в окне" этого достаточно)
let state = {
  baseline: {},
  currentWindow: null,
};

// Функция для получения статистики игрока
async function getPlayerStats() {
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
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      let grenadeThrows = 0;
      if (data?.statistics) {
        const stat = data.statistics.find(s => s.id === 'gre-thr');
        grenadeThrows = stat?.value || 0;
      }
      stats[player] = grenadeThrows;
    } catch (error) {
      console.error(`Ошибка для ${player}: ${error.message}`);
      stats[player] = 0;
    }
  }
  return stats;
}

// Функция отправки отчета в Discord
async function sendDiscordReport(windowName, changes, total) {
  const embed = {
    title: `💣 Отчёт за ${windowName}`,
    color: changes.length > 0 ? 0x00FF00 : 0x808080,
    fields: [],
    footer: { text: `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК` }
  };

  let description = "";
  if (changes.length === 0) {
    description = "За этот период никто не бросал гранаты.";
  } else {
    description = "**Брошено гранат:**\n";
    for (const change of changes) {
      description += `• **${change.player}**: ${change.diff} шт.\n`;
    }
    description += `\n**Всего брошено:** ${total} гранат`;
    if (changes.length >= 3) {
      description += `\n\n**🏆 Топ-3:**\n`;
      for (let i = 0; i < 3; i++) {
        const medal = ["🥇", "🥈", "🥉"][i];
        description += `${medal} ${changes[i].player}: ${changes[i].diff} шт.\n`;
      }
    }
  }
  embed.description = description;

  await fetch(CONFIG.discordWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
}

// Главная функция-обработчик, которую вызывает Netlify
export default async (request) => {
  try {
    const now = new Date();
    const mskTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const currentHour = String(mskTime.getHours()).padStart(2, '0');
    const currentMinute = String(mskTime.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHour}:${currentMinute}`;
    const currentDay = mskTime.getDay(); // 0 = вс, 4 = чт

    // 1. Определяем, входит ли текущее время в окно мониторинга
    const currentWindow = TIME_WINDOWS.find(w =>
      w.days.includes(currentDay) &&
      w.start <= currentTime &&
      currentTime <= w.end
    );

    if (!currentWindow) {
      return new Response(JSON.stringify({ message: `⏰ Вне окон мониторинга (${currentTime})` }));
    }

    // 2. Получаем свежие данные из API
    const currentStats = await getPlayerStats();

    // 3. Проверяем, первый ли это запуск в этом окне
    if (!state.baseline || Object.keys(state.baseline).length === 0 || state.currentWindow !== currentWindow.name) {
      state.baseline = currentStats;
      state.currentWindow = currentWindow.name;
      return new Response(JSON.stringify({ message: `📝 Первый запуск в окне ${currentWindow.name}, базовые значения сохранены` }));
    }

    // 4. Считаем изменения
    const changes = [];
    for (const [player, current] of Object.entries(currentStats)) {
      const baseline = state.baseline[player] || current;
      const diff = current - baseline;
      if (diff > 0) changes.push({ player, diff });
    }
    changes.sort((a, b) => b.diff - a.diff);
    const total = changes.reduce((sum, c) => sum + c.diff, 0);

    // 5. Если это конец окна, отправляем отчет и сбрасываем состояние
    if (currentTime === currentWindow.end) {
      await sendDiscordReport(currentWindow.name, changes, total);
      state.baseline = {};
      state.currentWindow = null;
      return new Response(JSON.stringify({ message: `📊 Отчёт за ${currentWindow.name} отправлен` }));
    }

    // 6. Если не конец окна, просто возвращаем статус
    return new Response(JSON.stringify({ message: `⏳ Мониторинг (${currentTime})` }));

  } catch (error) {
    console.error('Критическая ошибка:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};