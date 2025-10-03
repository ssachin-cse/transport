/* Transport Manager — Pure HTML/JS (IndexedDB) */
(function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const formatINR = v => '₹' + (Number(v||0)).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});

  // Tabs
  $$('.sidebar nav a').forEach(a=>a.addEventListener('click',()=>{
    $$('.sidebar nav a').forEach(x=>x.classList.remove('active'));
    a.classList.add('active');
    const tab = a.dataset.tab;
    $$('.tab').forEach(t=>t.classList.remove('active'));
    $('#tab-' + tab).classList.add('active');
    if(tab==='drivers') loadDrivers();
    if(tab==='attendance') { fillAttendanceDrivers(); loadAttendance(); }
    if(tab==='vehicles') loadVehicles();
    if(tab==='records') { fillLookups(); loadRecords(); }
    if(tab==='dash') refreshDashboard();
  }));

    
  // IndexedDB setup
  let db;
  const req = indexedDB.open('transport_offline_db', 3);
  req.onupgradeneeded = e => {
    db = e.target.result;
    const drivers = db.createObjectStore('drivers', { keyPath: 'id', autoIncrement: true });
    const attendance = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
    const vehicles = db.createObjectStore('vehicles', { keyPath: 'id', autoIncrement: true });
    const records = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });


    drivers.createIndex('name', 'name', { unique: false });
    attendance.createIndex('date', 'date', { unique: false });
    vehicles.createIndex('vehicle_no', 'vehicle_no', { unique: false });
    records.createIndex('rdate', 'rdate', { unique: false });
  };
  req.onsuccess = e => { db = e.target.result; initializeDefaults(); refreshDashboard(); };
  req.onerror = e => alert('DB error: ' + e.target.error);

  function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
  function all(store){ return new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
  function add(store, obj){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').add(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function put(store, obj){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').put(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  function del(store, id){ return new Promise((res,rej)=>{ const r=tx(store,'readwrite').delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

  function today(){ return new Date().toISOString().slice(0,10); }

  // Initialize defaults (set today's date in form)
  function initializeDefaults(){
    const d = $('#form-record [name=rdate]'); if(d) d.value = today();
    const a = $('#form-attendance [name=adate]'); if(a) a.value = today();
  }

  // ------- Drivers -------
  $('#form-driver').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value.trim(),
      mobile: f.mobile.value.trim(),
      license_no: f.license_no.value.trim(),
      aadhaar_no: f.aadhaar_no.value.trim(),
      pan_no: f.pan_no.value.trim(),
      epf_no: f.epf_no.value.trim(),
      esi_no: f.esi_no.value.trim(),
      insurance_no: f.insurance_no.value.trim(),
    };
    const files = ['doc_license','doc_aadhaar','doc_pan','doc_esi','doc_insurance'];
    for(const k of files){
      const file = f[k].files[0];
      if(file){
        if(file.size > 10*1024*1024){ alert('File too large (max 10MB): ' + k); return; }
        const ok = ['image/jpeg','image/png','application/pdf'].includes(file.type);
        if(!ok){ alert('Invalid type for ' + k); return; }
        data[k] = await fileToStored(file);
      }
    }
    await add('drivers', data);
    f.reset();
    loadDrivers();
    fillLookups();
  });

  async function loadDrivers(){
    const list = await all('drivers');
    $('#count-drivers').textContent = list.length;
    const tb = $('#table-drivers tbody'); tb.innerHTML='';
    for(const d of list){
      const docs = ['doc_license','doc_aadhaar','doc_pan','doc_esi','doc_insurance']
        .filter(k=>d[k])
        .map(k=>docLink(d[k], k.replace('doc_','').toUpperCase()))
        .join(' ');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHTML(d.name)}</td>
                      <td>${escapeHTML(d.mobile||'')}</td>
                      <td>${docs||'<span class="muted">None</span>'}</td>
                      <td><button class="danger small" data-del="${d.id}">Delete</button></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', async ()=>{
      if(confirm('Delete this driver?')){ await del('drivers', Number(btn.dataset.del)); loadDrivers(); fillLookups(); }
    }));
  }


  $('#form-attendance')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const f = e.target;
    const data = {
      adate: f.adate.value,
      driver_id: Number(f.driver_id.value),
      status: f.status.value,
      note: f.note.value.trim()
    };
    await add('attendance', data);
    f.reset(); f.adate.value = today();
    loadAttendance();
  });

  async function loadAttendance(){
    const [records, drivers] = await Promise.all([all('attendance'), all('drivers')]);
    const drvMap = new Map(drivers.map(d=>[d.id, d.name]));
    const tb = $('#table-attendance tbody'); tb.innerHTML='';
    if(records.length===0){ tb.innerHTML=`<tr><td colspan="5" class="muted">No records</td></tr>`; return; }
    for(const r of records.sort((a,b)=> b.adate.localeCompare(a.adate))){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.adate}</td>
        <td>${escapeHTML(drvMap.get(r.driver_id)||'')}</td>
        <td>${r.status}</td>
        <td>${escapeHTML(r.note||'')}</td>
        <td><button class="danger small" data-del="${r.id}">Delete</button></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', async ()=>{
      if(confirm('Delete this attendance record?')){ await del('attendance', Number(btn.dataset.del)); loadAttendance(); }
    }));
  }

  async function fillAttendanceDrivers(){
    const drivers = await all('drivers');
    const sel = $('#form-attendance [name=driver_id]');
    if(!sel) return;
    sel.innerHTML = '<option value="">— Select —</option>';
    for(const d of drivers){
      const o = new Option(d.name, d.id); sel.add(o);
    }
  }
  // ------- Vehicles -------
  $('#form-vehicle').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;
    const data = {
      vehicle_no: f.vehicle_no.value.trim(),
      model: f.model.value.trim(),
      vtype: f.vtype.value.trim(),
      owner: f.owner.value.trim(),
    };
    const files = ['doc_rc','doc_permit','doc_fc','doc_insurance','doc_invoice'];
    for(const k of files){
      const file = f[k].files[0];
      if(file){
        if(file.size > 10*1024*1024){ alert('File too large (max 10MB): ' + k); return; }
        const ok = ['image/jpeg','image/png','application/pdf'].includes(file.type);
        if(!ok){ alert('Invalid type for ' + k); return; }
        data[k] = await fileToStored(file);
      }
    }
    await add('vehicles', data);
    f.reset();
    loadVehicles();
    fillLookups();
  });

  async function loadVehicles(){
    const list = await all('vehicles');
    $('#count-vehicles').textContent = list.length;
    const tb = $('#table-vehicles tbody'); tb.innerHTML='';
    for(const v of list){
      const docs = ['doc_rc','doc_permit','doc_fc','doc_insurance','doc_invoice']
        .filter(k=>v[k])
        .map(k=>docLink(v[k], k.replace('doc_','').toUpperCase()))
        .join(' ');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHTML(v.vehicle_no)}</td>
                      <td>${escapeHTML(v.model||'')}</td>
                      <td>${escapeHTML(v.vtype||'')}</td>
                      <td>${escapeHTML(v.owner||'')}</td>
                      <td>${docs||'<span class="muted">None</span>'}</td>
                      <td><button class="danger small" data-del="${v.id}">Delete</button></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', async ()=>{
      if(confirm('Delete this vehicle?')){ await del('vehicles', Number(btn.dataset.del)); loadVehicles(); fillLookups(); }
    }));
  }

  // ------- Records -------
  $('#form-record').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target;
    const data = {
      rdate: f.rdate.value,
      vehicle_id: f.vehicle_id.value? Number(f.vehicle_id.value) : null,
      driver_id: f.driver_id.value? Number(f.driver_id.value) : null,
      description: f.description.value.trim(),
      rtype: f.rtype.value,
      amount: Number(f.amount.value || 0),
      status: f.status.value,
      category: f.category.value,
      paymode: f.paymode.value,
      note: f.note.value.trim(),
      created_at: Date.now()
    };
    await add('records', data);
    f.reset(); f.rdate.value = today();
    loadRecords(); refreshDashboard();
  });

  async function loadRecords(){
    const [list, vehicles, drivers] = await Promise.all([all('records'), all('vehicles'), all('drivers')]);
    const vehMap = new Map(vehicles.map(v=>[v.id, v.vehicle_no]));
    const drvMap = new Map(drivers.map(d=>[d.id, d.name]));

    // Filters
    const f = $('#filters');
    const from = f.from.value;
    const to = f.to.value;
    const typ = f.typ.value;
    const veh = f.veh.value;
    const drv = f.drv.value;

    let rows = list.sort((a,b)=> (b.rdate.localeCompare(a.rdate)) || (b.id - a.id));
    rows = rows.filter(r => (!from || r.rdate >= from) && (!to || r.rdate <= to));
    rows = rows.filter(r => (!typ || r.rtype===typ) && (!veh || String(r.vehicle_id)===veh) && (!drv || String(r.driver_id)===drv));

    const tb = $('#table-records tbody'); tb.innerHTML='';
    let i=1;
    for(const r of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i++}</td>
        <td>${r.rdate}</td>
        <td>${escapeHTML(vehMap.get(r.vehicle_id)||'')}</td>
        <td>${escapeHTML(drvMap.get(r.driver_id)||'')}</td>
        <td>${escapeHTML(r.description||'')}</td>
        <td>${r.rtype}</td>
        <td>${formatINR(r.amount)}</td>
        <td>${r.status}</td>
        <td>${r.category}</td>
        <td>${r.paymode}</td>
        <td>${escapeHTML(r.note||'')}</td>
        <td><button class="danger small" data-del="${r.id}">Delete</button></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', async ()=>{
      if(confirm('Delete this record?')){ await del('records', Number(btn.dataset.del)); loadRecords(); refreshDashboard(); }
    }));
  }

  $('#filters').addEventListener('submit',(e)=>{ e.preventDefault(); loadRecords(); });

  async function fillLookups(){
    const [vehicles, drivers] = await Promise.all([all('vehicles'), all('drivers')]);
    const vehSelAdd = $('#form-record [name=vehicle_id]');
    const drvSelAdd = $('#form-record [name=driver_id]');
    const vehSelF = $('#filters [name=veh]');
    const drvSelF = $('#filters [name=drv]');
    vehSelAdd.innerHTML = '<option value="">— Select —</option>';
    drvSelAdd.innerHTML = '<option value="">— Select —</option>';
    vehSelF.innerHTML = '<option value="">All</option>';
    drvSelF.innerHTML = '<option value="">All</option>';
    for(const v of vehicles){
      const o1 = new Option(v.vehicle_no, v.id); vehSelAdd.add(o1);
      const o2 = new Option(v.vehicle_no, v.id); vehSelF.add(o2);
    }
    for(const d of drivers){
      const o1 = new Option(d.name, d.id); drvSelAdd.add(o1);
      const o2 = new Option(d.name, d.id); drvSelF.add(o2);
    }
  }

  // ------- Dashboard -------
  async function refreshDashboard(){
    const [records, vehicles, drivers] = await Promise.all([all('records'), all('vehicles'), all('drivers')]);
    const income = records.filter(r=>r.rtype==='Income').reduce((a,b)=>a+b.amount,0);
    const expense = records.filter(r=>r.rtype==='Expense').reduce((a,b)=>a+b.amount,0);
    $('#sum-income').textContent = formatINR(income);
    $('#sum-expense').textContent = formatINR(expense);
    $('#sum-net').textContent = formatINR(income - expense);
    $('#count-drivers').textContent = drivers.length;
    $('#count-vehicles').textContent = vehicles.length;

    const vehMap = new Map(vehicles.map(v=>[v.id, v.vehicle_no]));
    const drvMap = new Map(drivers.map(d=>[d.id, d.name]));
    const recent = [...records].sort((a,b)=>b.created_at-a.created_at).slice(0,10);
    const tb = $('#recent-records tbody'); tb.innerHTML='';
    for(const r of recent){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.rdate}</td>><td>${escapeHTML(vehMap.get(r.vehicle_id)||'')}</td><td>${escapeHTML(drvMap.get(r.driver_id)||'')}</td><td>${escapeHTML(r.description||'')}</td><td>${r.rtype}</td><td>${formatINR(r.amount)}</td>`;
      tb.appendChild(tr);
    }
  }

  // ------- Export CSV (Records) -------
  $('#export-records').addEventListener('click', async ()=>{
    const [records, vehicles, drivers] = await Promise.all([all('records'), all('vehicles'), all('drivers')]);
    const vehMap = new Map(vehicles.map(v=>[v.id, v.vehicle_no]));
    const drvMap = new Map(drivers.map(d=>[d.id, d.name]));
    const rows = [['S No','Date','Vehicle','Driver','Description','Type','Amount','Status','Category','Pay Mode','Note']];
    let i=1;
    for(const r of records.sort((a,b)=>a.rdate.localeCompare(b.rdate))){
      rows.push([i++, r.rdate, vehMap.get(r.vehicle_id)||'', drvMap.get(r.driver_id)||'', r.description||'', r.rtype, r.amount, r.status, r.category, r.paymode, r.note||'']);
    }
    downloadCSV(rows, 'records.csv');
  });

  // ------- Monthly Report -------
  $('#report-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    runReport(e.target.month.value);
  });

  async function runReport(monthStr){
    const [records, vehicles] = await Promise.all([all('records'), all('vehicles')]);
    const vehMap = new Map(vehicles.map(v=>[v.id, v.vehicle_no]));
    const first = monthStr ? (monthStr + '-01') : new Date().toISOString().slice(0,7) + '-01';
    const yyyy = first.slice(0,4), mm = first.slice(5,7);
    const last = new Date(Number(yyyy), Number(mm), 0).toISOString().slice(0,10);
    const inMonth = records.filter(r=> r.rdate >= first && r.rdate <= last);

    const income = inMonth.filter(r=>r.rtype==='Income').reduce((a,b)=>a+b.amount,0);
    const expense = inMonth.filter(r=>r.rtype==='Expense').reduce((a,b)=>a+b.amount,0);
    $('#rep-income').textContent = formatINR(income);
    $('#rep-expense').textContent = formatINR(expense);
    $('#rep-net').textContent = formatINR(income - expense);

    // Vehicle summary
    const map = new Map();
    for(const r of inMonth){
      const key = vehMap.get(r.vehicle_id) || '—';
      if(!map.has(key)) map.set(key, {inc:0,exp:0});
      if(r.rtype==='Income') map.get(key).inc += r.amount; else map.get(key).exp += r.amount;
    }
    const tbV = $('#rep-vehicle tbody'); tbV.innerHTML='';
    for(const [veh, val] of map){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHTML(veh)}</td><td>${formatINR(val.inc)}</td><td>${formatINR(val.exp)}</td><td>${formatINR(val.inc - val.exp)}</td>`;
      tbV.appendChild(tr);
    }

    // Category breakdown
    const cat = new Map();
    for(const r of inMonth.filter(x=>x.rtype==='Expense')){
      cat.set(r.category, (cat.get(r.category)||0) + r.amount);
    }
    const tbC = $('#rep-category tbody'); tbC.innerHTML='';
    for(const [c, v] of cat){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHTML(c)}</td><td>${formatINR(v)}</td>`;
      tbC.appendChild(tr);
    }

    // Export CSV for report
    $('#export-report').onclick = ()=>{
      const rows = [['Month', first.slice(0,7)], [], ['Total Income', income], ['Total Expense', expense], ['Net', income-expense], [], ['Vehicle','Income','Expense','Net']];
      for(const [veh, val] of map){ rows.push([veh, val.inc, val.exp, val.inc - val.exp]); }
      rows.push([]); rows.push(['Expense by Category','Amount']);
      for(const [c, v] of cat){ rows.push([c, v]); }
      downloadCSV(rows, `monthly_report_${first.slice(0,7)}.csv`);
    };
  }

  // ------- Backup / Restore -------
  $('#btn-backup').addEventListener('click', async ()=>{
    const [drivers, vehicles, records] = await Promise.all([all('drivers'), all('vehicles'), all('records')]);
    const obj = { ts: Date.now(), drivers, vehicles, records };
    const blob = new Blob([JSON.stringify(obj)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'transport_backup.json'; a.click();
    URL.revokeObjectURL(url);
  });

  $('#file-restore').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const json = JSON.parse(await file.text());
    const tx1 = db.transaction(['drivers','vehicles','records'], 'readwrite');
    for(const s of ['drivers','vehicles','records']) tx1.objectStore(s).clear();
    await new Promise(res=>{ tx1.oncomplete = res; });
    for(const d of json.drivers||[]) await add('drivers', d);
    for(const v of json.vehicles||[]) await add('vehicles', v);
    for(const r of json.records||[]) await add('records', r);
    alert('Restore complete');
    loadDrivers(); loadVehicles(); fillLookups(); loadRecords(); refreshDashboard();
  });

  // ------- Helpers -------
  function fileToStored(file){
    return new Promise((resolve)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve({ name:file.name, type:file.type, size:file.size, data: fr.result });
      fr.readAsDataURL(file); // store as base64 data URL for portability
    });
  }

  function docLink(doc, label){
    if(!doc) return '';
    const url = doc.data; // data URL
    return `<a href="${url}" target="_blank">${label}</a>`;
  }

  function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function downloadCSV(rows, filename){
    const csv = rows.map(r=> r.map(x => {
      const s = String(x??'');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(','))
    .join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  }

  // Default month prefill
  const mf = $('#report-form [name=month]'); if(mf){ const m = new Date().toISOString().slice(0,7); mf.value = m; runReport(m); }

})();