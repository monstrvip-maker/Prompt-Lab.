import { pipeline, env } from "@huggingface/transformers";

let generator = null;
let loading = null;
env.allowLocalModels = false;
env.useBrowserCache = true;

function extractText(result) {
  const value = result?.[0]?.generated_text ?? result?.generated_text ?? "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last?.content === "string" ? last.content : JSON.stringify(last);
  }
  return String(value || "");
}
function parseJson(text) {
  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Модель вернула ответ без JSON. Повтори запрос.");
  return JSON.parse(clean.slice(start, end + 1));
}
function promptFor(system, user) {
  return "<|im_start|>system\n" + system + "<|im_end|>\n<|im_start|>user\n" + user + "<|im_end|>\n<|im_start|>assistant\n";
}
const generationRules = "Ты — эксперт по prompt engineering. Понимай цель пользователя, не склеивай ответы в шаблон. Если критически не хватает информации, задай до 3 конкретных вопросов и верни JSON {\"status\":\"questions\",\"questions\":[...],\"final_prompt\":\"\"}. Иначе составь профессиональный промт с ролью, целью, контекстом, входными данными, шагами, ограничениями, критериями качества и форматом результата. Применяй полезные техники и подтверждённые знания библиотеки. Не выдумывай факты. Верни только JSON {\"status\":\"prompt\",\"questions\":[],\"final_prompt\":\"готовый промт\",\"rationale\":\"почему так построен\",\"techniques\":[...],\"used_knowledge\":число}.";
const analysisRules = "Ты — эксперт по анализу промтов. Анализируй смысл, назначение, структуру, техники, сильные и слабые стороны. Извлекай только переносимые правила, не сохраняй частные сведения из исходного текста. Верни только JSON: {\"summary\":\"...\",\"elements\":[{\"name\":\"...\",\"description\":\"...\"}],\"techniques\":[{\"name\":\"...\",\"why\":\"...\"}],\"strengths\":[\"...\"],\"weaknesses\":[\"...\"],\"reusable_rules\":[\"...\"],\"improved_prompt\":\"...\"}.";
export function initLocalAI() {
 return {
  isReady:()=>!!generator,
  load:async(modelId,onProgress=()=>{})=>{
   if(generator)return generator;
   if(loading)return loading;
   loading=(async()=>{
    onProgress({text:"Подготовка локального ИИ на процессоре (без WebGPU)…",progress:0});
    onProgress({text:"Загрузка Qwen 0.5B из хранилища модели…",progress:1});
    const pipe=await pipeline("text-generation","onnx-community/Qwen2.5-0.5B-Instruct",{
      device:"wasm",
      dtype:"q4",
      progress_callback:(p)=>{
       const total=Number(p.total)||0, loaded=Number(p.loaded)||0;
       const percent=total>0?Math.max(1,Math.min(99,Math.round(loaded/total*100))):0;
       const file=p.file?String(p.file).split("/").pop():"файлы модели";
       const status=p.status==="progress"?"Загрузка "+file+"…":p.status==="done"?"Подготовлен "+file:p.status==="ready"?"Модель готова":("Подготовка "+file+"…");
       onProgress({text:status,progress:percent});
      }
    });
    generator=pipe;
    onProgress({text:"Локальная модель Qwen 0.5B готова на процессоре",progress:100});
    return generator;
   })();
   try{return await loading;}finally{loading=null;}
  },
  generate:async(input)=>{
   if(!generator)throw new Error("Сначала загрузи локальную модель.");
   const knowledge=(input.knowledge||[]).slice(0,20).map((x,i)=>(i+1)+". "+x).join("\n");
   const user=["ЗАДАЧА:",input.task,"Роль: "+(input.role||"определи сам"),"Контекст: "+(input.context||"не указан"),"Ограничения: "+(input.limits||"определи необходимые"),"Формат: "+(input.format||"выбери подходящий"),"Ответы на уточнения: "+(input.clarifications||"нет"),"ПОДТВЕРЖДЁННЫЕ ЗНАНИЯ:",knowledge||"пока нет"].join("\n");
   const result=await generator(promptFor(generationRules,user),{max_new_tokens:1100,do_sample:false,return_full_text:false});
   return parseJson(extractText(result));
  },
  analyze:async(prompt)=>{
   if(!generator)throw new Error("Сначала загрузи локальную модель.");
   const result=await generator(promptFor(analysisRules,"Проанализируй этот промт:\n"+prompt),{max_new_tokens:1100,do_sample:false,return_full_text:false});
   return parseJson(extractText(result));
  }
 };
}
