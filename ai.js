import { CreateMLCEngine } from "@mlc-ai/web-llm";

let engine = null;
let loading = null;

export function initLocalAI() {
  return {
    isReady: () => !!engine,
    load: async (modelId, onProgress = () => {}) => {
      if (engine && engine.modelId === modelId) return engine;
      if (loading) return loading;
      if (!navigator.gpu) throw new Error("WebGPU не обнаружен. Обнови Chrome и проверь поддержку WebGPU на устройстве.");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("Браузер не смог запустить WebGPU на этом устройстве.");
      loading = (async () => {
        engine = null;
        const next = await CreateMLCEngine(modelId, {
          initProgressCallback: (p) => onProgress({
            text: p.text || "Загрузка модели…",
            progress: Math.round((p.progress || 0) * 100)
          })
        });
        next.modelId = modelId;
        engine = next;
        return engine;
      })();
      try { return await loading; } finally { loading = null; }
    },

    generate: async (input) => {
      if (!engine) throw new Error("Сначала загрузи модель.");
      const knowledge = (input.knowledge || []).slice(0, 25).map((x, i) => (i + 1) + ". " + x).join("\n");
      const userText = [
        "ЗАДАЧА ПОЛЬЗОВАТЕЛЯ:", input.task,
        "ДОПОЛНИТЕЛЬНЫЕ ПОЛЯ:",
        "Роль: " + (input.role || "не задана"),
        "Контекст: " + (input.context || "не задан"),
        "Ограничения: " + (input.limits || "не заданы"),
        "Желаемый формат: " + (input.format || "выбери сам"),
        "Ответы на уточнения: " + (input.clarifications || "пока нет"),
        "ПОДТВЕРЖДЁННЫЕ ЗНАНИЯ ИЗ БИБЛИОТЕКИ:", knowledge || "пока нет"
      ].join("\n");
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
      try {
        return JSON.parse(text.replace(/^\s*```json/i, "").replace(/```\s*$/, ""));
      } catch {
        return { status: "prompt", final_prompt: text, used_knowledge: 0 };
      }
    },

    analyze: async (prompt) => {
      if (!engine) throw new Error("Сначала загрузи модель.");
      const response = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "Ты — эксперт по анализу промтов. Проанализируй данный промт по смыслу, а не только по ключевым словам. Выяви назначение, структуру, техники, сильные и слабые стороны. Извлекай только переносимые правила, которые могут помочь в других задачах; не сохраняй содержание, специфичное только для этого промта. Предложи улучшенную версию. Верни только валидный JSON без Markdown с полями summary, elements (массив объектов name и description), techniques (массив объектов name и why), strengths (массив строк), weaknesses (массив строк), reusable_rules (массив строк), improved_prompt. Не выдумывай отсутствующие элементы." },
          { role: "user", content: "Проанализируй этот промт:\n\n" + prompt }
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      });
      const text = response.choices?.[0]?.message?.content || "{}";
      try {
        return JSON.parse(text.replace(/^\s*```json/i, "").replace(/```\s*$/, ""));
      } catch {
        throw new Error("Не удалось разобрать ответ модели. Попробуй повторить анализ.");
      }
    }
  };
}
