/* 4PHILLY — fills the official PA Standard Right-to-Know Law Request Form (OOR)
   entirely in the browser with pdf-lib. Nothing is uploaded. */
(function(root){
  'use strict';
  var CHECK={
    submittedVia:{email:'Email',mail:'US Mail',fax:'Fax',person:'In Person'},
    respondVia:{email:'Email_2',mail:'US Mail_2'},
    contactVia:{phone:'Telephone_2',email:'Email_4',mail:'US Mail_3'},
    copies:{printed:'Yes printed',electronic:'Yes electronic',inspect:'No inperson inspection'},
    certified:{yes:'Yes may be subject to additional costs',no:'No'}
  };
  var AFFIRM='By checking this box I affirm that my full name and contact information is true and correct';
  var FEE_CUSTOM_BOX='I understand that my request may incur fees Notify me before further processing if fees will'; // the box printed before "$____"

  // Characters the PDF's built-in Helvetica (WinAnsi) can print.
  var PRINTABLE=/^[\t\n\r\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]$/;
  function userError(msg){ var e=new Error(msg); e.userMessage=msg; return e; }
  function checkChars(label,val){
    var bad=Array.from(String(val||'')).filter(function(c){ return !PRINTABLE.test(c); });
    if(bad.length) throw userError(label+' contains a character the official form can\'t print ('+bad.slice(0,3).join(' ')+'). Use plain letters and numbers.');
  }
  function setText(form,name,val,size){
    var f=form.getTextField(name);
    f.setText(val==null?'':String(val));
    if(size) sizeField(f,size);
  }
  // A few fields in the official PDF (e.g. Zip) ship without a /DA entry; give them one.
  function sizeField(f,size){
    try{ f.setFontSize(size); }
    catch(e){ f.acroField.setDefaultAppearance('/Helv '+size+' Tf 0 g'); f.setFontSize(size); }
  }
  function setBox(form,name,on){
    var c=form.getCheckBox(name);
    if(on) c.check(); else c.uncheck();
  }
  // Split the records text between the page-1 box and the "continued" page-2 box.
  function splitRecords(text,font,size,width,maxLines){
    var lines=[];
    String(text).split(/\r?\n/).forEach(function(para){
      if(!para.trim()){ lines.push(''); return; }
      var cur='';
      para.split(/\s+/).forEach(function(w){
        while(w && font.widthOfTextAtSize(w,size)>width){ // a single word wider than the box: hard-break it
          var n=w.length; while(n>1 && font.widthOfTextAtSize(w.slice(0,n),size)>width) n--;
          if(cur){ lines.push(cur); cur=''; }
          lines.push(w.slice(0,n)); w=w.slice(n);
        }
        if(!w) return;
        var t=cur?cur+' '+w:w;
        if(font.widthOfTextAtSize(t,size)<=width) cur=t; else { if(cur) lines.push(cur); cur=w; }
      });
      if(cur) lines.push(cur);
    });
    return {first:lines.slice(0,maxLines).join('\n'), rest:lines.slice(maxLines).join('\n')};
  }

  // d: {agency,date,submittedVia,name,company,respondVia,email,address,city,state,zip,phone,
  //     contactVia,affirm,records,copies,feeAck,feeCap('100'|'custom'),feeAmount,certified}
  async function fillRtkForm(PDFLib,pdfBytes,d){
    var doc=await PDFLib.PDFDocument.load(pdfBytes,{updateMetadata:false}); // keep the official form's own metadata; don't stamp a producer or fill time
    var form=doc.getForm();
    var font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var LABELS=[['Agency',d.agency,'SUBMITTED TO AGENCY NAME',9],['Name',d.name,'Full Name',11],['Company',d.company,'Company if applicable',11],
      ['Email',d.email,'Email_3',11],['Mailing address',d.address,'Mailing Address',11],['City',d.city,'City',10],
      ['State',d.state,'State',10],['Zip',d.zip,'Zip',(d.zip||'').length>5?8:10],['Telephone',d.phone,'Telephone',10],['Fee amount',d.feeCap==='custom'?d.feeAmount:'','undefined',9]];
    LABELS.forEach(function(L){
      checkChars(L[0],L[1]);
      var w=form.getTextField(L[2]).acroField.getWidgets()[0].getRectangle().width-6;
      if(L[1] && font.widthOfTextAtSize(String(L[1]),L[3])>w) throw userError(L[0]+' is too long for its box on the official form. Shorten it.');
    });
    checkChars('Records requested',d.records);
    setText(form,'SUBMITTED TO AGENCY NAME',d.agency,9);
    setText(form,'Date Request Submitted',d.date,10);
    Object.keys(CHECK.submittedVia).forEach(function(k){ setBox(form,CHECK.submittedVia[k],d.submittedVia===k); });
    setText(form,'Full Name',d.name,11);
    setText(form,'Company if applicable',d.company,11);
    Object.keys(CHECK.respondVia).forEach(function(k){ setBox(form,CHECK.respondVia[k],d.respondVia===k); });
    setText(form,'Email_3',d.email,11);
    setText(form,'Mailing Address',d.address,11);
    setText(form,'City',d.city,10);
    setText(form,'State',d.state,10);
    setText(form,'Zip',d.zip,(d.zip||'').length>5?8:10);
    setText(form,'Telephone',d.phone,10);
    Object.keys(CHECK.contactVia).forEach(function(k){ setBox(form,CHECK.contactVia[k],d.contactVia===k); });
    setBox(form,AFFIRM,!!d.affirm);

    var size=10, lead=12;
    var f1=form.getTextField('Records Requested1'), f2=form.getTextField('Records Requested2');
    f1.enableMultiline(); f2.enableMultiline();
    var w1=f1.acroField.getWidgets()[0].getRectangle(), w2=f2.acroField.getWidgets()[0].getRectangle();
    var parts=splitRecords(d.records,font,size,w1.width-10,Math.floor((w1.height-6)/lead));
    var cap2=Math.floor((w2.height-6)/lead);
    var rest=splitRecords(parts.rest,font,size,w2.width-10,cap2);
    f1.setText(parts.first); sizeField(f1,size);
    f2.setText(rest.first); sizeField(f2,size);
    var overflow=rest.rest?true:false;

    Object.keys(CHECK.copies).forEach(function(k){ setBox(form,CHECK.copies[k],d.copies===k); });
    setBox(form,'100 or',d.feeCap==='100');
    setBox(form,FEE_CUSTOM_BOX,d.feeCap==='custom');
    setText(form,'undefined',d.feeCap==='custom'?d.feeAmount:'',9);
    Object.keys(CHECK.certified).forEach(function(k){ setBox(form,CHECK.certified[k],d.certified===k); });

    form.updateFieldAppearances(font);
    var bytes=await doc.save();
    return {bytes:bytes,overflow:overflow};
  }
  root.RtkForm={fill:fillRtkForm};
  if(typeof module!=='undefined') module.exports=root.RtkForm;
})(typeof window!=='undefined'?window:globalThis);
