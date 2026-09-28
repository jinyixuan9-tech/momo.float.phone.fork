export type BilingualText = { ko: string; zh: string };

export async function translateTheqooTexts(texts: Record<string,string>): Promise<Record<string,BilingualText>> {
  const entries=Object.entries(texts).filter(([,value])=>value.trim());
  if(!entries.length)throw new Error("请先输入文字。");
  const response=await fetch("/api/theqoo/translate",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ texts:Object.fromEntries(entries.map(([key,value])=>[key,value.trim()])) }),
  });
  const data=await response.json().catch(()=>null) as {result?:Record<string,BilingualText>;message?:string}|null;
  if(!response.ok||!data?.result)throw new Error(data?.message||"Theqoo 翻译暂时失败，请重试。");
  for(const [key] of entries){const pair=data.result[key];if(!pair?.ko?.trim()||!pair?.zh?.trim())throw new Error(`翻译缺少「${key}」的中韩文本，请重试。`);}
  return data.result;
}
