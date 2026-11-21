import { pipeline, env } from "@huggingface/transformers";

let generator = null;
let loading = null;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

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
  const clean = text.replace(/^\x60\x60\x60json\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Модель вернула ответ без JSON. Повтори запрос.");
  return JSON.parse(clean.slice(start, end + 1));
}
function promptFor(system, user) {
  return "<|im_start|>system\n" + system + "<|im_end|>\n<|im_start|>user\n" + user + "<|im_end|>\n<|im_start|>assistant\n";
}
const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const generationRules = "Ты — эксперт по prompt engineering. Понимай цель пользователя, не склеивай ответы в шаблон. Если критически не хватает информации, задай до 3 конкретных вопросов и верни JSON {\"status\":\"questions\",\"questions\":[...],\"final_prompt\":\"\"}. Иначе составь профессиональный промт с ролью, целью, контекстом, входными данными, шагами, ограничениями, критериями качества и форматом результата. Применяй полезные техники и подтверждённые знания библиотеки. Не выдумывай факты. Верни только JSON {\"status\":\"prompt\",\"questions\":[],\"final_prompt\":\"готовый промт\",\"rationale\":\"почему так построен\",\"techniques\":[...],\"used_knowledge\":число}.";
const analysisRules = "Ты — эксперт по анализу промтов. Анализируй смысл, назначение, структуру, техники, сильные и слабые стороны. Извлекай только переносимые правила, не сохраняй частные сведения из исходного текста. Верни только JSON: {\"summary\":\"...\",\"elements\":[{\"name\":\"...\",\"description\":\"...\"}],\"techniques\":[{\"name\":\"...\",\"why\":\"...\"}],\"strengths\":[\"...\"],\"weaknesses\":[\"...\"],\"reusable_rules\":[\"...\"],\"improved_prompt\":\"...\"}.";
export function initLocalAI() {
 return {
  isReady:()=>!!generator,
  load:async(_modelId,onProgress=()=>{})=>{
   if(generator)return generator;
   if(loading)return loading;
   loading=(async()=>{
    const report=(text,progress=0,stage="init")=>onProgress({text,progress,stage});
    report("Проверяю соединение с хранилищем модели Hugging Face…",0,"network");
    const checkUrl="https://huggingface.co/"+MODEL_ID+"/resolve/main/config.json";
    let response;
    try {
      response=await Promise.race([
        fetch(checkUrl,{method:"GET",cache:"no-store"}),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("Хранилище модели не ответило за 20 секунд. Проверь VPN/интернет или доступ к huggingface.co.")),20000))
      ]);
    } catch(e) { throw new Error("Не удаётся связаться с Hugging Face: "+e.message); }
    if(!response.ok)throw new Error("Хранилище модели ответило HTTP "+response.status+". Не удалось получить config.json.");
    await response.json();
    report("Связь с Hugging Face есть. Загружаю файлы Qwen 0.5B…",1,"download");
    let lastEvent=Date.now();
    let lastStage="Загрузка файлов модели";
    let watchdog;
    const watch=new Promise((_,reject)=>{
      const check=()=>{if(Date.now()-lastEvent>90000)reject(new Error("90 секунд нет ответа от загрузчика модели. Возможны блокировка скачивания, нехватка памяти или остановка фоновой вкладки."));else watchdog=setTimeout(check,5000)};
      watchdog=setTimeout(check,5000);
    });
    const modelPromise=pipeline("text-generation",MODEL_ID,{
      device:"wasm",
      dtype:"q4",
      progress_callback:(p)=>{
        lastEvent=Date.now();
        const file=p.file?String(p.file).split("/").pop():"файлы модели";
        let percent=Number(p.progress);
        if(!Number.isFinite(percent)){
          const total=Number(p.total)||0,loaded=Number(p.loaded)||0;
          percent=total>0?loaded/total*100:0;
        }
        if(p.status==="progress_total"){
          lastStage="Загрузка модели: "+Math.round(Number(p.progress)||0)+"%";
          report(lastStage,Math.max(1,Math.min(99,Math.round(Number(p.progress)||1))),"download");
        }else if(p.status==="progress"){
          report("Загружаю "+file+" — "+Math.round(percent)+"%",Math.max(1,Math.min(99,Math.round(percent))),"download");
        }else if(p.status==="done"){
          report("Файл загружен: "+file,Math.max(1,Math.min(99,Math.round(percent)||1)),"download");
        }else if(p.status==="initiate"||p.status==="download"){
          report("Подключаю файл модели: "+file,1,"download");
        }else{
          report("Подготовка файла модели: "+file,1,"download");
        }
      }
    });
    try{
      const pipe=await Promise.race([modelPromise,watch]);
      clearTimeout(watchdog);
      generator=pipe;
      report("Qwen 0.5B загружена и готова на процессоре",100,"ready");
      return generator;
    }catch(e){clearTimeout(watchdog);throw e;}
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
