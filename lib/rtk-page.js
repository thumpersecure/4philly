/* 4PHILLY — Right-to-Know request page. Fills the official PA Office of Open Records
   Standard RTKL Request Form in the browser (pdf-lib). Nothing is uploaded or stored,
   except the requester's name in localStorage ("Clear my data" removes it). */
(function(){
  'use strict';
  var $=function(id){ return document.getElementById(id); };
  var NAME_KEY='4p_tenant_name';
  var dirty=false; // true once the user hand-edits the records text
  var q, qOpa, qCases;

  // Printable range of the PDF's built-in font; anything else is dropped from link values.
  function clean(s,max){ return String(s||'').replace(/[^ -~ -ÿ–—‘’“”]/g,' ').replace(/[<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }

  // ---- Pre-fill from the link a lookup builds: rtk.html#addr=...&opa=...&cases=a,b,c ----
  // (A fragment is never sent to any server.)
  function readFragment(){
    q=new URLSearchParams(location.hash.replace(/^#/,''));
    qOpa=(q.get('opa')||'').trim();
    qCases=(q.get('cases')||'').split(',').map(function(c){ return c.trim(); })
      .filter(function(c){ return /^[A-Za-z0-9-]{3,24}$/.test(c); }).slice(0,60);
  }
  function prefill(){
    $('rtk-prop-addr').value=clean(q.get('addr'),120);
    $('rtk-prop-opa').value=/^\d{6,12}$/.test(qOpa)?qOpa:'';
    $('rtk-prop-cases').value=qCases.join(', ');
    refreshRecords();
  }

  function buildRecords(){
    var addr=clean($('rtk-prop-addr').value,120);
    var opa=($('rtk-prop-opa').value||'').replace(/\D/g,'').slice(0,12);
    var cases=($('rtk-prop-cases').value||'').split(/[,\s]+/).filter(function(c){ return /^[A-Za-z0-9-]{3,24}$/.test(c); }).slice(0,60);
    var where=(addr?addr+', Philadelphia, PA':'[property address]')+(opa?' (OPA account '+opa+')':'');
    return 'Pursuant to the Pennsylvania Right-to-Know Law, 65 P.S. § 67.101 et seq., I request copies of the following records for the property at '+where+':\n\n'+
      '1. All inspector notes, photographs, and correspondence'+(cases.length?' for L&I case numbers: '+cases.join(', ')+'.':' for this property.')+'\n'+
      '2. All inspection reports and findings for this property.\n'+
      '3. All correspondence between the Department of Licenses and Inspections and the property owner or management company.\n'+
      '4. All complaints filed with the Department regarding this property.\n\n'+
      'Time frame: all dates on file through the date of this request.';
  }
  function refreshRecords(){ if(!dirty) $('rtk-records').value=buildRecords(); }

  function toast(msg){
    var t=$('rtk-toast'); t.textContent=msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t=setTimeout(function(){ t.classList.remove('on'); },2600);
  }

  // ---- Read + validate the form ----
  function readForm(){
    var v=function(id){ return $(id).value.trim(); };
    var r=function(n){ return (document.querySelector('input[name="'+n+'"]:checked')||{}).value; };
    var d=new Date();
    return {
      agency:v('rtk-agency'),
      date:String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear(),
      submittedVia:v('rtk-via'),name:v('rtk-name'),company:v('rtk-company'),
      respondVia:v('rtk-resp'),email:v('rtk-email'),address:v('rtk-addr'),
      city:v('rtk-city'),state:v('rtk-state').toUpperCase(),zip:v('rtk-zip'),phone:v('rtk-phone'),
      contactVia:v('rtk-contact'),affirm:$('rtk-affirm').checked,
      records:$('rtk-records').value,
      copies:r('rtk-copies'),feeCap:r('rtk-fee'),
      feeAmount:v('rtk-fee-amt').replace(/[^0-9.,]/g,''),certified:r('rtk-cert')
    };
  }
  // Returns null when fine, else {msg, id} where id is the control the user must fix.
  function problem(d){
    var haveAddr=d.address&&d.city&&d.state&&d.zip;
    if(!d.name) return {msg:'Enter your full name.',id:'rtk-name'};
    if(!d.affirm) return {msg:'Check the box confirming your name and contact info are true and that you are a U.S. legal resident — the form requires it.',id:'rtk-affirm'};
    if(d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return {msg:'That email address doesn’t look right. Check it and try again.',id:'rtk-email'};
    if(d.respondVia==='email'&&!d.email) return {msg:'You chose a response by email — enter your email address.',id:'rtk-email'};
    if(d.respondVia==='mail'&&!haveAddr) return {msg:'You chose a response by mail — enter your full mailing address.',id:'rtk-addr'};
    if(d.contactVia==='phone'&&!d.phone) return {msg:'You chose to be contacted by telephone — enter a phone number.',id:'rtk-phone'};
    if(d.contactVia==='email'&&!d.email) return {msg:'You chose to be contacted by email — enter your email address.',id:'rtk-email'};
    if(d.contactVia==='mail'&&!haveAddr) return {msg:'You chose to be contacted by mail — enter your full mailing address.',id:'rtk-addr'};
    if(d.feeCap==='custom'&&!(/^\d[\d,]*(\.\d{1,2})?$/.test(d.feeAmount)&&parseFloat(d.feeAmount.replace(/,/g,''))>0)) return {msg:'Enter the fee limit as a dollar amount, like 75 or 250.50 — or pick $100.',id:'rtk-fee-amt'};
    if(!d.records.trim()) return {msg:'Describe the records you are requesting.',id:'rtk-records'};
    if(/\[property address\]/.test(d.records)) return {msg:'Enter the property address above (or edit the records text) — the form can’t go out with a placeholder.',id:'rtk-prop-addr'};
    if(d.records.length>6000||/\S{300,}/.test(d.records)) return {msg:'The records text is too long, or has a very long unbroken string, to fit on the form. Shorten it.',id:'rtk-records'};
    return null;
  }
  var bad=null;
  function clearBad(){ if(bad){ bad.removeAttribute('aria-invalid'); bad.removeAttribute('aria-describedby'); bad=null; } }
  function showErr(msg,id){
    var e=$('rtk-err'); clearBad();
    e.style.display='none'; e.textContent='';               // reset so a repeated message is announced again
    if(!msg) return;
    e.textContent=msg; e.style.display='block';
    var f=id&&$(id);
    if(f){ f.setAttribute('aria-invalid','true'); f.setAttribute('aria-describedby','rtk-err'); bad=f; f.focus(); f.scrollIntoView({block:'center'}); }
    else e.scrollIntoView({block:'center'});
  }

  function loadScriptOnce(src){
    return new Promise(function(res,rej){
      var old=document.querySelector('script[data-lazy="'+src+'"]');
      if(old&&old.dataset.ok==='1') return res();
      if(old) old.remove();                                  // a failed earlier attempt: try again from scratch
      var sc=document.createElement('script');
      sc.src=src; sc.dataset.lazy=src;
      sc.onload=function(){ sc.dataset.ok='1'; res(); };
      sc.onerror=function(){ sc.remove(); rej(new Error('Could not load '+src)); };
      document.head.appendChild(sc);
    });
  }

  var busy=false;
  async function download(){
    if(busy) return;
    var d=readForm(), prob=problem(d);
    $('rtk-done').style.display='none';
    if(prob){ showErr(prob.msg,prob.id); return; }
    showErr('');
    busy=true;
    var btn=$('rtk-download'), label=btn.textContent; btn.disabled=true; btn.textContent='Filling the official form…';
    try{
      await loadScriptOnce('lib/pdf-lib.min.js');
      await loadScriptOnce('lib/rtk-fill.js');
      var resp=await fetch('forms/RTKRequestForm.pdf');
      if(!resp.ok) throw new Error('the form file is unavailable ('+resp.status+')');
      var out=await window.RtkForm.fill(window.PDFLib,await resp.arrayBuffer(),d);
      if(out.overflow){ showErr('Your records text is too long for the form’s two boxes. Shorten it, or attach extra pages as the form allows.','rtk-records'); return; }
      var url=URL.createObjectURL(new Blob([out.bytes],{type:'application/pdf'}));
      var a=document.createElement('a');
      var opa=($('rtk-prop-opa').value||'').replace(/\D/g,'');
      a.href=url; a.download='RTK-Request'+(opa?'-'+opa:'')+'.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); },10000);
      try{ localStorage.setItem(NAME_KEY,d.name); }catch(e){}
      var done=$('rtk-done'); done.style.display='block'; done.focus();   // moving focus makes screen readers read it
      toast('Official form downloaded');
    }catch(e){
      showErr(e.userMessage||('Couldn’t build the PDF: '+e.message+'. You can still download the blank form from the government site below and copy the records text.'));
    }finally{ busy=false; btn.disabled=false; btn.textContent=label; }
  }

  // ---- Wire up ----
  document.addEventListener('DOMContentLoaded',function(){
    readFragment();
    prefill();
    try{ $('rtk-name').value=localStorage.getItem(NAME_KEY)||''; }catch(e){}
    ['rtk-prop-addr','rtk-prop-opa','rtk-prop-cases'].forEach(function(id){ $(id).addEventListener('input',refreshRecords); });
    $('rtk-records').addEventListener('input',function(){ dirty=true; $('rtk-reset-text').style.display='inline'; });
    $('rtk-reset-text').addEventListener('click',function(){ dirty=false; $('rtk-reset-text').style.display='none'; refreshRecords(); });
    // A new link pasted/clicked into this same tab: show the new property, not the old one.
    window.addEventListener('hashchange',function(){ readFragment(); dirty=false; $('rtk-reset-text').style.display='none'; prefill(); });
    $('rtk-fee-amt').addEventListener('input',function(){ document.querySelector('input[name="rtk-fee"][value="custom"]').checked=true; });
    $('rtk-form').addEventListener('input',clearBad);
    $('rtk-form').addEventListener('change',clearBad);
    // The Download button is a submit button, so Enter in any field works too.
    $('rtk-form').addEventListener('submit',function(e){ e.preventDefault(); download(); });
    $('rtk-copy-records').addEventListener('click',function(){
      var ta=$('rtk-records');
      (navigator.clipboard?navigator.clipboard.writeText(ta.value):Promise.reject()).then(function(){ toast('Records text copied'); })
        .catch(function(){ ta.select(); document.execCommand('copy'); toast('Records text copied'); });
    });
    $('rtk-clear').addEventListener('click',function(){
      try{ localStorage.removeItem(NAME_KEY); }catch(e){}
      $('rtk-name').value=''; toast('Saved name cleared');
    });
  });
})();
