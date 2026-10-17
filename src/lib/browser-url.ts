/** Normalize a human-entered URL for the MANUAL browser address bar only. */
export function normalizeBrowserAddress(input:string):string {
  const raw=input.trim();
  if(!raw||raw.length>2048)throw new Error("أدخل عنوان موقع صالح");
  const full=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
  let url:URL;
  try{url=new URL(full);}catch{throw new Error("عنوان الموقع غير صالح");}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||!url.hostname.includes(".")) {
    throw new Error("يُسمح فقط بروابط HTTP وHTTPS العادية");
  }
  return url.href;
}
