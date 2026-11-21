import { CreateMLCEngine } from "@mlc-ai/web-llm";

let engine = null;
let loading = null;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

export function initLocalAI() {
  return {
    isReady: () => !!engine,
    load: async (modelId, onProgress = () => {}) => {
      if (engine && engine.modelId === modelId) return engine;
      if (loading) return loading;

      onProgress({ text: "Проверка поддержки WebGPU в браузере…", progress: 0 });
      if (!navigator.gpu) {
        throw new Error("Этот браузер не предоставляет WebGPU. Сейчас приложение открыто не в поддерживаемом режиме. Открой ссылку в последней версии Google Chrome для Android.");
      }

      onProgress({ text: "Запрос графического адаптера WebGPU…", progress: 0 });
      const adapter = await withTimeout(navigator.gpu.requestAdapter(), 15000, "WebGPU не ответил за 15 секунд. Вкладка или графический драйвер могли зависнуть. Перезагрузи страницу и повтори.");
      if (!adapter) {
        throw new Error("WebGPU найден, но графический адаптер недоступен. Попробуй Google Chrome, отключи энергосбережение и закрой другие тяжёлые приложения.");
      }

      let adapterName = "графический адаптер найден";
      try {
        const info = await adapter.requestAdapterInfo?.();
        if (info?.description || info?.device) adapterName = [info.description, info.device].filter(Boolean).join(" ");
      } catch {}
      onProgress({ text: "WebGPU найден (" + adapterName + "). Проверка графического устройства…", progress: 0 });
      const testDevice = await withTimeout(adapter.requestDevice(), 15000, "WebGPU-адаптер найден, но графическое устройство не создаётся. Возможна несовместимость драйвера.");
      testDevice.destroy();
      onProgress({ text: "Графическое устройство работает. Инициализация движка ИИ…", progress: 0 });

      loading = (async () => {
        engine = null;
        const next = await withTimeout(CreateMLCEngine(modelId, {
          initProgressCallback: (p) => onProgress({
            text: p.text || "Загрузка и подготовка модели…",
            progress: Math.round((p.progress || 0) * 100)
          })
        }), 120000, "Движок WebLLM не завершил инициализацию за 2 минуты. WebGPU доступен, но этот браузер или графический драйвер может быть несовместим с WebLLM на Android.");
        next.modelId = modelId;
        engine = next;
        return engine;
      })();
      try {
        return await loading;
      } catch (error) {
        const message = error?.message || String(error);
        if (/device lost|VK_ERROR_DEVICE_LOST|GPUDeviceLost/i.test(message)) {
          throw new Error("Браузер потерял доступ к GPU во время запуска модели. Попробуй Google Chrome, отключи энергосбережение и перезагрузи страницу. " + message);
        }
        throw error;
      } finally {
        loading = null;
      }
    },

    generate: async (input) => {
      if (!engine) throw new Error("Сначала загрузи модель.");
      const knowledge = (input.knowledge || []).slice(0, 25).map((x, i) => (i + 1) + ". " + x).join("\\n");
      const userText = [
        "ЗАДАЧА ПОЛЬЗОВАТЕЛЯ:", input.task,
        "ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ:",
        "Роль: " + (input.role || "не задана"),
        "Контекст: " + (input.context || "не задан"),
        "Ограничения: " + (input.limits || "не заданы"),
        "Желаемый формат: " + (input.format || "выбери сам"),
        "Ответы на уточнения: " + (input.clarifications || "пока нет"),
        "ПОДТВЕРЖДЁННЫЕ ЗНАНИЯ ИЗ БИБЛИОТЕКИ:", knowledge || "пока нет"
      ].join("\\n");
      const response = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "Ты — эксперт по prompt engineering и архитектор задач. Не превращай ответы пользователя в шаблон и не копируй их механически. Пойми конечную цель, определи тип задачи и выбери подходящие техники (декомпозиция, few-shot, ограничения, критерии приёмки, формат вывода, проверка фактов, роль и контекст) только если они полезны. Если критически не хватает информации, задай максимум 3 конкретных уточняющих вопроса и пока НЕ создавай финальный промт. Если информации достаточно, создай профессиональный, детальный, готовый к копированию промт: роль, цель, контекст, входные данные, последовательность работы, ограничения, критерии качества и формат результата. Не добавляй вымышленные факты. Используй знания библиотеки уместно. Верни только валидный JSON без Markdown с полями status (questions или prompt), questions (массив), final_prompt, rationale, techniques (массив), used_knowledge (число)." },
          { role: "user", content: userText }
        ],
        temperature: 0.35,
        max_tokens: 1400,
        response_format: { type: "json_object" }
      });
      const text = response.choices?.[0]?.message?.content || "";
      try { return JSON.parse(text.replace(/^\\s*```json/i, "").replace(/```\\s*$/, "")); }
      catch { return { status: "prompt", final_prompt: text, used_knowledge: 0 }; }
    },

    analyze: async (prompt) => {
      if (!engine) throw new Error("Сначала загрузи модель.");
      const response = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "Ты — эксперт по анализу промтов. Проанализируй данный промт по смыслу, а не только по ключевым словам. Выяви назначение, структуру, техники, сильные и слабые стороны. Извлекай только переносимые правила, которые могут помочь в других задачах; не сохраняй содержание, специфичное только для этого промта. Предложи улучшенную версию. Верни только валидный JSON без Markdown с полями summary, elements (массив объектов name и description), techniques (массив объектов name и why), strengths (массив строк), weaknesses (массив строк), reusable_rules (массив строк), improved_prompt. Не выдумывай отсутствующие элементы." },
          { role: "user", content: "Проанализируй этот промт:\\n\\n" + prompt }
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      });
      const text = response.choices?.[0]?.message?.content || "{}";
      try { return JSON.parse(text.replace(/^\\s*```json/i, "").replace(/```\\s*$/, "")); }
      catch { throw new Error("Не удалось разобрать ответ модели. Попробуй повторить анализ."); }
    }
  };
}
