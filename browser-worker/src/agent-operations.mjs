import { safeNavigationLink, safeTextControl, validateScopedAgentUrl } from "./policy.mjs";

/**
 * A model may only name element IDs returned by inspectPage(). Never accept
 * CSS, JS, XPath, arbitrary clicks, keyboard shortcuts or form submissions.
 */
export async function inspectPage(page) {
  const title = await page.title().catch(()=>"");
  const body = (await page.locator("body").innerText({timeout:5000}).catch(()=>"")).slice(0,6500);
  const controls = await page.evaluate(() => {
    const nodes=[...document.querySelectorAll("a[href],button,input,textarea,[role=button]")]
      .filter(el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=="hidden").slice(0,45);
    return nodes.map((el,index)=>{
      const tag=el.tagName;
      const id="paw-"+index+"-"+Math.random().toString(36).slice(2,10).padEnd(8,"0");
      el.setAttribute("data-paw-agent-id",id);
      const kind=tag==="A"?"link":tag==="INPUT"||tag==="TEXTAREA"?"field":"button";
      const label=(el.getAttribute("aria-label")||el.getAttribute("placeholder")||
        el.innerText||el.getAttribute("title")||"").trim().slice(0,120);
      return {id,kind,label,type:el.getAttribute("type")||"",href:tag==="A"?el.href:null};
    });
  });
  return {title,url:page.url(),untrustedPageText:body,controls};
}

export async function runSafeAgentAction(page,data,origin) {
  validateScopedAgentUrl(page.url(),origin);
  if(data.action==="scroll"){
    const delta=data.direction==="down"?650:data.direction==="up"?-650:null;
    if(delta===null)throw new Error("invalid_agent_action");
    await page.evaluate(y=>window.scrollBy({top:y,behavior:"instant"}),delta);
    return {action:"scroll",direction:data.direction};
  }
  if(!["follow_link","fill"].includes(data.action))throw new Error("unsupported_operation");
  if(typeof data.elementId!=="string"||!/^paw-\d{1,2}-[a-z0-9]{8}$/.test(data.elementId))
    throw new Error("invalid_agent_action");
  const element=page.locator('[data-paw-agent-id="'+data.elementId+'"]');
  if((await element.count())!==1)throw new Error("element_not_found");
  const props=await element.evaluate(el=>({
    tag:el.tagName,type:el.getAttribute("type")||"",
    disabled:el.disabled===true,readOnly:el.readOnly===true,
    href:el.tagName==="A"?el.href:null,
    label:(el.innerText||el.getAttribute("aria-label")||"").slice(0,120),
  }));
  if(data.action==="follow_link"){
    if(props.tag!=="A"||!props.href)throw new Error("agent_action_requires_manual_review");
    const href=safeNavigationLink(props.href,props.label,origin);
    const guard=async(route)=>{
      try{
        const request=route.request();
        if(request.isNavigationRequest()&&request.frame()===page.mainFrame())
          validateScopedAgentUrl(request.url(),origin);
        await route.continue();
      }catch{await route.abort("blockedbyclient").catch(()=>{});}
    };
    await page.route("**/*",guard);
    try{await page.goto(href,{waitUntil:"domcontentloaded",timeout:12000});}
    finally{await page.unroute("**/*",guard);}
    validateScopedAgentUrl(page.url(),origin);
    return {action:"follow_link",url:page.url()};
  }
  if(!safeTextControl(props.tag,props.type,props.disabled,props.readOnly))
    throw new Error("agent_action_requires_manual_review");
  if(typeof data.text!=="string"||data.text.length>500)throw new Error("invalid_agent_action");
  await element.fill(data.text,{timeout:5000});
  validateScopedAgentUrl(page.url(),origin);
  return {action:"fill",field:props.label};
}
