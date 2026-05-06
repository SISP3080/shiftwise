'use strict';
// ═══════════════════════════════════════════════════════════════════
// ShiftWise v3.0 — v2 base + AM/PM display + Availability system + Time-Off system
// All v2 features preserved exactly.
// ═══════════════════════════════════════════════════════════════════

(function() {

// ─── CONSTANTS ─────────────────────────────────────────────────────
var COLORS     = ['indigo','green','amber','red','pink','blue','teal','purple'];
var COLOR_HEX  = {indigo:'#6366f1',green:'#10b981',amber:'#f59e0b',red:'#ef4444',
                   pink:'#ec4899',blue:'#3b82f6',teal:'#14b8a6',purple:'#a855f7'};
var AV_COLORS  = ['#6366f1','#10b981','#f59e0b','#ef4444','#ec4899',
                   '#3b82f6','#14b8a6','#a855f7','#06b6d4','#84cc16'];
var DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── EARLY UTILITY (needed by seeds below) ─────────────────────────
function now()    { return new Date().toISOString(); }
function fmtDate(d){ return d.toISOString().slice(0,10); }
function todayStr(){ return fmtDate(new Date()); }
function nextId(p) { return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function addNotif(userId,title,message,type){
  DB.notifications.unshift({id:nextId('n'),userId:userId,title:title,message:message,type:type||'info',read:false,createdAt:now()});
}

// ─── DATABASE (in-memory, simulates backend) ────────────────────────
var DB = {
  users: [
    {id:'u1',name:'Alex Rivera',  email:'admin@shiftwise.com',  password:'Admin1234!', role:'ADMIN',    status:'ACTIVE',    avatarColor:'#6366f1',createdAt:'2024-01-01T00:00:00Z'},
    {id:'u2',name:'Morgan Chen',  email:'manager@shiftwise.com',password:'Manager123!',role:'MANAGER',  status:'ACTIVE',    avatarColor:'#10b981',createdAt:'2024-01-15T00:00:00Z'},
    {id:'u3',name:'Jamie Park',   email:'jane@shiftwise.com',   password:'Employee123!',role:'EMPLOYEE', status:'ACTIVE',avatarColor:'#f59e0b',createdAt:'2024-02-01T00:00:00Z'},
    {id:'u4',name:'Sam Torres',   email:'john@shiftwise.com',   password:'Employee123!',role:'EMPLOYEE', status:'ACTIVE',       avatarColor:'#3b82f6',createdAt:'2024-02-15T00:00:00Z'},
    {id:'u5',name:'Casey Nguyen', email:'sarah@shiftwise.com',  password:'Employee123!',role:'EMPLOYEE', status:'ACTIVE',avatarColor:'#ec4899',createdAt:'2024-03-01T00:00:00Z'},
    {id:'u6',name:'Riley Kim',    email:'riley@shiftwise.com',  password:'Employee123!',role:'EMPLOYEE', status:'INACTIVE',           avatarColor:'#a855f7',createdAt:'2024-03-15T00:00:00Z'},
  ],
  shifts:        [],
  swaps:         [],
  notifications: [],
  auditLog:      [],
  // v3: availability[]{id,userId,dayOfWeek(0=Sun..6=Sat),startTime,endTime,isAvailable}
  availability:     [],
  // v3: availRequests[]{id,userId,proposedAvailability[],status,notes,reviewedBy,reviewedAt,createdAt}
  availRequests:    [],
  // v3: timeOffRequests[]{id,userId,startDate,endDate,type,notes,digitalSignatureName,submittedAt,status,reviewedBy,reviewedAt,adminNotes}
  timeOffRequests:  [],
  // v3: openShifts[]{id,date,startTime,endTime,position,colorTag,notes,createdById,createdAt,
  //   status:'OPEN'|'PENDING'|'FILLED', claimedBy:null|userId, claimType:'take'|'swap',
  //   swapShiftId:null|shiftId, approvedBy:null, approvedAt:null}
  openShifts: [],
};

// Seed shifts spanning current week and next week
(function seedShifts() {
  var today = new Date(); today.setHours(0,0,0,0);
  var dow = (today.getDay() + 6) % 7; // Mon=0
  var mon = new Date(today); mon.setDate(today.getDate() - dow);
  var templates = [
    {emp:'u3',st:'08:00',et:'16:00',pos:'Front Desk',  color:'indigo', days:[0,2,4]},
    {emp:'u3',st:'12:00',et:'20:00',pos:'Closing',     color:'purple', days:[1,3]},
    {emp:'u4',st:'07:00',et:'15:00',pos:'Kitchen',     color:'green',  days:[0,1,2]},
    {emp:'u4',st:'15:00',et:'23:00',pos:'Eve. Kitchen',color:'teal',   days:[3,4]},
    {emp:'u5',st:'09:00',et:'17:00',pos:'Host',        color:'pink',   days:[0,2,3]},
    {emp:'u5',st:'14:00',et:'22:00',pos:'Server',      color:'amber',  days:[1,4]},
  ];
  var id = 1;
  templates.forEach(function(t) {
    [0,1].forEach(function(week) {
      t.days.forEach(function(dayOff) {
        var d = new Date(mon); d.setDate(mon.getDate() + dayOff + week * 7);
        DB.shifts.push({
          id:'s'+(id++), employeeId:t.emp, createdById:'u1',
          date:fmtDate(d), startTime:t.st, endTime:t.et,
          position:t.pos, notes:'', colorTag:t.color,
          createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
        });
      });
    });
  });
  // Ensure at least one shift today for each active employee
  var todayStr = fmtDate(today);
  ['u3','u4'].forEach(function(emp) {
    if (!DB.shifts.find(function(s){return s.employeeId===emp&&s.date===todayStr;})) {
      DB.shifts.push({id:'s'+(id++),employeeId:emp,createdById:'u1',date:todayStr,startTime:'09:00',endTime:'17:00',position:'Shift',notes:'',colorTag:'indigo',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    }
  });
})();

// Seed one pending swap
(function seedSwap() {
  var rs = DB.shifts.find(function(s){return s.employeeId==='u3'&&s.date>=fmtDate(new Date());});
  var recS = DB.shifts.find(function(s){return s.employeeId==='u4'&&s.date>=fmtDate(new Date())&&(!rs||s.date!==rs.date);});
  if (rs && recS) {
    DB.swaps.push({id:'sw1',status:'PENDING',requesterId:'u3',receiverId:'u4',requesterShiftId:rs.id,receiverShiftId:recS.id,message:'Can we swap? I have a dentist appointment.',adminNotes:'',responseMessage:'',responseBy:null,responseAt:null,expiresAt:new Date(Date.now()+7*864e5).toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),reviewedById:null,reviewedAt:null});
    addNotif('u4','Swap Request','Jamie Park requested a shift swap with you.','swap');
  }
})();

// v3: seed availability and time-off
(function seedAvailability() {
  ['u3','u4','u5'].forEach(function(uid) {
    [1,2,3,4,5].forEach(function(d) {
      DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:true});
    });
    [0,6].forEach(function(d) {
      DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:false});
    });
  });
  DB.availRequests.push({
    id:nextId('avr'),userId:'u3',status:'PENDING',
    notes:'Starting evening classes on Fridays — need Fridays off.',
    reviewedBy:null,reviewedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    proposedAvailability:[
      {dayOfWeek:1,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:2,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:3,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:4,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:5,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:6,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:0,startTime:'08:00',endTime:'22:00',isAvailable:false},
    ]
  });
  addNotif('u1','Availability Request','Jamie Park submitted an availability change request.','info');
  addNotif('u2','Availability Request','Jamie Park submitted an availability change request.','info');
})();
(function seedTimeOff() {
  var nw = new Date(); nw.setDate(nw.getDate()+7);
  var nw2 = new Date(nw); nw2.setDate(nw.getDate()+2);
  function fd(d){ return d.toISOString().slice(0,10); }
  DB.timeOffRequests.push({
    id:nextId('to'),userId:'u4',startDate:fd(nw),endDate:fd(nw2),type:'sick',
    notes:'Scheduled medical procedure.',digitalSignatureName:'Sam Torres',
    submittedAt:new Date().toISOString(),status:'PENDING',
    reviewedBy:null,reviewedAt:null,adminNotes:'',
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  });
  addNotif('u1','Time-Off Request','Sam Torres submitted a time-off request.','info');
  addNotif('u2','Time-Off Request','Sam Torres submitted a time-off request.','info');
})();


// v3: seed one open shift (no employee assigned)
(function seedOpenShift() {
  var tom = new Date(); tom.setDate(tom.getDate()+2);
  tom.setHours(0,0,0,0);
  DB.openShifts.push({
    id:nextId('os'), date:fmtDate(tom), startTime:'10:00', endTime:'18:00',
    position:'Floor Cover', colorTag:'amber', notes:'Flexible role, any department.',
    createdById:'u1', createdAt:new Date().toISOString(),
    status:'OPEN', claimedBy:null, claimType:null, swapShiftId:null,
    approvedBy:null, approvedAt:null
  });
})();

// ─── STATE ─────────────────────────────────────────────────────────
var state = {
  currentUser:  null,
  page:         'login',  // login | register | dashboard | schedule | swaps | admin | profile
  modal:        null,     // { type, data } | null
  view:         'week',   // week | list  (schedule page)
  weekOffset:   0,
  filterEmp:    'all',    // admin schedule filter
  swapFilter:   'ALL',
  adminTab:     'users',  // users | swaps | audit
  notifOpen:    false,
  searchUser:   '',
  availTab:     'overview',  // v3: overview | requests
  toTab:        'pending',   // v3: pending | all
  openShiftTab: 'open',       // v3: open | pending (admin)
};

// ─── ESCAPE LISTENER (single persistent instance) ──────────────────
// FIX: was re-registered on every render(), causing listener accumulation
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  if (state.modal)     { closeModal();                         return; }
  if (state.notifOpen) { state.notifOpen = false; render();   return; }
});

// ─── HELPERS ───────────────────────────────────────────────────────
function now()           { return new Date().toISOString(); }
function fmtDate(d)      { return d.toISOString().slice(0,10); }
// v3: AM/PM display — storage stays 24h, only display changes
function fmt12(t) {
  if (!t) return '';
  var p = t.split(':'), h = +p[0], m = p[1] || '00';
  return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
}
function fmtRange(s, e) { return fmt12(s) + ' – ' + fmt12(e); }
// v3: get full 7-day availability for a user
var AVAIL_DAYS = [
  {idx:1,label:'Monday'},{idx:2,label:'Tuesday'},{idx:3,label:'Wednesday'},
  {idx:4,label:'Thursday'},{idx:5,label:'Friday'},{idx:6,label:'Saturday'},{idx:0,label:'Sunday'}
];
function getUserAvailability(userId) {
  return AVAIL_DAYS.map(function(wd) {
    return DB.availability.find(function(a){ return a.userId===userId && a.dayOfWeek===wd.idx; }) ||
           { userId:userId, dayOfWeek:wd.idx, startTime:'09:00', endTime:'17:00', isAvailable:false };
  });
}
// v3: true if employee has approved time-off covering date
function isOnApprovedTimeOff(empId, date) {
  return DB.timeOffRequests.some(function(r) {
    return r.userId===empId && r.status==='APPROVED' && r.startDate<=date && r.endDate>=date;
  });
}
function getAvReq(id) { return DB.availRequests.find(function(r){ return r.id===id; }); }
function getTOReq(id)  { return DB.timeOffRequests.find(function(r){ return r.id===id; }); }
function todayStr()      { return fmtDate(new Date()); }
function timeToMins(t)   { var p=t.split(':'); return +p[0]*60+(+p[1]||0); }
function getUser(id)     { return DB.users.find(function(u){return u.id===id;}); }
function getShift(id)    { return DB.shifts.find(function(s){return s.id===id;}); }
function getSwap(id)     { return DB.swaps.find(function(s){return s.id===id;}); }
function initials(name)  { return name.split(' ').map(function(n){return n[0];}).slice(0,2).join('').toUpperCase(); }
function isAdminOrMgr()  { return state.currentUser && (state.currentUser.role==='ADMIN'||state.currentUser.role==='MANAGER'); }
function nextId(p)       { return p+Date.now()+Math.random().toString(36).slice(2,6); }
function esc(s)          { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function fmtDateLabel(s) {
  var t = todayStr();
  var d = new Date(s + 'T00:00:00');
  var tom = new Date(); tom.setDate(tom.getDate()+1);
  if (s === t) return 'Today, ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  if (s === fmtDate(tom)) return 'Tomorrow, ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  return DAYS_SHORT[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}
function relTime(iso) {
  var diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff/60)   + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600)  + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}
function addNotif(userId, title, message, type) {
  DB.notifications.unshift({
    id: nextId('n'), userId: userId, title: title,
    message: message, type: type||'info', read: false,
    createdAt: new Date().toISOString(),
  });
}
function shiftsOverlap(s1,e1,s2,e2) {
  return timeToMins(s1) < timeToMins(e2) && timeToMins(e1) > timeToMins(s2);
}
function hasConflict(empId, date, start, end, excludeId) {
  return DB.shifts.some(function(s) {
    return s.employeeId===empId && s.date===date && s.id!==excludeId &&
           shiftsOverlap(start, end, s.startTime, s.endTime);
  });
}
function validatePassword(pw) {
  if (!pw || pw.length < 8)          return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pw))             return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(pw))             return 'Password must contain at least one number.';
  return null;
}
function validateEmail(em) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
}

// ─── TOAST ─────────────────────────────────────────────────────────
function toast(msg, type) {
  var c = document.getElementById('toast-container');
  if (!c) return;
  var t = document.createElement('div');
  var icons = { success:'✓', error:'✕', info:'ℹ' };
  t.className = 'toast toast-' + (type||'info');
  t.innerHTML = '<span>' + esc(icons[type]||'ℹ') + '</span><span>' + esc(msg) + '</span>';
  c.appendChild(t);
  setTimeout(function() {
    t.style.opacity = '0'; t.style.transition = 'opacity .3s';
    setTimeout(function(){ if(t.parentNode) t.remove(); }, 320);
  }, 3200);
}

// ─── AUTH ───────────────────────────────────────────────────────────
function login(email, pass) {
  if (!email || !pass) { toast('Please enter your email and password.', 'error'); return; }
  if (!validateEmail(email)) { toast('Please enter a valid email address.', 'error'); return; }
  var u = DB.users.find(function(x){ return x.email.toLowerCase() === email.toLowerCase(); });
  if (!u)                  { toast('No account found with that email.', 'error');  return; }
  if (u.status==='INACTIVE'){ toast('This account has been deactivated.', 'error'); return; }
  if (u.password !== pass) { toast('Incorrect password.', 'error');                return; }
  state.currentUser = u;
  state.page = 'dashboard';
  addNotif(u.id, 'Welcome back', 'Signed in as ' + u.name + '.', 'info');
  render();
}

function handleLogin() {
  var em = document.getElementById('loginEmail');
  var pw = document.getElementById('loginPass');
  if (em && pw) login(em.value.trim(), pw.value);
}

function handleRegister() {
  var name  = (document.getElementById('regName')  || {}).value || '';
  var email = (document.getElementById('regEmail') || {}).value || '';
  var pw    = (document.getElementById('regPass')  || {}).value || '';
  var pw2   = (document.getElementById('regPass2') || {}).value || '';
  name = name.trim(); email = email.trim().toLowerCase();

  if (!name)                    { toast('Full name is required.', 'error');           return; }
  if (!validateEmail(email))    { toast('Enter a valid email address.', 'error');     return; }
  var pwErr = validatePassword(pw);
  if (pwErr)                    { toast(pwErr, 'error');                               return; }
  if (pw !== pw2)               { toast('Passwords do not match.', 'error');          return; }
  if (DB.users.find(function(u){ return u.email.toLowerCase()===email; })) {
    toast('An account with that email already exists.', 'error'); return;
  }

  var col  = AV_COLORS[DB.users.length % AV_COLORS.length];
  var user = { id:nextId('u'), name:name, email:email, password:pw,
               role:'EMPLOYEE', status:'ACTIVE',
               avatarColor:col, createdAt:new Date().toISOString() };
  DB.users.push(user);
  DB.auditLog.push({ id:nextId('a'), userId:user.id, action:'USER_REGISTERED', entityType:'User', entityId:user.id, createdAt:new Date().toISOString() });
  state.currentUser = user;
  state.page = 'dashboard';
  addNotif(user.id, 'Welcome to ShiftWise', 'Your account has been created. A manager will assign your shifts.', 'info');
  toast('Account created! Welcome, ' + name.split(' ')[0] + '.', 'success');
  render();
}

function logout() {
  state.currentUser = null;
  state.page        = 'login';
  state.notifOpen   = false;
  state.modal       = null;
  render();
}

function navigate(page) {
  state.page      = page;
  state.notifOpen = false;
  state.modal     = null;
  render();
}

// ─── WEEK HELPERS ───────────────────────────────────────────────────
function getWeekMon(offset) {
  var d = new Date(); d.setHours(0,0,0,0);
  var dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow + (offset||0) * 7);
  return d;
}
function getWeekDays(offset) {
  var mon = getWeekMon(offset); var days = [];
  for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(mon.getDate()+i); days.push(d); }
  return days;
}
function weekLabel(offset) {
  var days = getWeekDays(offset);
  return MONTHS[days[0].getMonth()] + ' ' + days[0].getDate() +
         ' – ' + MONTHS[days[6].getMonth()] + ' ' + days[6].getDate() + ', ' + days[6].getFullYear();
}
function getVisibleShifts() {
  var u = state.currentUser;
  var shifts = isAdminOrMgr() ? DB.shifts.slice() : DB.shifts.filter(function(s){ return s.employeeId===u.id; });
  if (isAdminOrMgr() && state.filterEmp !== 'all') {
    shifts = shifts.filter(function(s){ return s.employeeId === state.filterEmp; });
  }
  return shifts;
}
function getWeekShifts(offset) {
  var dates = getWeekDays(offset).map(fmtDate);
  return getVisibleShifts().filter(function(s){ return dates.indexOf(s.date) !== -1; });
}

// ─── RENDER CORE ────────────────────────────────────────────────────
// FIX: modal and notif panel now rendered inside #app via innerHTML,
// NOT appended to document.body (which caused duplicate stacking).
function render() {
  var app = document.getElementById('app');
  if (!app) return;

  if (state.page === 'login') {
    app.innerHTML = renderLogin();
    // Bind Enter key on password field
    var pw = document.getElementById('loginPass');
    if (pw) pw.onkeydown = function(e){ if(e.key==='Enter') handleLogin(); };
    return;
  }
  if (state.page === 'register') {
    app.innerHTML = renderRegister();
    var rp2 = document.getElementById('regPass2');
    if (rp2) rp2.onkeydown = function(e){ if(e.key==='Enter') handleRegister(); };
    return;
  }
  if (!state.currentUser) { state.page='login'; render(); return; }

  // Main app shell
  var html = '<div class="app">' + renderSidebar() + renderMain() + '</div>';

  // FIX: Overlays rendered inside #app, never appended to body
  if (state.notifOpen) html += renderNotifPanel();
  if (state.modal)     html += renderModal();

  app.innerHTML = html;
}

// ─── LOGIN ──────────────────────────────────────────────────────────
function renderLogin() {
  return (
    '<div class="login-screen">' +
      '<div class="login-card">' +
        '<div class="login-logo">' +
          '<div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>' +
          '<div class="login-logo-title">ShiftWise</div>' +
          '<div class="login-subtitle">Employee Schedule Management</div>' +
        '</div>' +
        '<div class="form-group"><label>Email Address</label>' +
          '<input type="email" id="loginEmail" placeholder="you@company.com" autocomplete="email"></div>' +
        '<div class="form-group"><label>Password</label>' +
          '<input type="password" id="loginPass" placeholder="••••••••" autocomplete="current-password"></div>' +
        '<button class="login-btn" onclick="handleLogin()">Sign In</button>' +
        '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">' +
          'Don\'t have an account? <a href="#" onclick="navigate(\'register\');return false;" style="color:var(--brand2);font-weight:600;">Create account</a>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ─── REGISTER ───────────────────────────────────────────────────────
function renderRegister() {
  return (
    '<div class="login-screen">' +
      '<div class="login-card" style="max-width:440px">' +
        '<div class="login-logo">' +
          '<div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>' +
          '<div class="login-logo-title">Create Account</div>' +
          '<div class="login-subtitle">Join your team on ShiftWise</div>' +
        '</div>' +
        '<div class="form-group"><label>Full Name *</label>' +
            '<input id="regName" placeholder="Jane Smith" autocomplete="name"></div>' +
        '<div class="form-group"><label>Email Address *</label>' +
          '<input type="email" id="regEmail" placeholder="you@company.com" autocomplete="email"></div>' +
        '<div class="form-row">' +
          '<div class="form-group"><label>Password *</label>' +
            '<input type="password" id="regPass" placeholder="Min 8 chars, 1 uppercase, 1 number" autocomplete="new-password"></div>' +
          '<div class="form-group"><label>Confirm Password *</label>' +
            '<input type="password" id="regPass2" placeholder="Repeat password" autocomplete="new-password"></div>' +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--text3);background:var(--bg3);border-radius:8px;padding:10px 12px;margin-bottom:16px;line-height:1.6">' +
          'Password must be at least 8 characters with one uppercase letter and one number.' +
        '</div>' +
        '<button class="login-btn" onclick="handleRegister()">Create Account</button>' +
        '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">' +
          'Already have an account? <a href="#" onclick="navigate(\'login\');return false;" style="color:var(--brand2);font-weight:600;">Sign in</a>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// ─── SIDEBAR ────────────────────────────────────────────────────────
function renderSidebar() {
  var u = state.currentUser; var isMgr = isAdminOrMgr();
  var pages = [
    { id:'dashboard',    label:'Dashboard',    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' },
    { id:'schedule',     label:'Schedule',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
    { id:'swaps',        label:'Shift Swaps',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>' },
    { id:'availability', label:'Availability', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    { id:'openshift',    label:'Open Shifts', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>' },
    { id:'timeoff',      label:'Time Off',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="15" x2="16" y2="15"/></svg>' },
  ];
  if (isMgr) pages.push({ id:'admin', label:'Admin Panel', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' });

  var pendingForMe = DB.swaps.filter(function(s){
    return s.status==='PENDING' && s.receiverId===u.id;
  }).length;
  var reviewQueue  = isMgr ? DB.swaps.filter(function(s){return s.status==='ACCEPTED';}).length : 0;
  var swapBadge    = pendingForMe + reviewQueue;
  var openShiftBadge = DB.openShifts.filter(function(s){return s.status==='OPEN';}).length;
  var openPendingBadge = isMgr ? DB.openShifts.filter(function(s){return s.status==='PENDING';}).length : 0;
  var availBadge   = isMgr ? DB.availRequests.filter(function(r){return r.status==='PENDING';}).length : 0;
  var toBadge      = isMgr ? DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length : 0;

  var html = '<aside class="sidebar">';
  html += '<div class="logo"><div class="logo-mark" style="display:flex;align-items:center;justify-content:center">SW</div><span class="logo-text">ShiftWise</span></div>';
  html += '<nav class="nav">';
  pages.forEach(function(p) {
    var badge = '';
    if (p.id==='swaps'        && swapBadge>0)   badge = '<span class="nav-badge">'+swapBadge+'</span>';
    if (p.id==='openshift') {
      var osBadge = openShiftBadge + openPendingBadge;
      if (osBadge>0) badge = '<span class="nav-badge">'+osBadge+'</span>';
    }
    if (p.id==='availability' && availBadge>0)  badge = '<span class="nav-badge">'+availBadge+'</span>';
    if (p.id==='timeoff'      && toBadge>0)     badge = '<span class="nav-badge">'+toBadge+'</span>';
    html += '<div class="nav-item'+(state.page===p.id?' active':'')+'" onclick="navigate(\''+p.id+'\')">' + p.icon + ' ' + p.label + badge + '</div>';
  });
  html += '</nav>';
  html += '<div class="sidebar-footer">';
  html += '<div class="user-chip" onclick="navigate(\'profile\')" title="My Profile">';
  html += '<div class="avatar" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>';
  html += '<div style="flex:1;min-width:0"><div class="user-name">'+esc(u.name)+'</div><div class="user-role-label">'+esc(u.role.toLowerCase())+'</div></div>';
  html += '</div>';
  html += '<div class="nav-item" style="margin-top:2px;color:var(--text3)" onclick="logout()">';
  html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign out';
  html += '</div></div></aside>';
  return html;
}

// ─── TOPBAR ─────────────────────────────────────────────────────────
function renderTopbar() {
  var u = state.currentUser;
  var unread = DB.notifications.filter(function(n){ return n.userId===u.id && !n.read; }).length;
  var titles = { dashboard:'Dashboard', schedule:'Schedule', swaps:'Shift Swaps', admin:'Admin Panel', profile:'Profile', availability:'Availability', timeoff:'Time Off Requests', openshift:'Open Shifts' };
  var extra = '';
  if (state.page==='schedule' && state.view==='list' && isAdminOrMgr()) {
    extra = '<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\',{})">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            ' New Shift</button>';
  }
  if (state.page==='timeoff' && !isAdminOrMgr()) {
    extra = '<button class="btn btn-sm btn-primary" onclick="openModal(\'create-timeoff\',{})">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
            ' Request Time Off</button>';
  }
  return '<header class="topbar">' +
    '<span class="topbar-title">'+(titles[state.page]||'ShiftWise')+'</span>' +
    extra +
    '<button class="icon-btn" onclick="toggleNotif()" aria-label="Notifications" title="Notifications">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>' +
      (unread>0 ? '<span class="notif-dot"></span>' : '') +
    '</button>' +
  '</header>';
}

function renderMain() {
  return '<div class="main">' + renderTopbar() + '<div class="content">' + renderPage() + '</div></div>';
}
function renderPage() {
  var map = { dashboard:renderDashboard, schedule:renderSchedule, swaps:renderSwaps, admin:renderAdmin, profile:renderProfile, availability:renderAvailability, timeoff:renderTimeOff, openshift:renderOpenShifts };
  return (map[state.page] || renderDashboard)();
}

// ─── DASHBOARD ──────────────────────────────────────────────────────
function renderDashboard() {
  var u = state.currentUser; var isMgr = isAdminOrMgr(); var today = todayStr();
  var allShifts  = isAdminOrMgr() ? DB.shifts : DB.shifts.filter(function(s){return s.employeeId===u.id;});
  var weekDates  = getWeekDays(0).map(fmtDate);
  var weekShifts = allShifts.filter(function(s){return weekDates.indexOf(s.date)!==-1;});
  var todayShifts= allShifts.filter(function(s){return s.date===today;});
  var mySwaps    = DB.swaps.filter(function(s){ return isMgr ? ['PENDING','ACCEPTED'].indexOf(s.status)!==-1 : (s.requesterId===u.id||s.receiverId===u.id)&&['PENDING','ACCEPTED'].indexOf(s.status)!==-1; });
  var activeEmp  = DB.users.filter(function(u){return u.status==='ACTIVE';}).length;
  var pendingTO  = isMgr
    ? DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length
    : DB.timeOffRequests.filter(function(r){return r.userId===u.id&&r.status==='PENDING';}).length;
  var pendingAV  = isMgr
    ? DB.availRequests.filter(function(r){return r.status==='PENDING';}).length
    : DB.availRequests.filter(function(r){return r.userId===u.id&&r.status==='PENDING';}).length;
  var openShiftCount = DB.openShifts.filter(function(s){return s.status==='OPEN';}).length;
  var hr = new Date().getHours();
  var greet = hr<12?'Good morning':hr<18?'Good afternoon':'Good evening';

  var h = '<div style="margin-bottom:24px">';
  h += '<div style="font-family:var(--font-display);font-size:22px;font-weight:700">'+greet+', '+esc(u.name.split(' ')[0])+' 👋</div>';
  h += '<div style="font-size:13px;color:var(--text2);margin-top:4px">' + new Date().toLocaleDateString('en',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '</div>';
  h += '</div>';

  h += '<div class="stat-grid">';
  h += statCard('Shifts This Week', 'cal', weekShifts.length, '#6366f1', 'rgba(99,102,241,.12)');
  h += statCard("Today's Shifts",   'clock',todayShifts.length,'#10b981','rgba(16,185,129,.12)');
  h += statCard('Active Swaps',     'swap', mySwaps.length,    '#f59e0b','rgba(245,158,11,.12)');
  if (isMgr) h += statCard('Pending Time Off','timeoff',pendingTO,'#ec4899','rgba(236,72,153,.12)');
  else        h += statCard('Open Shifts','openshift',openShiftCount,'#a855f7','rgba(168,85,247,.12)');
  h += '</div>';

  h += '<div class="dash-grid">';
  // Today card
  h += '<div class="card"><div class="card-header"><span class="card-title">Today\'s Shifts</span>' +
       '<button class="btn btn-xs btn-ghost" onclick="navigate(\'schedule\')">View all →</button></div><div style="padding:0 16px 16px">';
  if (!todayShifts.length) {
    h += '<div class="empty-state" style="padding:24px 0"><div class="empty-icon">📅</div><div class="empty-title">No shifts today</div></div>';
  } else {
    todayShifts.forEach(function(s) {
      var emp = getUser(s.employeeId); if (!emp) return;
      h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
      h += '<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
      h += '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(emp.name)+'</div>';
      h += '<div style="font-size:12px;color:var(--text2)">'+fmtRange(s.startTime,s.endTime)+(s.position?' · '+esc(s.position):'')+'</div></div>';
      h += '<span class="badge badge-active">On shift</span></div>';
    });
  }
  h += '</div></div>';

  // Swaps card
  h += '<div class="card"><div class="card-header"><span class="card-title">Active Swaps</span>' +
       '<button class="btn btn-xs btn-ghost" onclick="navigate(\'swaps\')">View all →</button></div><div style="padding:0 16px 16px">';
  if (!mySwaps.length) {
    h += '<div class="empty-state" style="padding:24px 0"><div class="empty-icon">🔄</div><div class="empty-title">No active swaps</div></div>';
  } else {
    mySwaps.slice(0,4).forEach(function(sw) {
      var req = getUser(sw.requesterId); if (!req) return;
      var rs  = getShift(sw.requesterShiftId); if (!rs) return;
      h += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
      h += '<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>';
      h += '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+'</div>';
      h += '<div style="font-size:12px;color:var(--text2)">'+esc(rs.date)+' · '+fmtRange(rs.startTime,rs.endTime)+'</div></div>';
      h += '<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';
    });
  }
  // v3: Pending requests card
  h += '<div class="card"><div class="card-header"><span class="card-title">Pending Requests</span></div><div style="padding:16px">';
  var hasPendTO  = isMgr
    ? DB.timeOffRequests.filter(function(r){return r.status==='PENDING';})
    : DB.timeOffRequests.filter(function(r){return r.userId===u.id&&r.status==='PENDING';});
  var hasPendAV  = isMgr
    ? DB.availRequests.filter(function(r){return r.status==='PENDING';})
    : DB.availRequests.filter(function(r){return r.userId===u.id&&r.status==='PENDING';});
  var anyPending = hasPendTO.length+hasPendAV.length;
  if (!anyPending) {
    h += '<div class="empty-state" style="padding:20px 0"><div class="empty-icon" style="font-size:28px">✅</div><div class="empty-title">No pending requests</div></div>';
  } else {
    if (hasPendTO.length) {
      h += '<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
      h += '<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+(isMgr?hasPendTO.length+' time-off request'+(hasPendTO.length!==1?'s':''):'Pending time-off request')+'</div>';
      h += '<div style="font-size:12px;color:var(--text2)">'+(isMgr?'Awaiting your review':'Awaiting manager review')+'</div></div>';
      h += '<button class="btn btn-xs btn-primary" onclick="navigate(\'timeoff\')">View</button></div>';
    }
    if (hasPendAV.length) {
      h += '<div style="padding:10px 0;display:flex;align-items:center;justify-content:space-between">';
      h += '<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+(isMgr?hasPendAV.length+' availability request'+(hasPendAV.length!==1?'s':''):'Pending availability request')+'</div>';
      h += '<div style="font-size:12px;color:var(--text2)">'+(isMgr?'Awaiting your review':'Awaiting manager review')+'</div></div>';
      h += '<button class="btn btn-xs btn-primary" onclick="navigate(\'availability\')">View</button></div>';
    }
  }
  h += '</div></div>';

  h += '</div></div></div>';
  return h;
}

function statCard(label, iconKey, val, color, bg) {
  var icons = {
    cal:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    swap:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    shifts:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>',
    timeoff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="15" x2="16" y2="15"/></svg>',
    pending:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    openshift:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
  };
  return '<div class="stat-card">' +
    '<div class="stat-icon" style="background:'+bg+';color:'+color+'">' + (icons[iconKey]||'') + '</div>' +
    '<div class="stat-value" style="color:'+color+'">'+val+'</div>' +
    '<div class="stat-label">'+label+'</div></div>';
}

// ─── SCHEDULE ────────────────────────────────────────────────────────
function renderSchedule() {
  var isMgr = isAdminOrMgr();
  var h = '<div class="week-nav">';
  h += '<button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">‹ Prev</button>';
  h += '<span class="week-label">'+weekLabel(state.weekOffset)+'</span>';
  h += '<button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">Next ›</button>';
  h += '<button class="btn btn-ghost btn-sm" onclick="goToday()">Today</button>';

  // FIX: Employee filter dropdown for admin view — wired to state.filterEmp
  if (isMgr) {
    h += '<select class="filter-select" onchange="state.filterEmp=this.value;render()" style="margin-left:8px">';
    h += '<option value="all"'+(state.filterEmp==='all'?' selected':'')+'>All Employees</option>';
    DB.users.filter(function(u){return u.status==='ACTIVE';}).forEach(function(u) {
      h += '<option value="'+u.id+'"'+(state.filterEmp===u.id?' selected':'')+'>'+esc(u.name)+'</option>';
    });
    h += '</select>';
  }

  h += '<div class="view-tabs" style="margin-left:auto">';
  h += '<button class="view-tab'+(state.view==='week'?' active':'')+'" onclick="setView(\'week\')">Week</button>';
  h += '<button class="view-tab'+(state.view==='list'?' active':'')+'" onclick="setView(\'list\')">List</button>';
  h += '</div></div>';

  h += '<div class="card">';
  if (state.view==='week') {
    h += '<div style="background:var(--bg3);border-bottom:1px solid var(--border);padding:8px 16px;font-size:11.5px;color:var(--text3);display:flex;align-items:center;gap:6px">';
    h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    h += 'Week view is <strong>read-only</strong>. Switch to <button class="btn btn-xs btn-ghost" style="display:inline-flex;margin:0 2px" onclick="setView(\'list\')">List</button> view to create and edit shifts.';
    h += '</div>';
    h += renderWeekView();
  } else {
    h += renderListView();
  }
  h += '</div>';
  return h;
}
function changeWeek(dir) { state.weekOffset += dir; render(); }
function goToday()       { state.weekOffset  = 0;  render(); }
function setView(v)      { state.view = v;          render(); }

function renderWeekView() {
  var days   = getWeekDays(state.weekOffset);
  var today  = todayStr();
  var shifts = getWeekShifts(state.weekOffset);
  var HOURS  = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
  var SH     = 52; // slot height px
  var isMgr  = isAdminOrMgr();

  var h = '<div style="overflow-x:auto"><div style="min-width:680px">';
  // Header row
  h += '<div class="cal-header">';
  h += '<div class="cal-time-head"></div>';
  days.forEach(function(d) {
    var ds = fmtDate(d); var isToday = ds===today;
    h += '<div class="cal-day-head">';
    h += '<div class="cal-day-name">'+DAYS_SHORT[d.getDay()]+'</div>';
    // FIX: day-click to create shift — uses data attribute + global handler, avoids quote nesting bug
    h += '<div class="cal-day-num'+(isToday?' today':'')+'">'+d.getDate()+'</div>';
    h += '</div>';
  });
  h += '</div>';

  // Body
  h += '<div style="display:grid;grid-template-columns:68px repeat(7,1fr);position:relative;height:'+(HOURS.length*SH)+'px">';
  // Time column
  h += '<div>';
  HOURS.forEach(function(hr) {
    h += '<div class="cal-time-slot">'+fmt12((hr<10?'0':'')+hr+':00')+'</div>';
  });
  h += '</div>';

  // Day columns
  days.forEach(function(d) {
    var ds = fmtDate(d);
    h += '<div class="cal-day-col">';
    HOURS.forEach(function(hr, i) {
      h += '<div class="cal-hour-line" style="top:'+(i*SH)+'px"></div>';
    });
    var dayShifts = shifts.filter(function(s){return s.date===ds;});
    dayShifts.forEach(function(s) {
      var emp    = getUser(s.employeeId);
      var startM = timeToMins(s.startTime) - 6*60;
      var endM   = timeToMins(s.endTime)   - 6*60;
      var top    = Math.max(0, startM*(SH/60));
      var height = Math.max(20, (endM-startM)*(SH/60)-2);
      var cls    = 'color-'+(s.colorTag||'indigo');
      var onTO   = isOnApprovedTimeOff(s.employeeId, ds);
      var toStyle= onTO ? ';opacity:.45;box-shadow:inset 0 0 0 2px rgba(239,68,68,.4)' : '';
      h += '<div class="shift-block '+cls+'" style="top:'+top+'px;height:'+height+'px'+toStyle+';cursor:default" title="'+(onTO?'On approved time off':fmtRange(s.startTime,s.endTime)+(s.position?' · '+s.position:''))+' (view List for details)">';
      h += '<div class="shift-name">'+(isMgr&&emp?esc(emp.name):esc(s.position||'Shift'))+'</div>';
      h += '<div class="shift-time">'+fmtRange(s.startTime,s.endTime)+'</div>';
      if (onTO) h += '<div style="font-size:8px;opacity:.8;font-weight:700;text-transform:uppercase;letter-spacing:.04em">⛔ Time Off</div>';
      h += '</div>';
    });
    h += '</div>';
  });
  h += '</div></div></div>';
  return h;
}

function renderListView() {
  var dates  = getWeekDays(state.weekOffset).map(fmtDate);
  var shifts = getWeekShifts(state.weekOffset);
  var isMgr  = isAdminOrMgr();
  var byDay  = {};
  dates.forEach(function(d){ byDay[d]=[]; });
  shifts.forEach(function(s){ if(byDay[s.date]) byDay[s.date].push(s); });

  var h = '<div style="padding:16px">'; var hasAny = false;
  dates.forEach(function(d) {
    var ds = byDay[d]; if(!ds||!ds.length) return; hasAny=true;
    h += '<div class="list-day-group"><div class="list-day-header">'+fmtDateLabel(d)+'</div>';
    ds.forEach(function(s) {
      var emp = getUser(s.employeeId); if(!emp) return;
      var pill = COLOR_HEX[s.colorTag||'indigo']||'#6366f1';
      h += '<div class="list-shift-row" data-id="'+s.id+'" onclick="viewShift(this)">';
      h += '<div class="shift-pill" style="background:'+pill+'"></div>';
      if (isMgr) h += '<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+';flex-shrink:0">'+esc(initials(emp.name))+'</div>';
      h += '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+(isMgr?esc(emp.name)+' · ':'')+fmtRange(s.startTime,s.endTime)+'</div>';
      if (s.position) h += '<div style="font-size:12px;color:var(--text2)">'+esc(s.position)+'</div>';
      if (s.notes)    h += '<div style="font-size:11px;color:var(--text3)">'+esc(s.notes)+'</div>';
      h += '</div>';
      if (isMgr) h += '<button class="btn btn-xs btn-ghost" data-id="'+s.id+'" onclick="editShiftBtn(event,this)">Edit</button>';
      h += '</div>';
    });
    h += '</div>';
  });
  if (!hasAny) h += '<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">No shifts this week</div><div class="empty-sub">Navigate to another week or add new shifts</div></div>';
  h += '</div>';
  return h;
}

// FIX: data-attribute onclick handlers — no inline quote hell
function handleDayClick(el) {
  if (!isAdminOrMgr()) return;
  openModal('create-shift', { date: el.getAttribute('data-date')||'' });
}
function viewShift(el) {
  openModal('view-shift', { id: el.getAttribute('data-id')||'' });
}
function editShiftBtn(evt, el) {
  evt.stopPropagation();
  openModal('edit-shift', { id: el.getAttribute('data-id')||'' });
}

// ─── SWAPS ──────────────────────────────────────────────────────────
function renderSwaps() {
  var u      = state.currentUser; var isMgr = isAdminOrMgr();
  var tabs   = ['ALL','PENDING','ACCEPTED','APPROVED','DECLINED','REJECTED','CANCELLED'];
  var all    = DB.swaps.filter(function(s){ return isMgr || s.requesterId===u.id || s.receiverId===u.id; });
  var shown  = state.swapFilter==='ALL' ? all : all.filter(function(s){return s.status===state.swapFilter;});

  var h = '<div class="swap-tabs">';
  tabs.forEach(function(t) {
    var cnt = t==='ALL' ? all.length : all.filter(function(s){return s.status===t;}).length;
    h += '<button class="swap-tab'+(state.swapFilter===t?' active':'')+'" data-tab="'+t+'" onclick="setSwapFilter(this)">';
    h += (t==='ALL'?'All':t.charAt(0)+t.slice(1).toLowerCase());
    if (cnt>0) h += ' <span style="opacity:.5;font-size:10px">('+cnt+')</span>';
    h += '</button>';
  });
  h += '</div>';

  if (!shown.length) {
    h += '<div class="empty-state"><div class="empty-icon">🔄</div><div class="empty-title">No swap requests</div><div class="empty-sub">Swap requests matching this filter will appear here</div></div>';
  } else {
    shown.forEach(function(sw){ h += renderSwapCard(sw); });
  }
  return h;
}
function setSwapFilter(el) { state.swapFilter = el.getAttribute('data-tab')||'ALL'; render(); }

function renderSwapCard(sw) {
  var u    = state.currentUser; var isMgr = isAdminOrMgr();
  var req  = getUser(sw.requesterId);
  var rec  = sw.receiverId  ? getUser(sw.receiverId)    : null;
  var rs   = getShift(sw.requesterShiftId);
  var recS = sw.receiverShiftId ? getShift(sw.receiverShiftId) : null;
  if (!req || !rs) return '';

  var expired    = new Date() > new Date(sw.expiresAt);
  var canRespond = sw.status==='PENDING' && sw.receiverId===u.id && !expired;
  var canReview  = isMgr && sw.status==='ACCEPTED';
  var canCancel  = (sw.requesterId===u.id||isMgr) && ['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;

  var h = '<div class="swap-card">';
  // Header
  h += '<div class="swap-header"><div style="display:flex;align-items:center;gap:10px">';
  h += '<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>';
  h += '<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+(rec?' → '+esc(rec.name):'')+'</div>';
  h += '<div class="swap-meta">'+relTime(sw.createdAt)+' · Expires '+new Date(sw.expiresAt).toLocaleDateString('en',{month:'short',day:'numeric'})+(expired?' (EXPIRED)':'')+'</div></div></div>';
  h += '<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';

  // Shifts
  h += '<div class="swap-shifts">';
  h += '<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div>';
  h += '<div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div>';
  h += '<div class="swap-shift-time">'+fmtRange(rs.startTime,rs.endTime)+(rs.position?' · '+esc(rs.position):'')+'</div></div>';
  h += '<div class="swap-arrow">⇄</div>';
  if (recS) {
    h += '<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div>';
    h += '<div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div>';
    h += '<div class="swap-shift-time">'+fmtRange(recS.startTime,recS.endTime)+(recS.position?' · '+esc(recS.position):'')+'</div></div>';
  } else {
    h += '<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">Open swap</div>';
    h += '<div style="font-size:12px;color:var(--text3);margin-top:4px">'+(rec?'With '+esc(rec.name):'Any employee')+'</div></div>';
  }
  h += '</div>';

  if (sw.message)        h += '<div class="swap-message">💬 '+esc(sw.message)+'</div>';
  if (sw.responseMessage) {
    var respUser = getUser(sw.responseBy);
    h += '<div class="swap-message" style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15)">';
    h += '💬 <strong>'+(respUser?esc(respUser.name):'Receiver')+'</strong> replied: '+esc(sw.responseMessage);
    h += '</div>';
  }
  if (sw.adminNotes)      h += '<div class="swap-message" style="background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);color:var(--amber)">📋 Admin: '+esc(sw.adminNotes)+'</div>';

  // Actions
  h += '<div class="swap-actions">';
  if (canRespond) {
    h += '<button class="btn btn-success btn-sm" data-id="'+sw.id+'" data-action="ACCEPT"  onclick="respondSwapBtn(this)">✓ Accept</button>';
    h += '<button class="btn btn-danger  btn-sm" data-id="'+sw.id+'" data-action="DECLINE" onclick="respondSwapBtn(this)">✕ Decline</button>';
  }
  if (canReview) {
    h += '<button class="btn btn-success btn-sm" data-id="'+sw.id+'" data-action="APPROVE" onclick="reviewSwapBtn(this)">✓ Approve</button>';
    h += '<button class="btn btn-danger  btn-sm" data-id="'+sw.id+'" data-action="REJECT"  onclick="reviewSwapBtn(this)">✕ Reject</button>';
  }
  if (canCancel) {
    h += '<button class="btn btn-ghost btn-sm" data-id="'+sw.id+'" onclick="cancelSwapBtn(this)">Cancel</button>';
  }
  h += '</div></div>';
  return h;
}
function respondSwapBtn(el) { openModal('respond-swap',{id:el.getAttribute('data-id'),action:el.getAttribute('data-action')||'ACCEPT'}); }
function reviewSwapBtn(el)  { openModal('review-swap', {id:el.getAttribute('data-id'),action:el.getAttribute('data-action')||'APPROVE'}); }
function cancelSwapBtn(el)  {
  if (!confirm('Cancel this swap request? This cannot be undone.')) return;
  var sw = getSwap(el.getAttribute('data-id')); if (!sw) return;
  sw.status='CANCELLED'; sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SWAP_CANCELLED',entityType:'SwapRequest',entityId:sw.id,createdAt:new Date().toISOString()});
  toast('Swap request cancelled.','info'); render();
}

// ─── ADMIN ──────────────────────────────────────────────────────────
function renderAdmin() {
  if (!isAdminOrMgr()) return '<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Access restricted</div><div class="empty-sub">Admins and managers only</div></div>';
  var tabs = [{id:'users',label:'Users'},{id:'swaps',label:'Swap Queue'},{id:'openshift',label:'Open Shifts'},{id:'avail',label:'Availability'},{id:'timeoff',label:'Time Off'},{id:'audit',label:'Audit Log'}];
  var h = '<div class="admin-tabs">';
  tabs.forEach(function(t){ h += '<button class="admin-tab'+(state.adminTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAdminTab(this)">'+t.label+'</button>'; });
  h += '</div>';
  if      (state.adminTab==='users')   h += renderAdminUsers();
  else if (state.adminTab==='swaps')   h += renderAdminSwaps();
  else if (state.adminTab==='openshift') h += renderOpenShifts();
  else if (state.adminTab==='avail')   h += renderAvailRequests();
  else if (state.adminTab==='timeoff') h += renderTimeOffAdmin();
  else                                 h += renderAuditLog();
  return h;
}
function setAdminTab(el) { state.adminTab = el.getAttribute('data-tab')||'users'; render(); }

function renderAdminUsers() {
  var sq    = (state.searchUser||'').toLowerCase();
  var users = DB.users.filter(function(u) {
    return !sq || u.name.toLowerCase().includes(sq) || u.email.toLowerCase().includes(sq);
  });
  var active = DB.users.filter(function(u){return u.status==='ACTIVE';}).length;

  var h = '<div class="section-header">';
  h += '<div><div class="section-title">Users</div><div style="font-size:13px;color:var(--text2);margin-top:2px">'+DB.users.length+' total · '+active+' active</div></div>';
  h += '<div style="display:flex;gap:10px;align-items:center">';
  // FIX: use data-attribute to avoid oninput with state mutation (caused partial re-render in wrong element)
  h += '<input class="search-input" id="userSearch" placeholder="Search users…" value="'+esc(state.searchUser)+'" oninput="filterUsers(this.value)" style="width:180px">';
  h += '<button class="btn btn-primary btn-sm" onclick="openModal(\'create-user\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add User</button>';
  h += '</div></div>';

  h += '<div class="card table-wrap"><table><thead><tr>';
  h += '<th>User</th><th>Role</th><th>Status</th><th style="text-align:right">Actions</th>';
  h += '</tr></thead><tbody>';

  if (!users.length) {
    h += '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3)">No users match your search</td></tr>';
  } else {
    users.forEach(function(u) {
      h += '<tr>';
      h += '<td><div style="display:flex;align-items:center;gap:10px">';
      h += '<div class="avatar avatar-sm" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>';
      h += '<div><div style="font-weight:600;color:var(--text)">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div></td>';
      h += '<td><span class="badge badge-'+u.role.toLowerCase()+'">'+esc(u.role.charAt(0)+u.role.slice(1).toLowerCase())+'</span></td>';
      h += '<td><span class="badge badge-'+u.status.toLowerCase()+'">'+esc(u.status.charAt(0)+u.status.slice(1).toLowerCase())+'</span></td>';
      h += '<td style="text-align:right"><div style="display:flex;gap:6px;justify-content:flex-end">';
      h += '<button class="btn btn-xs btn-ghost" data-id="'+u.id+'" onclick="editUserBtn(this)">Edit</button>';
      if (u.id !== state.currentUser.id) {
        h += '<button class="btn btn-xs '+(u.status==='ACTIVE'?'btn-danger':'btn-success')+'" data-id="'+u.id+'" onclick="toggleStatusBtn(this)">'+(u.status==='ACTIVE'?'Deactivate':'Activate')+'</button>';
      }
      h += '</div></td></tr>';
    });
  }
  h += '</tbody></table></div>';
  return h;
}
function filterUsers(val) { state.searchUser = val; render(); }
function editUserBtn(el)  { openModal('edit-user',{id:el.getAttribute('data-id')||''}); }
function toggleStatusBtn(el) {
  var id = el.getAttribute('data-id'); var u = getUser(id); if (!u) return;
  if (u.id===state.currentUser.id) { toast('Cannot change your own status.','error'); return; }
  if (u.status==='ACTIVE') {
    var upcoming = DB.shifts.filter(function(s){return s.employeeId===id&&s.date>=todayStr();}).length;
    if (upcoming>0) { toast('Cannot deactivate: user has '+upcoming+' upcoming shift(s). Reassign first.','error'); return; }
  }
  u.status = u.status==='ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_STATUS_CHANGED',entityType:'User',entityId:id,createdAt:new Date().toISOString()});
  toast('User '+(u.status==='ACTIVE'?'activated':'deactivated')+'.','success'); render();
}

function renderAdminSwaps() {
  var queue = DB.swaps.filter(function(s){return s.status==='ACCEPTED';});
  var h = '<div class="section-header"><div class="section-title">Swap Approval Queue</div></div>';
  if (!queue.length) {
    h += '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Queue is clear</div><div class="empty-sub">All swap requests have been reviewed</div></div>';
  } else {
    queue.forEach(function(sw){ h += renderSwapCard(sw); });
  }
  return h;
}

function renderAuditLog() {
  var log = DB.auditLog.slice().reverse().slice(0,60);
  var h = '<div class="section-header"><div class="section-title">Audit Log</div><div style="font-size:13px;color:var(--text2)">Last '+log.length+' actions</div></div>';
  if (!log.length) {
    return h + '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No activity yet</div></div>';
  }
  h += '<div class="card card-p">';
  log.forEach(function(entry) {
    var actor = getUser(entry.userId);
    h += '<div class="audit-row">';
    h += '<div class="audit-dot"></div>';
    h += '<div style="flex:1"><div class="audit-action">'+esc(entry.action.replace(/_/g,' '))+'</div>';
    h += '<div class="audit-detail">'+(actor?esc(actor.name):'System')+(entry.entityType?' · '+esc(entry.entityType):'')+'</div></div>';
    h += '<div class="audit-time">'+relTime(entry.createdAt)+'</div></div>';
  });
  h += '</div>';
  return h;
}

// ─── PROFILE ─────────────────────────────────────────────────────────
function renderProfile() {
  var u = state.currentUser;
  var h = '<div class="profile-wrap">';
  h += '<div class="profile-header">';
  h += '<div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>';
  h += '<div><div class="profile-name">'+esc(u.name)+'</div><div class="profile-email">'+esc(u.email)+'</div>';
  h += '<div style="margin-top:8px"><span class="badge badge-'+u.role.toLowerCase()+'">'+esc(u.role)+'</span>';
  h += ' <span class="badge badge-active" style="margin-left:4px">Active</span></div></div></div>';

  // Profile form
  h += '<div class="card card-p" style="margin-top:16px">';
  h += '<div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Edit Profile</div>';
  h += '<div class="form-group"><label>Display Name</label><input id="pName" value="'+esc(u.name)+'"></div>';
  h += '<div class="form-group"><label>Email <span style="color:var(--text3);font-size:11px">(contact admin to change)</span></label>';
  h += '<input value="'+esc(u.email)+'" disabled style="opacity:.45;cursor:not-allowed"></div>';

  h += '<button class="btn btn-primary" onclick="saveProfile()">Save Changes</button>';
  h += '</div>';

  // Password form
  h += '<div class="card card-p" style="margin-top:16px">';
  h += '<div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Change Password</div>';
  h += '<div class="form-group"><label>New Password</label><input type="password" id="pNewPw" placeholder="Min 8 chars, 1 uppercase, 1 number"></div>';
  h += '<div class="form-group"><label>Confirm New Password</label><input type="password" id="pConPw" placeholder="Repeat password"></div>';
  h += '<button class="btn btn-ghost" onclick="savePassword()">Update Password</button>';
  h += '</div></div>';
  return h;
}
function saveProfile() {
  var el = document.getElementById('pName'); if (!el) return;
  var name = el.value.trim();
  if (!name) { toast('Name cannot be empty.','error'); return; }
  state.currentUser.name = name;
  toast('Profile updated.','success'); render();
}
function savePassword() {
  var n = document.getElementById('pNewPw'); var c = document.getElementById('pConPw');
  if (!n || !c) return;
  var err = validatePassword(n.value);
  if (err) { toast(err,'error'); return; }
  if (n.value !== c.value) { toast('Passwords do not match.','error'); return; }
  state.currentUser.password = n.value;
  n.value=''; c.value='';
  toast('Password updated.','success');
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────
function toggleNotif() { state.notifOpen = !state.notifOpen; render(); }
function markAllRead() {
  var uid = state.currentUser.id;
  DB.notifications.filter(function(n){return n.userId===uid;}).forEach(function(n){n.read=true;});
  render();
}
function readNotifBtn(el) {
  var id = el.getAttribute('data-id'); if (!id) return;
  var n = DB.notifications.find(function(x){return x.id===id;}); if (n) n.read=true; render();
}

function renderNotifPanel() {
  var u      = state.currentUser;
  var notifs = DB.notifications.filter(function(n){return n.userId===u.id;}).slice(0,40);
  var unread = notifs.filter(function(n){return !n.read;}).length;

  var h = '<div class="notif-panel">';
  h += '<div class="notif-header">';
  h += '<span class="notif-title">Notifications';
  if (unread>0) h += ' <span style="background:var(--brand-bg);color:var(--brand2);font-size:10px;padding:1px 6px;border-radius:5px;font-weight:700">'+unread+' new</span>';
  h += '</span>';
  h += '<div style="display:flex;gap:6px">';
  if (unread>0) h += '<button class="btn btn-xs btn-ghost" onclick="markAllRead()">Mark all read</button>';
  h += '<button class="btn btn-xs btn-ghost" onclick="toggleNotif()" aria-label="Close">✕</button>';
  h += '</div></div>';
  h += '<div class="notif-list">';
  if (!notifs.length) {
    h += '<div class="notif-empty">No notifications yet</div>';
  } else {
    notifs.forEach(function(n) {
      h += '<div class="notif-item'+(n.read?'':' unread')+'" data-id="'+n.id+'" onclick="readNotifBtn(this)">';
      h += '<div class="notif-dot2" style="opacity:'+(n.read?0:1)+'"></div>';
      h += '<div><div class="notif-text-title">'+esc(n.title)+'</div>';
      h += '<div class="notif-text-msg">'+esc(n.message)+'</div>';
      h += '<div class="notif-time">'+relTime(n.createdAt)+'</div></div></div>';
    });
  }
  h += '</div></div>';
  // FIX: click-outside dismiss — transparent overlay behind the panel
  h += '<div style="position:fixed;inset:0;z-index:149" onclick="toggleNotif()"></div>';
  return h;
}

// ─── MODAL SYSTEM ────────────────────────────────────────────────────
// FIX: All modals now share a consistent header with ✕ button.
// FIX: Rendered inside #app, not appended to body.
function openModal(type, data) { state.modal = { type:type, data:data||{} }; render(); }
function closeModal()          { state.modal = null; render(); }

function modalWrap(title, body, size) {
  // FIX: every modal gets a proper × close button in the header
  var w = size==='lg' ? 'max-width:640px' : 'max-width:480px';
  return '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">' +
    '<div class="modal" style="'+w+'">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px">' +
        '<div class="modal-title" style="margin-bottom:0">'+title+'</div>' +
        '<button onclick="closeModal()" class="btn btn-xs btn-ghost" aria-label="Close modal" style="flex-shrink:0;font-size:16px;padding:4px 8px;">✕</button>' +
      '</div>' +
      body +
    '</div>' +
  '</div>';
}

function colorPickerHtml(selected, fieldId) {
  var h = '<div class="color-picker" id="cp_'+fieldId+'">';
  COLORS.forEach(function(c) {
    h += '<div class="color-dot'+(selected===c?' selected':'')+'" style="background:'+COLOR_HEX[c]+'" title="'+c+'" data-color="'+c+'" data-field="'+fieldId+'" onclick="pickColor(this)"></div>';
  });
  h += '</div><input type="hidden" id="'+fieldId+'" value="'+(selected||'indigo')+'">';
  return h;
}
function pickColor(el) {
  var color = el.getAttribute('data-color');
  var field = el.getAttribute('data-field');
  var inp   = document.getElementById(field); if (inp) inp.value = color;
  var cpEl  = document.getElementById('cp_'+field);
  if (cpEl) cpEl.querySelectorAll('.color-dot').forEach(function(d){d.classList.toggle('selected', d===el);});
}

function renderModal() {
  var m = state.modal; if (!m) return '';
  var fns = {
    'create-shift': renderCreateShiftModal,
    'edit-shift':   function(){ return renderEditShiftModal(m.data.id); },
    'view-shift':   function(){ return renderViewShiftModal(m.data.id); },
    'request-swap': function(){ return renderRequestSwapModal(m.data.shiftId); },
    'respond-swap': function(){ return renderRespondSwapModal(m.data.id, m.data.action); },
    'review-swap':  function(){ return renderReviewSwapModal(m.data.id, m.data.action); },
    'create-user':       renderCreateUserModal,
    'edit-user':         function(){ return renderEditUserModal(m.data.id); },
    'edit-availability': renderEditAvailabilityModal,
    'reject-avail':      function(){ return renderRejectAvailModal(m.data.id); },
    'create-timeoff':    renderCreateTimeOffModal,
    'reject-timeoff':    function(){ return renderRejectTOModal(m.data.id); },
    'claim-openshift':   renderClaimOpenShiftModal,
    'create-openshift':  renderCreateOpenShiftModal,
  };
  return (fns[m.type]||function(){return '';})();
}

// ─── CREATE SHIFT MODAL ──────────────────────────────────────────────
function renderCreateShiftModal() {
  var defaultDate = state.modal.data.date || todayStr();
  var employees   = DB.users.filter(function(u){return u.status==='ACTIVE';});
  var isMgr = isAdminOrMgr();
  var body = '';
  if (isMgr) {
    body += '<div class="form-group"><label>Employee *</label><select id="mEmp"><option value="">Select employee…</option>';
    employees.forEach(function(u){ body += '<option value="'+u.id+'">'+esc(u.name)+' ('+esc(u.role.toLowerCase())+')</option>'; });
    body += '</select></div>';
  }
  body += '<div class="form-row">';
  body += '<div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+esc(defaultDate)+'"></div>';
  body += '<div class="form-group"><label>Position / Role</label><input id="mPos" placeholder="e.g. Front Desk"></div>';
  body += '</div><div class="form-row">';
  body += '<div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="09:00"></div>';
  body += '<div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="17:00"></div>';
  body += '</div>';
  body += '<div class="form-group"><label>Color Tag</label>'+colorPickerHtml('indigo','mColor')+'</div>';
  body += '<div class="form-group"><label>Shift Notes &amp; Tasks</label><textarea id="mNotes" placeholder="Optional shift notes, tasks, or instructions for this shift…"></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createShift()">Create Shift</button></div>';
  return modalWrap('Create Shift', body);
}
function createShift() {
  var isMgr   = isAdminOrMgr();
  var empId   = isMgr ? (document.getElementById('mEmp')||{}).value : state.currentUser.id;
  var date    = (document.getElementById('mDate')||{}).value    || '';
  var start   = (document.getElementById('mStart')||{}).value   || '';
  var end     = (document.getElementById('mEnd')||{}).value     || '';
  var pos     = (document.getElementById('mPos')||{}).value     || '';
  var notes   = (document.getElementById('mNotes')||{}).value   || '';
  var color   = (document.getElementById('mColor')||{}).value   || 'indigo';
  if (isMgr && !empId)   { toast('Please select an employee.','error');              return; }
  if (!date)             { toast('Date is required.','error');                        return; }
  if (!start || !end)    { toast('Start and end times are required.','error');        return; }
  if (timeToMins(end) <= timeToMins(start)) { toast('End time must be after start time.','error'); return; }
  if (hasConflict(empId, date, start, end, null)) { toast('Conflict: this employee already has an overlapping shift.','error'); return; }
  if (isOnApprovedTimeOff(empId, date)) {
    if (!confirm('⚠️ This employee has approved time off on '+date+'. Schedule anyway?')) return;
  }
  var shift = { id:nextId('s'), employeeId:empId, createdById:state.currentUser.id,
                date:date, startTime:start, endTime:end, position:pos, notes:notes, colorTag:color,
                createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  DB.shifts.push(shift);
  addNotif(empId,'Shift Assigned','New shift on '+date+' from '+fmt12(start)+' to '+fmt12(end)+(pos?' ('+pos+')':'')+'.');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_CREATED',entityType:'Shift',entityId:shift.id,createdAt:new Date().toISOString()});
  toast('Shift created.','success'); closeModal();
}

// ─── EDIT SHIFT MODAL ───────────────────────────────────────────────
function renderEditShiftModal(id) {
  var s = getShift(id);
  if (!s) return modalWrap('Shift Not Found','<p style="color:var(--text2)">This shift could not be found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var employees = DB.users.filter(function(u){return u.status==='ACTIVE';});
  var body = '<div class="form-group"><label>Employee *</label><select id="mEmp">';
  employees.forEach(function(u){ body += '<option value="'+u.id+'"'+(u.id===s.employeeId?' selected':'')+'>'+esc(u.name)+'</option>'; });
  body += '</select></div>';
  body += '<div class="form-row">';
  body += '<div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+esc(s.date)+'"></div>';
  body += '<div class="form-group"><label>Position / Role</label><input id="mPos" value="'+esc(s.position||'')+'"></div>';
  body += '</div><div class="form-row">';
  body += '<div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="'+esc(s.startTime)+'"></div>';
  body += '<div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="'+esc(s.endTime)+'"></div>';
  body += '</div>';
  body += '<div class="form-group"><label>Color Tag</label>'+colorPickerHtml(s.colorTag||'indigo','mColor')+'</div>';
  body += '<div class="form-group"><label>Notes</label><textarea id="mNotes">'+esc(s.notes||'')+'</textarea></div>';
  body += '<div class="modal-actions">';
  body += '<button class="btn btn-danger" onclick="deleteShiftConfirm(\''+id+'\')">Delete</button>';
  body += '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body += '<button class="btn btn-primary" onclick="updateShift(\''+id+'\')">Save Changes</button>';
  body += '</div>';
  return modalWrap('Edit Shift', body);
}
function updateShift(id) {
  var s = getShift(id); if (!s) return;
  var activeSwap = DB.swaps.some(function(sw){ return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1; });
  if (activeSwap) { toast('Cannot edit: this shift has an active swap request.','error'); return; }
  var empId = (document.getElementById('mEmp')||{}).value  || s.employeeId;
  var date  = (document.getElementById('mDate')||{}).value || s.date;
  var start = (document.getElementById('mStart')||{}).value|| s.startTime;
  var end   = (document.getElementById('mEnd')||{}).value  || s.endTime;
  if (timeToMins(end) <= timeToMins(start)) { toast('End time must be after start time.','error'); return; }
  if (hasConflict(empId, date, start, end, id)) { toast('Conflict: overlapping shift exists.','error'); return; }
  s.employeeId=empId; s.date=date; s.startTime=start; s.endTime=end;
  s.position = (document.getElementById('mPos')||{}).value ||'';
  s.notes    = (document.getElementById('mNotes')||{}).value||'';
  s.colorTag = (document.getElementById('mColor')||{}).value||s.colorTag;
  s.updatedAt = new Date().toISOString();
  addNotif(s.employeeId,'Shift Updated','Your shift on '+date+' has been updated to '+fmt12(start)+' – '+fmt12(end)+'.','shift');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_UPDATED',entityType:'Shift',entityId:id,createdAt:new Date().toISOString()});
  toast('Shift updated.','success'); closeModal();
}
function deleteShiftConfirm(id) {
  var activeSwap = DB.swaps.some(function(sw){ return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1; });
  if (activeSwap) { toast('Cannot delete: shift has an active swap request.','error'); return; }
  if (!confirm('Delete this shift? This cannot be undone.')) return;
  var s = getShift(id);
  if (s) addNotif(s.employeeId,'Shift Removed','Your shift on '+s.date+' has been removed.','shift');
  DB.shifts = DB.shifts.filter(function(x){return x.id!==id;});
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_DELETED',entityType:'Shift',entityId:id,createdAt:new Date().toISOString()});
  toast('Shift deleted.','success'); closeModal();
}

// ─── VIEW SHIFT MODAL ───────────────────────────────────────────────
function renderViewShiftModal(id) {
  var s = getShift(id);
  if (!s) return modalWrap('Shift Not Found','<p style="color:var(--text2)">This shift could not be found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var emp    = getUser(s.employeeId);
  var u      = state.currentUser; var isMgr = isAdminOrMgr();
  var isOwn  = s.employeeId === u.id;
  var isPast = s.date < todayStr();
  var hasSwap= DB.swaps.some(function(sw){ return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1; });
  var cls    = 'color-'+(s.colorTag||'indigo');

  var body = '<div class="'+cls+'" style="border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,.07)">';
  if (isMgr && emp) {
    body += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
    body += '<div class="avatar" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    body += '<div><div style="font-weight:700">'+esc(emp.name)+'</div><div style="font-size:12px;opacity:.7">'+esc(emp.email)+'</div></div></div>';
  }
  body += '<div style="font-size:15px;font-weight:700">'+fmtDateLabel(s.date)+'</div>';
  body += '<div style="font-size:14px;margin-top:4px">'+fmtRange(s.startTime,s.endTime)+'</div>';
  if (s.position) body += '<div style="font-size:13px;margin-top:4px;opacity:.8">'+esc(s.position)+'</div>';
  if (s.notes)    body += '<div style="font-size:12px;margin-top:8px;opacity:.7">📝 '+esc(s.notes)+'</div>';
  body += '</div>';

  var onTO = isOnApprovedTimeOff(s.employeeId, s.date);
  if (isPast)  body += '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">⏰ This shift is in the past.</div>';
  if (onTO)    body += '<div style="font-size:12px;color:var(--red);background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;margin-bottom:14px">⛔ This employee has approved time off on this date.</div>';
  if (hasSwap) body += '<div style="font-size:12px;color:var(--amber);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);border-radius:8px;padding:10px;margin-bottom:14px">⚠️ This shift has an active swap request.</div>';

  body += '<div class="modal-actions" style="flex-wrap:wrap">';
  if (isOwn && !isPast && !hasSwap) body += '<button class="btn btn-brand" onclick="closeModal();openModal(\'request-swap\',{shiftId:\''+id+'\'})">Request Swap</button>';
  if (isMgr) body += '<button class="btn btn-ghost" onclick="closeModal();openModal(\'edit-shift\',{id:\''+id+'\'})">Edit Shift</button>';
  body += '<button class="btn btn-ghost" onclick="closeModal()">Close</button>';
  body += '</div>';
  return modalWrap('Shift Details', body);
}

// ─── REQUEST SWAP MODAL ─────────────────────────────────────────────
// FIX: single clean return statement, dead code removed
function renderRequestSwapModal(shiftId) {
  var u     = state.currentUser;
  var shift = getShift(shiftId);
  if (!shift) return modalWrap('Shift Not Found','<p style="color:var(--text2)">Shift not found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');

  var employees = DB.users.filter(function(x){ return x.status==='ACTIVE' && x.id!==u.id; });
  var cls       = 'color-'+(shift.colorTag||'indigo');
  var empOpts   = '<option value="">Open swap — any available employee</option>';
  employees.forEach(function(e){ empOpts += '<option value="'+e.id+'">'+esc(e.name)+'</option>'; });

  var body = '<div style="margin-bottom:16px">';
  body += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Your shift</div>';
  body += '<div class="'+cls+'" style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06)">';
  body += '<div style="font-weight:600">'+fmtDateLabel(shift.date)+'</div>';
  body += '<div style="font-size:13px;opacity:.8">'+fmtRange(shift.startTime,shift.endTime)+(shift.position?' · '+esc(shift.position):'')+'</div>';
  body += '</div></div>';
  body += '<div class="form-group"><label>Swap with (optional — leave blank for open request)</label>';
  body += '<select id="swEmp">'+empOpts+'</select></div>';
  body += '<div class="form-group"><label>Message to recipient (optional)</label>';
  body += '<textarea id="swMsg" placeholder="Explain why you need to swap…"></textarea></div>';
  body += '<div style="font-size:12px;color:var(--text3);background:var(--bg3);border-radius:8px;padding:10px 12px;margin-bottom:16px;line-height:1.6">';
  body += '⚠️ Swaps require approval from a manager or admin before taking effect.';
  body += '</div>';
  body += '<div class="modal-actions">';
  body += '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body += '<button class="btn btn-primary" data-shiftid="'+shiftId+'" onclick="createSwapSubmit(this)">Send Request</button>';
  body += '</div>';
  return modalWrap('Request Shift Swap', body);
}
function createSwapSubmit(btn) {
  var shiftId = btn.getAttribute('data-shiftid'); createSwap(shiftId);
}
function createSwap(shiftId) {
  var u = state.currentUser; var shift = getShift(shiftId); if (!shift) return;
  if (shift.date < todayStr()) { toast('Cannot request a swap for a past shift.','error'); return; }
  var dup = DB.swaps.some(function(sw){ return sw.requesterShiftId===shiftId&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1; });
  if (dup) { toast('This shift already has an active swap request.','error'); return; }
  var recId = (document.getElementById('swEmp')||{}).value || null;
  var msg   = (document.getElementById('swMsg')||{}).value || '';
  // Circular swap guard
  if (recId) {
    var circular = DB.swaps.some(function(sw){ return sw.requesterId===recId&&sw.receiverId===u.id&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1; });
    if (circular) { toast('A swap request already exists in the opposite direction.','error'); return; }
  }
  var sw = { id:nextId('sw'), status:'PENDING', requesterId:u.id, receiverId:recId||null,
             requesterShiftId:shiftId, receiverShiftId:null, message:msg, adminNotes:'',
             responseMessage:'', responseBy:null, responseAt:null,
             expiresAt:new Date(Date.now()+7*864e5).toISOString(),
             createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
             reviewedById:null, reviewedAt:null };
  DB.swaps.push(sw);
  if (recId) addNotif(recId,'Swap Request',u.name+' has requested a shift swap with you.','swap');
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_REQUESTED',entityType:'SwapRequest',entityId:sw.id,createdAt:new Date().toISOString()});
  toast('Swap request sent!','success'); closeModal();
}

// ─── RESPOND SWAP MODAL ──────────────────────────────────────────────
// FIX: action state stored in a proper <input>, response buttons toggle classes correctly
function renderRespondSwapModal(swapId, defaultAction) {
  var sw  = getSwap(swapId); if (!sw) return '';
  var rs  = getShift(sw.requesterShiftId);
  var req = getUser(sw.requesterId);
  if (!rs || !req) return '';

  var body = '<div style="margin-bottom:16px">';
  body += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Shift being swapped</div>';
  body += '<div class="color-'+(rs.colorTag||'indigo')+'" style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06)">';
  body += '<div style="font-weight:600">'+fmtDateLabel(rs.date)+'</div>';
  body += '<div style="font-size:13px;opacity:.8">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
  body += '<div style="font-size:12px;margin-top:4px;opacity:.7">Requested by '+esc(req.name)+(sw.message?' · "'+esc(sw.message)+'"':'')+'</div>';
  body += '</div></div>';
  // FIX: action stored in a hidden input; buttons toggle it and update their own classes via id
  body += '<div class="form-group"><label>Your Decision</label>';
  body += '<div style="display:flex;gap:8px;margin-top:4px">';
  body += '<button id="rBtnA" class="btn '+(defaultAction==='ACCEPT'?'btn-success':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setRespondAction(\'ACCEPT\')">✓ Accept</button>';
  body += '<button id="rBtnD" class="btn '+(defaultAction==='DECLINE'?'btn-danger':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setRespondAction(\'DECLINE\')">✕ Decline</button>';
  body += '</div><input type="hidden" id="rAction" value="'+(defaultAction||'ACCEPT')+'"></div>';
  body += '<div class="form-group"><label>Message (optional)</label><textarea id="rMsg" placeholder="Add a note to the requester…"></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body += '<button class="btn btn-primary" data-id="'+swapId+'" onclick="submitRespond(this)">Confirm Response</button></div>';
  return modalWrap('Respond to Swap Request', body);
}
function setRespondAction(action) {
  var inp = document.getElementById('rAction'); if (inp) inp.value = action;
  var a = document.getElementById('rBtnA'); var d = document.getElementById('rBtnD');
  if (a) a.className = 'btn ' + (action==='ACCEPT'  ? 'btn-success':'btn-ghost') + '';
  if (d) d.className = 'btn ' + (action==='DECLINE' ? 'btn-danger' :'btn-ghost') + '';
  // keep flex styles
  if (a) a.style.cssText='flex:1;justify-content:center';
  if (d) d.style.cssText='flex:1;justify-content:center';
}
function submitRespond(btn) {
  var swapId = btn.getAttribute('data-id');
  var sw     = getSwap(swapId); if (!sw) return;
  if (new Date() > new Date(sw.expiresAt)) { toast('This swap request has expired.','error'); return; }
  var action = (document.getElementById('rAction')||{}).value;
  var u      = state.currentUser;
  if (action==='ACCEPT') {
    var rs = getShift(sw.requesterShiftId);
    if (rs && hasConflict(u.id, rs.date, rs.startTime, rs.endTime, sw.receiverShiftId)) {
      toast('You have a conflicting shift on that date — cannot accept.','error'); return;
    }
    sw.status='ACCEPTED';
    addNotif(sw.requesterId,'Swap Accepted',u.name+' accepted your swap request. Awaiting manager approval.','swap');
    DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){
      addNotif(mgr.id,'Swap Needs Review','A swap between '+getUser(sw.requesterId).name+' and '+u.name+' is awaiting your approval.','swap');
    });
  } else {
    sw.status='DECLINED';
    addNotif(sw.requesterId,'Swap Declined',u.name+' declined your swap request.','swap');
  }
  var rMsg = (document.getElementById('rMsg')||{}).value || '';
  sw.responseMessage = rMsg;
  sw.responseBy = u.id;
  sw.responseAt = new Date().toISOString();
  sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action+'D',entityType:'SwapRequest',entityId:swapId,createdAt:new Date().toISOString()});
  // Notify with the response message
  if (action==='ACCEPT') {
    if (rMsg) addNotif(sw.requesterId,'Swap Response',u.name+' says: '+rMsg,'swap');
  } else {
    if (rMsg) addNotif(sw.requesterId,'Swap Response',u.name+' says: '+rMsg,'swap');
  }
  toast('Swap '+action.toLowerCase()+'ed.','success'); closeModal();
}

// ─── REVIEW SWAP MODAL ───────────────────────────────────────────────
function renderReviewSwapModal(swapId, defaultAction) {
  var sw  = getSwap(swapId); if (!sw) return '';
  var req = getUser(sw.requesterId); var rec = sw.receiverId?getUser(sw.receiverId):null;
  var rs  = getShift(sw.requesterShiftId); var recS = sw.receiverShiftId?getShift(sw.receiverShiftId):null;

  var body = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">';
  body += '<div style="background:var(--bg3);border-radius:10px;padding:14px">';
  body += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Requester</div>';
  body += '<div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+(req?esc(req.avatarColor):'#888')+'">'+esc(req?initials(req.name):'?')+'</div><span style="font-weight:600;font-size:13px">'+(req?esc(req.name):'?')+'</span></div></div>';
  if (rec) {
    body += '<div style="background:var(--bg3);border-radius:10px;padding:14px">';
    body += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Receiver</div>';
    body += '<div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+esc(rec.avatarColor)+'">'+esc(initials(rec.name))+'</div><span style="font-weight:600;font-size:13px">'+esc(rec.name)+'</span></div></div>';
  } else body += '<div></div>';
  body += '</div>';

  body += '<div style="display:grid;grid-template-columns:1fr 32px 1fr;gap:8px;align-items:center;margin-bottom:16px">';
  if (rs) { body += '<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div><div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div><div class="swap-shift-time">'+fmtRange(rs.startTime,rs.endTime)+'</div></div>'; }
  body += '<div style="text-align:center;color:var(--text3);font-size:18px">⇄</div>';
  if (recS) { body += '<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div><div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div><div class="swap-shift-time">'+fmtRange(recS.startTime,recS.endTime)+'</div></div>'; }
  else       { body += '<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">No specific shift</div><div style="font-size:12px;color:var(--text3);margin-top:4px">'+(rec?'With '+esc(rec.name):'Open swap')+'</div></div>'; }
  body += '</div>';

  if (sw.message) body += '<div class="swap-message" style="margin-bottom:16px">💬 '+esc(sw.message)+'</div>';

  body += '<div class="form-group"><label>Decision</label>';
  body += '<div style="display:flex;gap:8px;margin-top:4px">';
  body += '<button id="rvA" class="btn '+(defaultAction==='APPROVE'?'btn-success':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setReviewAction(\'APPROVE\')">✓ Approve</button>';
  body += '<button id="rvR" class="btn '+(defaultAction==='REJECT'?'btn-danger':'btn-ghost')+'"  style="flex:1;justify-content:center" onclick="setReviewAction(\'REJECT\')">✕ Reject</button>';
  body += '</div><input type="hidden" id="rvAction" value="'+(defaultAction||'APPROVE')+'"></div>';
  body += '<div class="form-group"><label>Admin Notes (optional)</label><textarea id="rvNotes" placeholder="Reason for your decision…"></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body += '<button class="btn btn-primary" data-id="'+swapId+'" onclick="submitReview(this)">Confirm Decision</button></div>';
  return modalWrap('Review Swap Request', body, 'lg');
}
function setReviewAction(action) {
  var inp = document.getElementById('rvAction'); if (inp) inp.value = action;
  var a = document.getElementById('rvA'); var r = document.getElementById('rvR');
  if (a) { a.className='btn '+(action==='APPROVE'?'btn-success':'btn-ghost'); a.style.cssText='flex:1;justify-content:center'; }
  if (r) { r.className='btn '+(action==='REJECT'?'btn-danger':'btn-ghost');   r.style.cssText='flex:1;justify-content:center'; }
}
function submitReview(btn) {
  var swapId = btn.getAttribute('data-id');
  var sw     = getSwap(swapId); if (!sw) return;
  var action = (document.getElementById('rvAction')||{}).value;
  var notes  = (document.getElementById('rvNotes')||{}).value  || '';
  var u      = state.currentUser;
  if (action==='APPROVE') {
    var rs   = getShift(sw.requesterShiftId);
    var recS = sw.receiverShiftId ? getShift(sw.receiverShiftId) : null;
    if (rs && recS) {
      // Atomic swap of employeeIds
      var temp = rs.employeeId; rs.employeeId = recS.employeeId; recS.employeeId = temp;
      rs.updatedAt = recS.updatedAt = new Date().toISOString();
    } else if (rs && sw.receiverId) {
      rs.employeeId = sw.receiverId; rs.updatedAt = new Date().toISOString();
    }
    sw.status = 'APPROVED';
    addNotif(sw.requesterId,'Swap Approved','Your shift swap has been approved by management!','swap');
    if (sw.receiverId) addNotif(sw.receiverId,'Swap Approved','The swap you accepted has been approved by management!','swap');
  } else {
    sw.status = 'REJECTED';
    addNotif(sw.requesterId,'Swap Rejected','Your swap request was rejected.'+(notes?' Note: '+notes:''),'swap');
    if (sw.receiverId) addNotif(sw.receiverId,'Swap Rejected','The swap was rejected by management.','swap');
  }
  sw.adminNotes=notes; sw.reviewedById=u.id; sw.reviewedAt=new Date().toISOString(); sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action+'D',entityType:'SwapRequest',entityId:swapId,createdAt:new Date().toISOString()});
  toast('Swap '+(action==='APPROVE'?'approved':'rejected')+'.','success'); closeModal();
}

// ─── CREATE USER MODAL ───────────────────────────────────────────────
function renderCreateUserModal() {
  var body = '<div class="form-row">';
  body += '<div class="form-group"><label>Full Name *</label><input id="uName" placeholder="Jane Smith" autocomplete="off"></div>';
  body += '<div class="form-group"><label>Email Address *</label><input type="email" id="uEmail" placeholder="jane@company.com" autocomplete="off"></div>';
  body += '</div><div class="form-row">';
  body += '<div class="form-group"><label>Password *</label><input type="password" id="uPass" placeholder="Min 8 chars, 1 uppercase, 1 number"></div>';
  body += '<div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div>';
  body += '</div>';

  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createUser()">Create User</button></div>';
  return modalWrap('Create User', body);
}
function createUser() {
  var name  = ((document.getElementById('uName')||{}).value||'').trim();
  var email = ((document.getElementById('uEmail')||{}).value||'').trim().toLowerCase();
  var pass  = (document.getElementById('uPass')||{}).value||'';
  var role  = (document.getElementById('uRole')||{}).value||'EMPLOYEE';
  if (!name)                 { toast('Full name is required.','error');           return; }
  if (!validateEmail(email)) { toast('Enter a valid email address.','error');     return; }
  var pwErr = validatePassword(pass);
  if (pwErr)                 { toast(pwErr,'error');                              return; }
  if (DB.users.find(function(u){return u.email.toLowerCase()===email;})) { toast('Email already registered.','error'); return; }
  var col  = AV_COLORS[DB.users.length % AV_COLORS.length];
  var user = { id:nextId('u'), name:name, email:email, password:pass, role:role, status:'ACTIVE', avatarColor:col, createdAt:new Date().toISOString() };
  DB.users.push(user);
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_CREATED',entityType:'User',entityId:user.id,createdAt:new Date().toISOString()});
  toast('User '+name+' created.','success'); closeModal();
}

// ─── EDIT USER MODAL ─────────────────────────────────────────────────
function renderEditUserModal(id) {
  var u = getUser(id);
  if (!u) return modalWrap('User Not Found','<p style="color:var(--text2)">User not found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var body = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px;background:var(--bg3);border-radius:10px">';
  body += '<div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>';
  body += '<div><div style="font-weight:700;font-size:15px">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div>';
  body += '<div class="form-row">';
  body += '<div class="form-group"><label>Full Name</label><input id="uName" value="'+esc(u.name)+'"></div>';
  body += '<div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE"'+(u.role==='EMPLOYEE'?' selected':'')+'>Employee</option><option value="MANAGER"'+(u.role==='MANAGER'?' selected':'')+'>Manager</option><option value="ADMIN"'+(u.role==='ADMIN'?' selected':'')+'>Admin</option></select></div>';
  body += '</div>';

  body += '<div class="form-group"><label>New Password <span style="color:var(--text3);font-size:11px">(leave blank to keep current)</span></label><input type="password" id="uPass" placeholder="••••••••"></div>';
  body += '<div class="form-group"><label>Email <span style="color:var(--text3);font-size:11px">(cannot be changed)</span></label><input value="'+esc(u.email)+'" disabled style="opacity:.4;cursor:not-allowed"></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+id+'" onclick="updateUserSubmit(this)">Save Changes</button></div>';
  return modalWrap('Edit User', body);
}
function updateUserSubmit(btn) { updateUser(btn.getAttribute('data-id')||''); }
function updateUser(id) {
  var u = getUser(id); if (!u) return;
  var name = ((document.getElementById('uName')||{}).value||'').trim();
  var role = (document.getElementById('uRole')||{}).value;
  var pass = (document.getElementById('uPass')||{}).value||'';
  if (!name)  { toast('Name cannot be empty.','error'); return; }
  if (pass) {
    var err = validatePassword(pass);
    if (err) { toast(err,'error'); return; }
    u.password = pass;
  }
  u.name=name; u.role=role;
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_UPDATED',entityType:'User',entityId:id,createdAt:new Date().toISOString()});
  toast('User updated.','success'); closeModal();
}

// ═══════════════════════════════════════════════════════════════════
// v3 NEW: AVAILABILITY PAGE
// ═══════════════════════════════════════════════════════════════════
function renderAvailability() {
  if (!isAdminOrMgr()) return renderAvailabilityEmployee();
  // Managers/Admins get their OWN availability section + the admin management section
  var h = '<div style="margin-bottom:28px">';
  h += '<div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px">';
  h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  h += 'My Availability</div>';
  h += '<div style="font-size:12px;color:var(--text3)">Your personal recurring availability (managers have schedules too)</div></div>';
  h += renderAvailabilityEmployee();
  h += '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">';
  h += '<div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px">';
  h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>';
  h += 'Team Availability Management</div>';
  h += '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Review and manage team availability</div></div>';
  h += renderAvailabilityAdmin();
  return h;
}
function renderAvailabilityEmployee() {
  var u = state.currentUser;
  var myAvail  = getUserAvailability(u.id);
  var myReqs   = DB.availRequests.filter(function(r){ return r.userId===u.id; }).slice().reverse();
  var hasPending = myReqs.some(function(r){ return r.status==='PENDING'; });
  var h = '<div style="max-width:720px">';
  h += '<div class="section-header"><div><div class="section-title">My Weekly Availability</div>';
  h += '<div style="font-size:13px;color:var(--text2);margin-top:2px">Your recurring weekly schedule preference</div></div>';
  if (!hasPending)
    h += '<button class="btn btn-primary" onclick="openModal(\'edit-availability\',{})">Request Change</button>';
  else
    h += '<span class="badge badge-pending" style="font-size:12px">Change request pending</span>';
  h += '</div>';
  h += '<div class="card" style="margin-bottom:20px"><div class="card-header"><span class="card-title">Current Availability</span></div>';
  h += '<div style="padding:16px;display:grid;grid-template-columns:repeat(7,1fr);gap:8px">';
  AVAIL_DAYS.forEach(function(wd) {
    var rec = myAvail.find(function(a){ return a.dayOfWeek===wd.idx; }) || { isAvailable:false, startTime:'09:00', endTime:'17:00' };
    h += '<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:10px 4px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">'+wd.label.slice(0,3)+'</div>';
    if (rec.isAvailable)
      h += '<div style="font-size:10px;color:var(--green);line-height:1.6">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>';
    else
      h += '<div style="font-size:12px;color:var(--text3);font-weight:500">Off</div>';
    h += '</div>';
  });
  h += '</div></div>';
  if (myReqs.length) {
    h += '<div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:14px">Change Requests</div>';
    myReqs.slice(0,5).forEach(function(r) {
      h += '<div class="v3-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
      h += '<div style="font-size:13px;font-weight:600;color:var(--text)">Availability Change Request</div>';
      h += '<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
      if (r.notes) h += '<div style="font-size:12px;color:var(--text2);margin-bottom:10px">'+esc(r.notes)+'</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
      AVAIL_DAYS.forEach(function(wd) {
        var pa = r.proposedAvailability.find(function(a){ return a.dayOfWeek===wd.idx; });
        h += '<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px 2px">';
        h += '<div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:3px">'+wd.label.slice(0,3).toUpperCase()+'</div>';
        if (pa && pa.isAvailable) h += '<div style="font-size:9px;color:var(--green)">'+fmt12(pa.startTime)+'<br>'+fmt12(pa.endTime)+'</div>';
        else h += '<div style="font-size:10px;color:var(--red)">Off</div>';
        h += '</div>';
      });
      h += '</div>';
      h += '<div style="font-size:11px;color:var(--text3);margin-top:8px">Submitted '+relTime(r.createdAt)+(r.reviewedAt?' \u00b7 Reviewed '+relTime(r.reviewedAt):'')+'</div>';
      h += '</div>';
    });
  }
  h += '</div>'; return h;
}
function renderAvailabilityAdmin() {
  var pending = DB.availRequests.filter(function(r){ return r.status==='PENDING'; }).length;
  var tabs = [{id:'overview',label:'Team Overview'},{id:'requests',label:'Change Requests'+(pending?' ('+pending+')':'')}];
  var h = '<div class="admin-tabs">';
  tabs.forEach(function(t){
    h += '<button class="admin-tab'+(state.availTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAvailTab(this)">'+t.label+'</button>';
  });
  h += '</div>';
  return h + (state.availTab==='overview' ? renderAvailOverview() : renderAvailRequests());
}
function setAvailTab(el) { state.availTab = el.getAttribute('data-tab') || 'overview'; render(); }
function renderAvailOverview() {
  var employees = DB.users.filter(function(u){ return u.status==='ACTIVE' && u.role==='EMPLOYEE'; });
  var h = '<div class="section-header"><div class="section-title">Team Weekly Availability</div></div>';
  if (!employees.length) return h + '<div class="empty-state"><div class="empty-title">No employees found</div></div>';
  employees.forEach(function(emp) {
    var avail = getUserAvailability(emp.id);
    h += '<div class="card" style="margin-bottom:16px"><div class="card-header">';
    h += '<div style="display:flex;align-items:center;gap:10px">';
    h += '<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h += '<div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(emp.department||'No dept')+'</div></div></div></div>';
    h += '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
    AVAIL_DAYS.forEach(function(wd) {
      var rec = avail.find(function(a){ return a.dayOfWeek===wd.idx; });
      h += '<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:8px 4px">';
      h += '<div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:4px">'+wd.label.slice(0,3).toUpperCase()+'</div>';
      if (rec && rec.isAvailable) h += '<div style="font-size:9px;color:var(--green);line-height:1.5">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>';
      else h += '<div style="font-size:10px;color:var(--text3)">Off</div>';
      h += '</div>';
    });
    h += '</div></div>';
  });
  return h;
}
function renderAvailRequests() {
  var reqs = DB.availRequests.slice().reverse();
  var h = '<div class="section-header"><div class="section-title">Availability Change Requests</div></div>';
  if (!reqs.length) return h + '<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No requests</div></div>';
  reqs.forEach(function(r) {
    var emp = getUser(r.userId); if (!emp) return;
    var cur = getUserAvailability(r.userId);
    h += '<div class="v3-card">';
    h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">';
    h += '<div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h += '<div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div><div class="swap-meta">'+relTime(r.createdAt)+'</div></div></div>';
    h += '<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
    if (r.notes) h += '<div class="swap-message" style="margin-bottom:12px">'+esc(r.notes)+'</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">';
    h += '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Current</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
    AVAIL_DAYS.forEach(function(wd) {
      var ca = cur.find(function(a){ return a.dayOfWeek===wd.idx; });
      h += '<div style="text-align:center;background:var(--bg3);border-radius:5px;padding:5px 2px">';
      h += '<div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:2px">'+wd.label.slice(0,2)+'</div>';
      h += (ca && ca.isAvailable ? '<div style="font-size:8px;color:var(--green)">\u2713</div>' : '<div style="font-size:8px;color:var(--text3)">\u2715</div>');
      h += '</div>';
    });
    h += '</div></div>';
    h += '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Proposed</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
    AVAIL_DAYS.forEach(function(wd) {
      var pa = r.proposedAvailability.find(function(a){ return a.dayOfWeek===wd.idx; });
      var ca = cur.find(function(a){ return a.dayOfWeek===wd.idx; });
      var changed = pa && ca && pa.isAvailable !== ca.isAvailable;
      h += '<div style="text-align:center;border-radius:5px;padding:5px 2px;background:'+(changed?'rgba(99,102,241,.15)':'var(--bg3)')+'">';
      h += '<div style="font-size:9px;font-weight:700;color:'+(changed?'var(--brand2)':'var(--text3)')+';margin-bottom:2px">'+wd.label.slice(0,2)+'</div>';
      h += (pa && pa.isAvailable ? '<div style="font-size:8px;color:var(--green)">\u2713</div>' : '<div style="font-size:8px;color:var(--text3)">\u2715</div>');
      h += '</div>';
    });
    h += '</div></div></div>';
    if (r.status === 'PENDING') {
      h += '<div class="swap-actions">';
      if (r.userId !== state.currentUser.id) {
        h += '<button class="btn btn-success btn-sm" data-id="'+r.id+'" onclick="approveAvailBtn(this)">\u2713 Approve</button>';
        h += '<button class="btn btn-danger btn-sm" data-id="'+r.id+'" onclick="openModal(\'reject-avail\',{id:\''+r.id+'\'})">Reject</button>';
      } else {
        h += '<span style="font-size:12px;color:var(--text3);font-style:italic">\u26a0 Cannot self-approve \u2014 assign to another admin</span>';
      }
      h += '</div>';
    }
    h += '</div>';
  });
  return h;
}
function approveAvailBtn(el) {
  var id = el.getAttribute('data-id'), r = getAvReq(id); if (!r) return;
  if (r.userId === state.currentUser.id) {
    toast('You cannot approve your own availability request.','error'); return;
  }
  r.proposedAvailability.forEach(function(pa) {
    var ex = DB.availability.find(function(a){ return a.userId===r.userId && a.dayOfWeek===pa.dayOfWeek; });
    if (ex) { ex.isAvailable=pa.isAvailable; ex.startTime=pa.startTime; ex.endTime=pa.endTime; }
    else     DB.availability.push({id:nextId('av'),userId:r.userId,dayOfWeek:pa.dayOfWeek,startTime:pa.startTime,endTime:pa.endTime,isAvailable:pa.isAvailable});
  });
  r.status='APPROVED'; r.reviewedBy=state.currentUser.id; r.reviewedAt=new Date().toISOString(); r.updatedAt=new Date().toISOString();
  addNotif(r.userId,'Availability Approved','Your availability change request has been approved.','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'AVAILABILITY_APPROVED',entityType:'AvailabilityRequest',entityId:id,createdAt:new Date().toISOString()});
  toast('Availability approved.','success'); render();
}
function renderEditAvailabilityModal() {
  var u = state.currentUser, cur = getUserAvailability(u.id);
  var body = '<p style="font-size:13px;color:var(--text2);margin-bottom:16px">Set your recurring weekly availability. A manager will review before changes take effect.</p>';
  body += '<div class="form-group"><label>Reason / Notes (optional)</label><textarea id="availNotes" placeholder="Explain the reason for this change..."></textarea></div>';
  body += '<div style="margin-bottom:16px">';
  AVAIL_DAYS.forEach(function(wd) {
    var rec = cur.find(function(a){ return a.dayOfWeek===wd.idx; }) || {isAvailable:false,startTime:'09:00',endTime:'17:00'};
    body += '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">';
    body += '<div style="width:90px;font-size:13px;font-weight:600;color:var(--text)">'+wd.label+'</div>';
    body += '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--text2)">';
    body += '<input type="checkbox" id="avchk-'+wd.idx+'" '+(rec.isAvailable?'checked':'')+' onchange="availToggle('+wd.idx+')"> Available</label>';
    body += '<div id="avtimes-'+wd.idx+'" style="display:'+(rec.isAvailable?'flex':'none')+';gap:8px;align-items:center;margin-left:auto">';
    body += '<input type="time" id="avst-'+wd.idx+'" value="'+rec.startTime+'" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px">';
    body += '<span style="color:var(--text3);font-size:12px">to</span>';
    body += '<input type="time" id="avet-'+wd.idx+'" value="'+rec.endTime+'" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px">';
    body += '</div></div>';
  });
  body += '</div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAvailRequest()">Submit Request</button></div>';
  return modalWrap('Request Availability Change', body);
}
function availToggle(dayIdx) {
  var chk = document.getElementById('avchk-'+dayIdx);
  var times = document.getElementById('avtimes-'+dayIdx);
  if (times) times.style.display = (chk && chk.checked) ? 'flex' : 'none';
}
function submitAvailRequest() {
  var u = state.currentUser;
  var notes = ((document.getElementById('availNotes')||{}).value||'').trim();
  if (DB.availRequests.some(function(r){ return r.userId===u.id && r.status==='PENDING'; }))
    { toast('You already have a pending availability request.','error'); return; }
  var proposed = [], valid = true;
  AVAIL_DAYS.forEach(function(wd) {
    var chk = document.getElementById('avchk-'+wd.idx);
    var st  = document.getElementById('avst-'+wd.idx);
    var et  = document.getElementById('avet-'+wd.idx);
    var avail = chk && chk.checked;
    var start = (st && st.value) || '09:00', end = (et && et.value) || '17:00';
    if (avail && timeToMins(end) <= timeToMins(start))
      { toast('End time must be after start for '+wd.label,'error'); valid=false; return; }
    proposed.push({dayOfWeek:wd.idx,startTime:start,endTime:end,isAvailable:avail});
  });
  if (!valid || proposed.length !== 7) return;
  var req = {id:nextId('avr'),userId:u.id,status:'PENDING',proposedAvailability:proposed,
              notes:notes,reviewedBy:null,reviewedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  DB.availRequests.push(req);
  DB.users.filter(function(x){ return x.role==='ADMIN'||x.role==='MANAGER'; }).forEach(function(mgr){
    addNotif(mgr.id,'Availability Request',u.name+' submitted an availability change request.','info');
  });
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'AVAIL_REQUEST_SUBMITTED',entityType:'AvailabilityRequest',entityId:req.id,createdAt:new Date().toISOString()});
  toast('Availability change request submitted.','success'); closeModal();
}
function renderRejectAvailModal(id) {
  var r = getAvReq(id), emp = r ? getUser(r.userId) : null; if (!r || !emp) return '';
  var body = '<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px">';
  body += '<div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'\'s request</div>';
  body += '<div style="font-size:12px;color:var(--text2);margin-top:4px">'+(r.notes?esc(r.notes):'No notes')+'</div></div>';
  body += '<div class="form-group"><label>Reason for Rejection</label><textarea id="rejectAvailNotes" placeholder="Explain why..."></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" data-id="'+id+'" onclick="rejectAvailSubmit(this)">Reject Request</button></div>';
  return modalWrap('Reject Availability Request', body);
}
function rejectAvailSubmit(btn) {
  var id = btn.getAttribute('data-id'), r = getAvReq(id); if (!r) return;
  if (r.userId === state.currentUser.id) {
    toast('You cannot reject your own availability request.','error'); return;
  }
  var notes = ((document.getElementById('rejectAvailNotes')||{}).value||'').trim();
  r.status='REJECTED'; r.reviewedBy=state.currentUser.id; r.reviewedAt=new Date().toISOString(); r.updatedAt=new Date().toISOString();
  addNotif(r.userId,'Availability Rejected','Your availability change was not approved.'+(notes?' Reason: '+notes:''),'info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'AVAIL_REJECTED',entityType:'AvailabilityRequest',entityId:id,createdAt:new Date().toISOString()});
  toast('Request rejected.','info'); closeModal();
}

// ===================================================================
// v3 NEW: TIME OFF PAGE
// ===================================================================
function renderTimeOff() {
  if (!isAdminOrMgr()) return renderTimeOffEmployee();
  // Managers/Admins: see their OWN time-off section + admin management section
  var h = '<div style="margin-bottom:28px">';
  h += '<div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px">';
  h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>';
  h += 'My Time Off</div>';
  h += '<div style="font-size:12px;color:var(--text3)">Your personal time-off requests</div></div>';
  h += renderTimeOffEmployee();
  h += '<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)">';
  h += '<div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px">';
  h += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>';
  h += 'Team Time Off Management</div>';
  h += '<div style="font-size:12px;color:var(--text3);margin-bottom:16px">Review and approve team time-off requests</div></div>';
  h += renderTimeOffAdmin();
  return h;
}
function renderTimeOffEmployee() {
  var u = state.currentUser;
  var myReqs = DB.timeOffRequests.filter(function(r){ return r.userId===u.id; }).slice().reverse();
  var h = '<div style="max-width:700px"><div class="section-header"><div>';
  h += '<div class="section-title">My Time Off Requests</div>';
  h += '<div style="font-size:13px;color:var(--text2);margin-top:2px">Sick days and unpaid leave</div></div></div>';
  if (!myReqs.length)
    h += '<div class="empty-state"><div class="empty-icon">\uD83C\uDF34</div><div class="empty-title">No time-off requests</div><div class="empty-sub">Use the button above to submit a request</div></div>';
  else myReqs.forEach(function(r){ h += renderTOCard(r, false); });
  h += '</div>'; return h;
}
function renderTimeOffAdmin() {
  var tabs = [{id:'pending',label:'Pending ('+DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length+')'},{id:'all',label:'All Requests'}];
  var h = '<div class="admin-tabs">';
  tabs.forEach(function(t){
    h += '<button class="admin-tab'+(state.toTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setTOTab(this)">'+t.label+'</button>';
  });
  h += '</div>';
  var reqs = DB.timeOffRequests.slice().reverse();
  if (state.toTab === 'pending') reqs = reqs.filter(function(r){ return r.status==='PENDING'; });
  if (!reqs.length) return h + '<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No requests here</div></div>';
  reqs.forEach(function(r){ h += renderTOCard(r, true); });
  return h;
}
function setTOTab(el) { state.toTab = el.getAttribute('data-tab') || 'pending'; render(); }
function renderTOCard(r, adminView) {
  var emp = getUser(r.userId);
  var d1 = new Date(r.startDate+'T00:00:00'), d2 = new Date(r.endDate+'T00:00:00');
  var days = Math.round((d2-d1)/864e5)+1;
  var h = '<div class="v3-card">';
  if (adminView && emp) {
    h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
    h += '<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h += '<div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(emp.department||'')+'</div></div></div>';
  }
  h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">';
  h += '<div><div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(r.startDate)+(r.startDate!==r.endDate?' \u2192 '+fmtDateLabel(r.endDate):'')+'</div>';
  h += '<div style="font-size:12px;color:var(--text2);margin-top:3px">'+days+' day'+(days!==1?'s':'')+' \u00b7 <span style="text-transform:capitalize;color:'+(r.type==='sick'?'var(--amber)':'var(--text2)')+'">'+esc(r.type)+'</span></div></div>';
  h += '<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
  if (r.notes) h += '<div class="swap-message">'+esc(r.notes)+'</div>';
  h += '<div style="font-size:11px;color:var(--text3);margin-top:8px">Submitted '+relTime(r.submittedAt)+' \u00b7 Signed: <em>'+esc(r.digitalSignatureName)+'</em></div>';
  if (r.adminNotes) h += '<div class="swap-message" style="margin-top:8px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);color:var(--amber)">'+esc(r.adminNotes)+'</div>';
  if (adminView && r.status==='PENDING') {
    h += '<div class="swap-actions" style="margin-top:12px">';
    if (r.userId !== state.currentUser.id) {
      h += '<button class="btn btn-success btn-sm" data-id="'+r.id+'" onclick="approveTOBtn(this)">✓ Approve</button>';
      h += '<button class="btn btn-danger btn-sm" data-id="'+r.id+'" onclick="openModal(\'reject-timeoff\',{id:\''+r.id+'\'})">✕ Reject</button>';
    } else {
      h += '<span style="font-size:12px;color:var(--text3);font-style:italic">⚠ Cannot self-approve — assign to another admin</span>';
    }
    h += '</div>';
  }
  h += '</div>'; return h;
}
function approveTOBtn(el) {
  var id = el.getAttribute('data-id'), r = getTOReq(id); if (!r) return;
  if (r.userId === state.currentUser.id) {
    toast('You cannot approve your own time-off request.','error'); return;
  }
  var blocked = DB.shifts.filter(function(s){ return s.employeeId===r.userId && s.date>=r.startDate && s.date<=r.endDate; });
  r.status='APPROVED'; r.reviewedBy=state.currentUser.id; r.reviewedAt=new Date().toISOString(); r.updatedAt=new Date().toISOString();
  addNotif(r.userId,'Time Off Approved','Your time-off from '+r.startDate+' to '+r.endDate+' has been approved.','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'TIMEOFF_APPROVED',entityType:'TimeOffRequest',entityId:id,createdAt:new Date().toISOString()});
  var msg = 'Time-off approved.';
  if (blocked.length) msg += ' Note: '+blocked.length+' shift(s) overlap this period \u2014 review schedule.';
  toast(msg, 'success'); render();
}
function renderCreateTimeOffModal() {
  var u = state.currentUser, today = todayStr();
  var body = '<div class="form-row">';
  body += '<div class="form-group"><label>Start Date *</label><input type="date" id="toStart" value="'+today+'" min="'+today+'"></div>';
  body += '<div class="form-group"><label>End Date *</label><input type="date" id="toEnd" value="'+today+'" min="'+today+'"></div></div>';
  body += '<div class="form-group"><label>Request Type *</label><div style="display:flex;gap:10px;margin-top:6px">';
  body += '<button id="toBtnSick" class="btn btn-amber" style="flex:1;justify-content:center" onclick="setTOType(\'sick\')">\uD83E\uDD12 Sick</button>';
  body += '<button id="toBtnUnpaid" class="btn btn-ghost" style="flex:1;justify-content:center" onclick="setTOType(\'unpaid\')">\uD83D\uDCBC Unpaid</button>';
  body += '</div><input type="hidden" id="toType" value="sick"></div>';
  body += '<div class="form-group"><label>Notes (optional)</label><textarea id="toNotes" placeholder="Additional context..."></textarea></div>';
  body += '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:16px">';
  body += '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Digital Signature</div>';
  body += '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">By typing your full name you confirm this request is accurate and submitted in good faith.</div>';
  body += '<div class="form-group" style="margin-bottom:0"><label>Type your full legal name *</label>';
  body += '<input id="toSig" placeholder="'+esc(u.name)+'" autocomplete="off"></div></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitTimeOff()">Submit Request</button></div>';
  return modalWrap('Request Time Off', body);
}
function setTOType(type) {
  var inp = document.getElementById('toType'); if (inp) inp.value = type;
  var s = document.getElementById('toBtnSick'), u = document.getElementById('toBtnUnpaid');
  if (s) { s.className='btn '+(type==='sick'?'btn-amber':'btn-ghost'); s.style.cssText='flex:1;justify-content:center'; }
  if (u) { u.className='btn '+(type==='unpaid'?'btn-brand':'btn-ghost'); u.style.cssText='flex:1;justify-content:center'; }
}
function submitTimeOff() {
  var u = state.currentUser;
  var start = ((document.getElementById('toStart')||{}).value||'').trim();
  var end   = ((document.getElementById('toEnd')  ||{}).value||'').trim();
  var type  = (document.getElementById('toType')  ||{}).value || 'sick';
  var notes = ((document.getElementById('toNotes') ||{}).value||'').trim();
  var sig   = ((document.getElementById('toSig')   ||{}).value||'').trim();
  if (!start || !end)  { toast('Start and end dates are required.','error'); return; }
  if (end < start)     { toast('End date must be on or after start date.','error'); return; }
  if (!sig)            { toast('Digital signature (your full name) is required.','error'); return; }
  if (sig.toLowerCase() !== u.name.toLowerCase())
    { toast('Signature must match your full name: "'+u.name+'".','error'); return; }
  if (DB.timeOffRequests.some(function(r){ return r.userId===u.id && r.status!=='REJECTED' && r.status!=='CANCELLED' && r.startDate<=end && r.endDate>=start; }))
    { toast('You already have a request for an overlapping period.','error'); return; }
  var req = { id:nextId('to'), userId:u.id, startDate:start, endDate:end, type:type, notes:notes,
               digitalSignatureName:sig, submittedAt:new Date().toISOString(), status:'PENDING',
               reviewedBy:null, reviewedAt:null, adminNotes:'',
               createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  DB.timeOffRequests.push(req);
  DB.users.filter(function(x){ return x.role==='ADMIN'||x.role==='MANAGER'; }).forEach(function(mgr){
    addNotif(mgr.id,'Time-Off Request',u.name+' submitted a '+type+' time-off request ('+start+' to '+end+').','info');
  });
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'TIMEOFF_SUBMITTED',entityType:'TimeOffRequest',entityId:req.id,createdAt:new Date().toISOString()});
  toast('Time-off request submitted.','success'); closeModal();
}
function renderRejectTOModal(id) {
  var r = getTOReq(id), emp = r ? getUser(r.userId) : null; if (!r || !emp) return '';
  var body = '<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px">';
  body += '<div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'\'s request</div>';
  body += '<div style="font-size:13px;color:var(--text2);margin-top:4px">'+fmtDateLabel(r.startDate)+' \u2192 '+fmtDateLabel(r.endDate)+' \u00b7 '+esc(r.type)+'</div>';
  if (r.notes) body += '<div style="font-size:12px;color:var(--text3);margin-top:4px">'+esc(r.notes)+'</div></div>';
  body += '<div class="form-group"><label>Reason for Rejection</label><textarea id="rejectTONotes" placeholder="Explain why..."></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" data-id="'+id+'" onclick="rejectTOSubmit(this)">Reject Request</button></div>';
  return modalWrap('Reject Time-Off Request', body);
}
function rejectTOSubmit(btn) {
  var id = btn.getAttribute('data-id'), r = getTOReq(id); if (!r) return;
  if (r.userId === state.currentUser.id) {
    toast('You cannot reject your own time-off request.','error'); return;
  }
  var notes = ((document.getElementById('rejectTONotes')||{}).value||'').trim();
  r.status='REJECTED'; r.reviewedBy=state.currentUser.id; r.reviewedAt=new Date().toISOString(); r.updatedAt=new Date().toISOString(); r.adminNotes=notes;
  addNotif(r.userId,'Time Off Rejected','Your time-off request was not approved.'+(notes?' Reason: '+notes:''),'info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'TIMEOFF_REJECTED',entityType:'TimeOffRequest',entityId:id,createdAt:new Date().toISOString()});
  toast('Time-off request rejected.','info'); closeModal();
}


// ===================================================================
// OPEN SHIFTS PAGE — Global pool of unassigned shifts
// ===================================================================
function renderOpenShifts() {
  var u = state.currentUser;
  var isMgr = isAdminOrMgr();
  var openList    = DB.openShifts.filter(function(s){return s.status==='OPEN';});
  var pendingList = DB.openShifts.filter(function(s){return s.status==='PENDING';});
  var filledList  = DB.openShifts.filter(function(s){return s.status==='FILLED';});

  var h = '';

  // ── ADMIN: pending approvals ────────────────────────────────────
  if (isMgr && pendingList.length) {
    h += '<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:16px;margin-bottom:24px">';
    h += '<div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:14px">';
    h += '\u26a0\ufe0f '+pendingList.length+' Open Shift'+(pendingList.length!==1?'s':'')+' Awaiting Approval</div>';
    pendingList.forEach(function(os){
      var claimer = getUser(os.claimedBy);
      h += '<div class="v3-card" style="margin-bottom:10px">';
      h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
      h += '<div>';
      h += '<div style="font-weight:600;color:var(--text)">'+fmtDateLabel(os.date)+' \u00b7 '+fmtRange(os.startTime,os.endTime)+'</div>';
      h += '<div style="font-size:12px;color:var(--text2)">'+(os.position?esc(os.position):'Open Role')+'</div>';
      if (claimer) h += '<div style="font-size:12px;color:var(--text2);margin-top:4px">Claimed by <strong>'+esc(claimer.name)+'</strong> \u00b7 Type: '+(os.claimType==='take'?'Taking shift (extra)':'Taking shift + proposing swap')+'</div>';
      h += '</div>';
      h += '<div style="display:flex;gap:8px">';
      h += '<button class="btn btn-success btn-sm" data-osid="'+os.id+'" onclick="approveOpenShift(this)">\u2713 Approve</button>';
      h += '<button class="btn btn-danger btn-sm" data-osid="'+os.id+'" onclick="rejectOpenShift(this)">\u2715 Return to Pool</button>';
      h += '</div></div></div>';
    });
    h += '</div>';
  }

  // ── OPEN POOL ───────────────────────────────────────────────────
  h += '<div class="section-header"><div>';
  h += '<div class="section-title">Open Shifts</div>';
  h += '<div style="font-size:13px;color:var(--text2);margin-top:2px">Available shifts with no assigned employee \u2014 take one to get started</div>';
  h += '</div>';
  if (isMgr) {
    h += '<button class="btn btn-primary" onclick="openModal(\'create-openshift\',{})">+ Post Open Shift</button>';
  }
  h += '</div>';

  if (!openList.length) {
    h += '<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No open shifts available</div><div class="empty-sub">All shifts are currently assigned. Check back later.</div></div>';
  } else {
    h += '<div style="display:grid;gap:12px">';
    openList.forEach(function(os){
      h += '<div class="v3-card">';
      h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">';
      h += '<div>';
      h += '<div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(os.date)+'</div>';
      h += '<div style="font-size:14px;color:var(--text2);margin-top:3px">'+fmtRange(os.startTime,os.endTime)+'</div>';
      if (os.position) h += '<div style="font-size:13px;color:var(--text2);margin-top:3px">'+esc(os.position)+'</div>';
      if (os.notes)    h += '<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCDD '+esc(os.notes)+'</div>';
      h += '</div>';
      // Only employees (and non-self) can claim; managers can remove
      h += '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">';
      // Check if this date conflicts with user's own shifts
      var hasConflict_ = hasConflict(u.id, os.date, os.startTime, os.endTime, null);
      if (!hasConflict_) {
        h += '<button class="btn btn-primary btn-sm" data-osid="'+os.id+'" onclick="openModal(\'claim-openshift\',{id:\''+os.id+'\'})">Take This Shift</button>';
      } else {
        h += '<span style="font-size:11px;color:var(--amber);text-align:center">\u26a0 Scheduling conflict</span>';
      }
      if (isMgr) {
        h += '<button class="btn btn-ghost btn-xs" data-osid="'+os.id+'" onclick="removeOpenShift(this)">Remove</button>';
      }
      h += '</div></div></div>';
    });
    h += '</div>';
  }

  // ── FILLED SHIFTS HISTORY ───────────────────────────────────────
  if (filledList.length) {
    h += '<div style="margin-top:28px"><div class="section-title" style="font-size:14px;margin-bottom:14px">Recently Filled</div>';
    filledList.slice(0,5).forEach(function(os){
      var claimer = getUser(os.claimedBy);
      h += '<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
      h += '<div style="font-size:13px;color:var(--text2)">'+fmtDateLabel(os.date)+' \u00b7 '+fmtRange(os.startTime,os.endTime)+(os.position?' \u00b7 '+esc(os.position):'')+'</div>';
      h += '<div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+(claimer?esc(claimer.avatarColor):'#888')+'">'+esc(claimer?initials(claimer.name):'?')+'</div>';
      h += '<span style="font-size:12px;color:var(--text2)">'+(claimer?esc(claimer.name):'Unknown')+'</span>';
      h += '<span class="badge badge-active">Filled</span></div></div>';
    });
    h += '</div>';
  }

  return h;
}

// ── OPEN SHIFT MODALS ──────────────────────────────────────────────
function renderClaimOpenShiftModal() {
  var m = state.modal; var osId = m && m.data && m.data.id;
  var os = DB.openShifts.find(function(s){return s.id===osId;});
  if (!os) return '';
  var cls = 'color-'+(os.colorTag||'amber');
  var body = '<div class="'+cls+'" style="border-radius:10px;padding:14px;margin-bottom:18px;border:1px solid rgba(255,255,255,.07)">';
  body += '<div style="font-size:15px;font-weight:700">'+fmtDateLabel(os.date)+'</div>';
  body += '<div style="font-size:14px;margin-top:4px">'+fmtRange(os.startTime,os.endTime)+'</div>';
  if (os.position) body += '<div style="font-size:13px;margin-top:3px;opacity:.8">'+esc(os.position)+'</div>';
  if (os.notes)    body += '<div style="font-size:12px;margin-top:6px;opacity:.7">\uD83D\uDCDD '+esc(os.notes)+'</div>';
  body += '</div>';
  body += '<div class="form-group"><label>How would you like to take this shift?</label>';
  body += '<div style="display:flex;gap:10px;margin-top:8px">';
  body += '<button id="claimTakeBtn" class="btn btn-primary" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'take\')">';
  body += '<div style="font-weight:700;margin-bottom:4px">\u2795 Take Shift</div>';
  body += '<div style="font-size:11px;opacity:.7;font-weight:400">Extra work \u2014 no swap needed</div>';
  body += '</button>';
  body += '<button id="claimSwapBtn" class="btn btn-ghost" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'swap\')">';
  body += '<div style="font-weight:700;margin-bottom:4px">\uD83D\uDD04 Take + Swap</div>';
  body += '<div style="font-size:11px;opacity:.7;font-weight:400">Take it and propose to swap one of yours</div>';
  body += '</button>';
  body += '</div><input type="hidden" id="claimType" value="take"></div>';
  body += '<div id="swapShiftSection" style="display:none" class="form-group"><label>Which of your shifts to swap? (optional)</label>';
  body += '<select id="swapShiftId"><option value="">Select a shift to propose swap...</option>';
  var myShifts = DB.shifts.filter(function(s){return s.employeeId===state.currentUser.id && s.date>=todayStr();});
  myShifts.forEach(function(s){ body += '<option value="'+s.id+'">'+fmtDateLabel(s.date)+' '+fmtRange(s.startTime,s.endTime)+(s.position?' - '+s.position:'')+'</option>'; });
  body += '</select></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body += '<button class="btn btn-primary" data-osid="'+osId+'" onclick="submitClaimOpenShift(this)">Submit Claim</button></div>';
  return modalWrap('Claim Open Shift', body);
}
function setClaimType(type) {
  var inp = document.getElementById('claimType'); if(inp) inp.value=type;
  var take = document.getElementById('claimTakeBtn'), swap = document.getElementById('claimSwapBtn');
  var swapSec = document.getElementById('swapShiftSection');
  if(take){ take.className='btn '+(type==='take'?'btn-primary':'btn-ghost'); take.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center'; }
  if(swap){ swap.className='btn '+(type==='swap'?'btn-brand':'btn-ghost'); swap.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center'; }
  if(swapSec) swapSec.style.display = type==='swap' ? 'block' : 'none';
}
function submitClaimOpenShift(btn) {
  var osId = btn.getAttribute('data-osid');
  var os = DB.openShifts.find(function(s){return s.id===osId;});
  if (!os || os.status!=='OPEN') { toast('This shift is no longer available.','error'); return; }
  var type = (document.getElementById('claimType')||{}).value || 'take';
  var swapShiftId = type==='swap' ? ((document.getElementById('swapShiftId')||{}).value||null) : null;
  os.status = 'PENDING';
  os.claimedBy = state.currentUser.id;
  os.claimType = type;
  os.swapShiftId = swapShiftId || null;
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){
    addNotif(mgr.id,'Open Shift Claimed',state.currentUser.name+' wants to take the open shift on '+os.date+' ('+(type==='take'?'extra shift':'with swap proposal')+').','info');
  });
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_CLAIMED',entityType:'OpenShift',entityId:osId,createdAt:new Date().toISOString()});
  toast('Claim submitted! Awaiting manager approval.','success'); closeModal();
}
function approveOpenShift(el) {
  var osId = el.getAttribute('data-osid');
  var os = DB.openShifts.find(function(s){return s.id===osId;});
  if (!os) return;
  // Create a real shift assigned to the claimer
  var newShift = { id:nextId('s'), employeeId:os.claimedBy, createdById:state.currentUser.id,
    date:os.date, startTime:os.startTime, endTime:os.endTime, position:os.position||'',
    notes:os.notes||'', colorTag:os.colorTag||'amber',
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  DB.shifts.push(newShift);
  // If swap type, create a swap request for the related shift
  if (os.claimType==='swap' && os.swapShiftId) {
    var swapSh = getShift(os.swapShiftId);
    if (swapSh) {
      var sw = { id:nextId('sw'), status:'PENDING', requesterId:os.claimedBy, receiverId:null,
        requesterShiftId:os.swapShiftId, receiverShiftId:newShift.id,
        message:'Open shift claim with swap proposal.', adminNotes:'',
        responseMessage:'', responseBy:null, responseAt:null,
        expiresAt:new Date(Date.now()+7*864e5).toISOString(),
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
        reviewedById:null, reviewedAt:null };
      DB.swaps.push(sw);
    }
  }
  os.status = 'FILLED';
  os.approvedBy = state.currentUser.id;
  os.approvedAt = new Date().toISOString();
  addNotif(os.claimedBy,'Open Shift Approved','Your claim for the open shift on '+os.date+' has been approved. It is now on your schedule!','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_APPROVED',entityType:'OpenShift',entityId:osId,createdAt:new Date().toISOString()});
  toast('Open shift approved and assigned to '+getUser(os.claimedBy).name+'.','success'); render();
}
function rejectOpenShift(el) {
  var osId = el.getAttribute('data-osid');
  var os = DB.openShifts.find(function(s){return s.id===osId;});
  if (!os) return;
  var claimer = getUser(os.claimedBy);
  // Return to OPEN pool
  os.status = 'OPEN';
  os.claimedBy = null;
  os.claimType = null;
  os.swapShiftId = null;
  if (claimer) addNotif(claimer.id,'Open Shift Returned','Your claim for the open shift on '+os.date+' was not approved. The shift has returned to the open pool.','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_REJECTED',entityType:'OpenShift',entityId:osId,createdAt:new Date().toISOString()});
  toast('Claim rejected. Shift returned to open pool.','info'); render();
}
function removeOpenShift(el) {
  var osId = el.getAttribute('data-osid');
  if (!confirm('Remove this open shift from the pool?')) return;
  DB.openShifts = DB.openShifts.filter(function(s){return s.id!==osId;});
  toast('Open shift removed.','info'); render();
}
function renderCreateOpenShiftModal() {
  var today = todayStr();
  var body = '<div class="form-row">';
  body += '<div class="form-group"><label>Date *</label><input type="date" id="osDate" value="'+today+'" min="'+today+'"></div>';
  body += '<div class="form-group"><label>Position / Role</label><input id="osPos" placeholder="e.g. Floor Cover"></div></div>';
  body += '<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="osStart" value="09:00"></div>';
  body += '<div class="form-group"><label>End Time *</label><input type="time" id="osEnd" value="17:00"></div></div>';
  body += '<div class="form-group"><label>Color Tag</label>'+colorPickerHtml('amber','osColor')+'</div>';
  body += '<div class="form-group"><label>Notes</label><textarea id="osNotes" placeholder="Details about this shift..."></textarea></div>';
  body += '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createOpenShift()">Post Open Shift</button></div>';
  return modalWrap('Post Open Shift', body);
}
function createOpenShift() {
  var date  = (document.getElementById('osDate') ||{}).value||'';
  var start = (document.getElementById('osStart')||{}).value||'';
  var end   = (document.getElementById('osEnd')  ||{}).value||'';
  var pos   = (document.getElementById('osPos')  ||{}).value||'';
  var notes = (document.getElementById('osNotes')||{}).value||'';
  var color = (document.getElementById('osColor')||{}).value||'amber';
  if (!date) { toast('Date is required.','error'); return; }
  if (!start||!end) { toast('Start and end times are required.','error'); return; }
  if (timeToMins(end)<=timeToMins(start)) { toast('End time must be after start.','error'); return; }
  DB.openShifts.push({id:nextId('os'),date:date,startTime:start,endTime:end,position:pos,
    colorTag:color,notes:notes,createdById:state.currentUser.id,
    createdAt:new Date().toISOString(),status:'OPEN',claimedBy:null,claimType:null,
    swapShiftId:null,approvedBy:null,approvedAt:null});
  DB.users.filter(function(x){return x.role==='EMPLOYEE';}).forEach(function(emp){
    addNotif(emp.id,'New Open Shift','A new open shift is available on '+date+' ('+fmtRange(start,end)+').','info');
  });
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_CREATED',entityType:'OpenShift',entityId:'',createdAt:new Date().toISOString()});
  toast('Open shift posted to pool.','success'); closeModal();
}

// ─── EXPOSE TO WINDOW ────────────────────────────────────────────────
// Only functions called via inline onclick need to be on window.
// All data-attribute handlers (viewShift, editShiftBtn, etc.) are also exposed.
var expose = [
  'navigate','logout','handleLogin','handleRegister',
  'changeWeek','goToday','setView','setSwapFilter',
  'openModal','closeModal','pickColor',
  'handleDayClick','viewShift','editShiftBtn',
  'createShift','updateShift','deleteShiftConfirm',
  'createSwapSubmit','createSwap',
  'setRespondAction','submitRespond',
  'setReviewAction','submitReview',
  'respondSwapBtn','reviewSwapBtn','cancelSwapBtn',
  'createUser','updateUser','updateUserSubmit',
  'toggleStatusBtn','editUserBtn',
  'filterUsers','setAdminTab',
  'toggleNotif','markAllRead','readNotifBtn',
  'saveProfile','savePassword',
  'setAvailTab','approveAvailBtn','availToggle','submitAvailRequest','rejectAvailSubmit',
  'setTOTab','approveTOBtn','setTOType','submitTimeOff','rejectTOSubmit',
  'approveOpenShift','rejectOpenShift','removeOpenShift','submitClaimOpenShift','setClaimType','createOpenShift',
];
var fns = { navigate:navigate, logout:logout, handleLogin:handleLogin, handleRegister:handleRegister,
  changeWeek:changeWeek, goToday:goToday, setView:setView, setSwapFilter:setSwapFilter,
  openModal:openModal, closeModal:closeModal, pickColor:pickColor,
  handleDayClick:handleDayClick, viewShift:viewShift, editShiftBtn:editShiftBtn,
  createShift:createShift, updateShift:updateShift, deleteShiftConfirm:deleteShiftConfirm,
  createSwapSubmit:createSwapSubmit, createSwap:createSwap,
  setRespondAction:setRespondAction, submitRespond:submitRespond,
  setReviewAction:setReviewAction, submitReview:submitReview,
  respondSwapBtn:respondSwapBtn, reviewSwapBtn:reviewSwapBtn, cancelSwapBtn:cancelSwapBtn,
  createUser:createUser, updateUser:updateUser, updateUserSubmit:updateUserSubmit,
  toggleStatusBtn:toggleStatusBtn, editUserBtn:editUserBtn,
  filterUsers:filterUsers, setAdminTab:setAdminTab,
  toggleNotif:toggleNotif, markAllRead:markAllRead, readNotifBtn:readNotifBtn,
  saveProfile:saveProfile, savePassword:savePassword,
  setAvailTab:setAvailTab, approveAvailBtn:approveAvailBtn, availToggle:availToggle,
  submitAvailRequest:submitAvailRequest, rejectAvailSubmit:rejectAvailSubmit,
  setTOTab:setTOTab, approveTOBtn:approveTOBtn, setTOType:setTOType,
  submitTimeOff:submitTimeOff, rejectTOSubmit:rejectTOSubmit,
  approveOpenShift:approveOpenShift, rejectOpenShift:rejectOpenShift, removeOpenShift:removeOpenShift,
  submitClaimOpenShift:submitClaimOpenShift, setClaimType:setClaimType, createOpenShift:createOpenShift,
};
expose.forEach(function(name){ window[name] = fns[name]; });

// ─── BOOT ────────────────────────────────────────────────────────────
render();

})(); // end IIFE
