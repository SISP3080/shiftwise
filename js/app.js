'use strict';
// ═══════════════════════════════════════════════════════════════
// ShiftWise — Complete Client-Side App  (no external deps)
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {

// ─── DATA ───────────────────────────────────────────────────────
var COLORS = ['indigo','green','amber','red','pink','blue','teal','purple'];
var COLOR_HEX = {indigo:'#6366f1',green:'#10b981',amber:'#f59e0b',red:'#ef4444',pink:'#ec4899',blue:'#3b82f6',teal:'#14b8a6',purple:'#a855f7'};
var AV_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#14b8a6','#a855f7','#06b6d4','#84cc16'];

var DB = {
  users: [
    {id:'u1',name:'Alex Rivera',email:'admin@shiftwise.com',password:'Admin1234!',role:'ADMIN',status:'ACTIVE',department:'Management',avatarColor:'#6366f1',createdAt:'2024-01-01T00:00:00Z'},
    {id:'u2',name:'Morgan Chen',email:'manager@shiftwise.com',password:'Manager123!',role:'MANAGER',status:'ACTIVE',department:'Operations',avatarColor:'#10b981',createdAt:'2024-01-15T00:00:00Z'},
    {id:'u3',name:'Jamie Park',email:'jane@shiftwise.com',password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',department:'Front of House',avatarColor:'#f59e0b',createdAt:'2024-02-01T00:00:00Z'},
    {id:'u4',name:'Sam Torres',email:'john@shiftwise.com',password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',department:'Kitchen',avatarColor:'#3b82f6',createdAt:'2024-02-15T00:00:00Z'},
    {id:'u5',name:'Casey Nguyen',email:'sarah@shiftwise.com',password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',department:'Front of House',avatarColor:'#ec4899',createdAt:'2024-03-01T00:00:00Z'},
    {id:'u6',name:'Riley Kim',email:'riley@shiftwise.com',password:'Employee123!',role:'EMPLOYEE',status:'INACTIVE',department:'Bar',avatarColor:'#a855f7',createdAt:'2024-03-15T00:00:00Z'},
  ],
  shifts: [],
  swaps: [],
  notifications: [],
  auditLog: [],
};

// Generate shifts for current week + next week
(function seedShifts() {
  var today = new Date(); today.setHours(0,0,0,0);
  var mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay()+6)%7));
  var templates = [
    {emp:'u3',st:'08:00',et:'16:00',pos:'Front Desk',color:'indigo'},
    {emp:'u3',st:'09:00',et:'17:00',pos:'Front Desk',color:'indigo'},
    {emp:'u3',st:'12:00',et:'20:00',pos:'Closing',color:'purple'},
    {emp:'u4',st:'07:00',et:'15:00',pos:'Kitchen',color:'green'},
    {emp:'u4',st:'11:00',et:'19:00',pos:'Kitchen',color:'green'},
    {emp:'u4',st:'15:00',et:'23:00',pos:'Evening Kitchen',color:'teal'},
    {emp:'u5',st:'09:00',et:'17:00',pos:'Host',color:'pink'},
    {emp:'u5',st:'14:00',et:'22:00',pos:'Server',color:'amber'},
    {emp:'u5',st:'10:00',et:'18:00',pos:'Host',color:'pink'},
  ];
  var dayMap = [0,1,2,3,4,1,2,3,4,0,2,4,1,3,0,2,4,1];
  var id = 1;
  templates.forEach(function(t, i) {
    for (var w = 0; w < 2; w++) {
      var d = new Date(mon); d.setDate(mon.getDate() + dayMap[i % dayMap.length] + w*7);
      if (d >= today || (i % 4 !== 0)) {
        DB.shifts.push({
          id:'s'+(id++),employeeId:t.emp,createdById:'u1',
          date:fmtDate(d),startTime:t.st,endTime:t.et,
          position:t.pos,notes:'',colorTag:t.color,
          createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
        });
      }
    }
  });
  // Add a shift today
  var todayStr = fmtDate(today);
  if (!DB.shifts.find(function(s){return s.date===todayStr&&s.employeeId==='u3';})) {
    DB.shifts.push({id:'s'+(id++),employeeId:'u3',createdById:'u1',date:todayStr,startTime:'09:00',endTime:'17:00',position:'Front Desk',notes:'Opening shift',colorTag:'indigo',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
})();

// Seed a swap request
(function seedSwap() {
  var s3 = DB.shifts.find(function(s){return s.employeeId==='u3';});
  var s4 = DB.shifts.find(function(s){return s.employeeId==='u4'&&s.date>fmtDate(new Date());});
  if (s3 && s4) {
    DB.swaps.push({
      id:'sw1',status:'PENDING',requesterId:'u3',receiverId:'u4',
      requesterShiftId:s3.id,receiverShiftId:s4.id,
      message:"Can we swap? I have a dentist appointment.",
      adminNotes:'',expiresAt:new Date(Date.now()+7*864e5).toISOString(),
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      reviewedById:null,reviewedAt:null
    });
    addNotif('u4','Swap Request','Jamie Park has requested a swap with you.','swap-request');
  }
})();

// ─── STATE ──────────────────────────────────────────────────────
var state = {
  currentUser: null,
  page: 'login',
  modal: null,
  view: 'week',
  weekOffset: 0,
  filterEmployee: 'all',
  swapFilter: 'ALL',
  adminTab: 'users',
  notifOpen: false,
  editId: null,
  searchUser: '',
};

// ─── HELPERS ────────────────────────────────────────────────────
function fmtDate(d) { return d.toISOString().slice(0,10); }
function parseDate(s) { var p=s.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
function todayStr() { return fmtDate(new Date()); }
function timeToMins(t) { var p=t.split(':'); return +p[0]*60+(+p[1]||0); }
function fmtTime(t) { var p=t.split(':'); var h=+p[0]; var m=p[1]; return (h>12?h-12:h===0?12:h)+':'+(m||'00')+(h<12?'am':'pm'); }
function getUser(id) { return DB.users.find(function(u){return u.id===id;}); }
function getShift(id) { return DB.shifts.find(function(s){return s.id===id;}); }
function getSwap(id) { return DB.swaps.find(function(s){return s.id===id;}); }
function initials(name) { return name.split(' ').map(function(n){return n[0];}).slice(0,2).join('').toUpperCase(); }
function isAdmin() { return state.currentUser && (state.currentUser.role==='ADMIN'||state.currentUser.role==='MANAGER'); }
function fmtDateLabel(s) {
  var t=todayStr(); var d=new Date(s+'T00:00:00');
  var t2=new Date(t+'T00:00:00'); var n2=new Date(new Date(t).setDate(new Date(t).getDate()+1));
  if (s===t) return 'Today, '+d.toLocaleDateString('en',{month:'short',day:'numeric'});
  if (fmtDate(n2)===s) return 'Tomorrow, '+d.toLocaleDateString('en',{month:'short',day:'numeric'});
  return d.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
}
function relTime(iso) {
  var diff=(Date.now()-new Date(iso).getTime())/1000;
  if (diff<60) return 'just now';
  if (diff<3600) return Math.floor(diff/60)+'m ago';
  if (diff<86400) return Math.floor(diff/3600)+'h ago';
  return Math.floor(diff/86400)+'d ago';
}
function addNotif(userId, title, message, type) {
  DB.notifications.unshift({id:'n'+Date.now()+'_'+Math.random().toString(36).slice(2),userId:userId,title:title,message:message,type:type||'info',read:false,createdAt:new Date().toISOString()});
}
function shiftsOverlap(s1,e1,s2,e2) { return timeToMins(s1)<timeToMins(e2)&&timeToMins(e1)>timeToMins(s2); }
function hasConflict(empId, date, start, end, excludeId) {
  return DB.shifts.some(function(s){
    return s.employeeId===empId&&s.date===date&&s.id!==excludeId&&shiftsOverlap(start,end,s.startTime,s.endTime);
  });
}
function nextId(prefix) { return prefix+(Date.now()+Math.random().toString(36).slice(2)); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── TOAST ──────────────────────────────────────────────────────
function toast(msg, type) {
  var c=document.getElementById('toast-container'); if(!c)return;
  var t=document.createElement('div');
  t.className='toast toast-'+(type||'info');
  var icons={success:'✓',error:'✕',info:'ℹ'};
  t.innerHTML='<span>'+esc((icons[type]||'ℹ'))+'</span><span>'+esc(msg)+'</span>';
  c.appendChild(t);
  setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(function(){t.remove();},300);},3000);
}

// ─── AUTH ────────────────────────────────────────────────────────
function login(email, pass) {
  var u=DB.users.find(function(x){return x.email.toLowerCase()===email.toLowerCase();});
  if (!u) { toast('No account found with that email','error'); return; }
  if (u.status==='INACTIVE') { toast('This account is inactive','error'); return; }
  if (u.password!==pass) { toast('Incorrect password','error'); return; }
  state.currentUser=u; state.page='dashboard';
  addNotif(u.id,'Signed in','Welcome back, '+u.name.split(' ')[0]+'!','info');
  render();
}
function logout() { state.currentUser=null; state.page='login'; state.notifOpen=false; render(); }
function quickLogin(role) {
  var creds={admin:['admin@shiftwise.com','Admin1234!'],manager:['manager@shiftwise.com','Manager123!'],employee:['jane@shiftwise.com','Employee123!']};
  var p=creds[role]||creds.admin;
  var el=document.getElementById('loginEmail'); var pl=document.getElementById('loginPass');
  if(el)el.value=p[0]; if(pl)pl.value=p[1];
}
function handleLogin() {
  var el=document.getElementById('loginEmail'); var pl=document.getElementById('loginPass');
  if(!el||!pl)return; login(el.value.trim(),pl.value);
}

// ─── NAVIGATION ──────────────────────────────────────────────────
function navigate(page) {
  state.page=page; state.notifOpen=false; render();
}

// ─── WEEK HELPERS ────────────────────────────────────────────────
function getWeekStart(offset) {
  var d=new Date(); d.setHours(0,0,0,0);
  var dow=(d.getDay()+6)%7; // Mon=0
  d.setDate(d.getDate()-dow+(offset||0)*7);
  return d;
}
function getWeekDays(offset) {
  var mon=getWeekStart(offset); var days=[];
  for(var i=0;i<7;i++){var d=new Date(mon);d.setDate(mon.getDate()+i);days.push(d);}
  return days;
}
function weekLabel(offset) {
  var days=getWeekDays(offset);
  var opts={month:'short',day:'numeric'};
  return days[0].toLocaleDateString('en',opts)+' – '+days[6].toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'});
}
function getVisibleShifts() {
  var u=state.currentUser;
  return DB.shifts.filter(function(s){return isAdmin()||s.employeeId===u.id;});
}
function getWeekShifts(offset) {
  var days=getWeekDays(offset).map(fmtDate);
  return getVisibleShifts().filter(function(s){return days.indexOf(s.date)!==-1;});
}

// ─── RENDER ──────────────────────────────────────────────────────
function render() {
  var app=document.getElementById('app'); if(!app)return;
  if (state.page==='login') { app.innerHTML=renderLogin(); bindLogin(); return; }
  if (!state.currentUser) { app.innerHTML=renderLogin(); bindLogin(); return; }
  app.innerHTML='<div class="app">'+renderSidebar()+renderMain()+'</div>';
  if (state.notifOpen) {
    var np=document.createElement('div'); np.innerHTML=renderNotifPanel();
    document.body.appendChild(np.firstChild);
  }
  if (state.modal) {
    var mo=document.createElement('div'); mo.innerHTML=renderModal();
    document.body.appendChild(mo.firstChild);
  }
  bindEvents();
}

// ─── LOGIN ───────────────────────────────────────────────────────
function renderLogin() {
  return '<div class="login-screen"><div class="login-card">'+
    '<div class="login-logo"><div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>'+
    '<div class="login-logo-title">ShiftWise</div><div class="login-subtitle">Employee Schedule Management</div></div>'+
    '<div style="margin-bottom:20px"><div class="role-label">Quick sign in as</div>'+
    '<div class="role-switcher">'+
    '<button class="role-btn" onclick="quickLogin(\'admin\')">Admin</button>'+
    '<button class="role-btn" onclick="quickLogin(\'manager\')">Manager</button>'+
    '<button class="role-btn" onclick="quickLogin(\'employee\')">Employee</button>'+
    '</div></div>'+
    '<div class="form-group"><label>Email</label><input type="email" id="loginEmail" placeholder="you@company.com" value="admin@shiftwise.com"></div>'+
    '<div class="form-group"><label>Password</label><input type="password" id="loginPass" placeholder="••••••••" value="Admin1234!"></div>'+
    '<button class="login-btn" onclick="handleLogin()">Sign In</button>'+
    '<div class="demo-creds"><strong>Demo accounts:</strong><br>'+
    'admin@shiftwise.com / Admin1234!<br>'+
    'manager@shiftwise.com / Manager123!<br>'+
    'jane@shiftwise.com / Employee123!</div>'+
    '</div></div>';
}
function bindLogin() {
  var pl=document.getElementById('loginPass');
  if(pl)pl.addEventListener('keydown',function(e){if(e.key==='Enter')handleLogin();});
}

// ─── SIDEBAR ─────────────────────────────────────────────────────
function renderSidebar() {
  var u=state.currentUser; var isMgr=isAdmin();
  var pages=[
    {id:'dashboard',label:'Dashboard',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>'},
    {id:'schedule',label:'Schedule',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'},
    {id:'swaps',label:'Shift Swaps',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>'},
  ];
  if (isMgr) pages.push({id:'admin',label:'Admin Panel',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'});

  var pendingSwaps=DB.swaps.filter(function(s){return s.status==='PENDING'&&(s.receiverId===u.id||(isMgr&&s.status==='ACCEPTED'));}).length;
  var unread=DB.notifications.filter(function(n){return n.userId===u.id&&!n.read;}).length;

  var html='<aside class="sidebar"><div class="logo"><div class="logo-mark" style="display:flex;align-items:center;justify-content:center">SW</div><span class="logo-text">ShiftWise</span></div>';
  html+='<nav class="nav">';
  pages.forEach(function(p){
    var badge=p.id==='swaps'&&pendingSwaps>0?'<span class="nav-badge">'+pendingSwaps+'</span>':'';
    html+='<div class="nav-item'+(state.page===p.id?' active':'')+'" onclick="navigate(\''+p.id+'\')">'+p.icon+' '+p.label+badge+'</div>';
  });
  html+='</nav>';
  html+='<div class="sidebar-footer"><div class="user-chip" onclick="navigate(\'profile\')">'+
    '<div class="avatar" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>'+
    '<div style="flex:1;min-width:0"><div class="user-name">'+esc(u.name)+'</div><div class="user-role-label">'+esc(u.role.toLowerCase())+'</div></div>'+
    '</div>'+
    '<div class="nav-item" style="margin-top:2px" onclick="logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:16px;height:16px"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign out</div>'+
    '</div></aside>';
  return html;
}

// ─── TOPBAR ───────────────────────────────────────────────────────
function renderTopbar() {
  var u=state.currentUser;
  var unread=DB.notifications.filter(function(n){return n.userId===u.id&&!n.read;}).length;
  var titles={dashboard:'Dashboard',schedule:'Schedule',swaps:'Shift Swaps',admin:'Admin Panel',profile:'Profile'};
  var btns='';
  if (state.page==='schedule'&&isAdmin()) {
    btns='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Shift</button>';
  }
  return '<header class="topbar"><span class="topbar-title">'+(titles[state.page]||'ShiftWise')+'</span>'+btns+
    '<button class="icon-btn" onclick="toggleNotif()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'+(unread>0?'<span class="notif-dot"></span>':'')+'</button>'+
    '</header>';
}

function renderMain() {
  return '<div class="main">'+renderTopbar()+'<div class="content">'+renderPage()+'</div></div>';
}
function renderPage() {
  var pages={dashboard:renderDashboard,schedule:renderSchedule,swaps:renderSwaps,admin:renderAdmin,profile:renderProfile};
  return (pages[state.page]||renderDashboard)();
}

// ─── DASHBOARD ───────────────────────────────────────────────────
function renderDashboard() {
  var u=state.currentUser; var isMgr=isAdmin(); var today=todayStr();
  var myShifts=DB.shifts.filter(function(s){return s.employeeId===u.id;});
  var weekDates=getWeekDays(0).map(fmtDate);
  var weekShifts=isMgr?getWeekShifts(0):myShifts.filter(function(s){return weekDates.indexOf(s.date)!==-1;});
  var todayShifts=isMgr?DB.shifts.filter(function(s){return s.date===today;}):myShifts.filter(function(s){return s.date===today;});
  var pendingSwaps=DB.swaps.filter(function(s){
    return isMgr?['PENDING','ACCEPTED'].indexOf(s.status)!==-1:
      (s.requesterId===u.id||s.receiverId===u.id)&&['PENDING','ACCEPTED'].indexOf(s.status)!==-1;
  });
  var activeEmp=DB.users.filter(function(u){return u.status==='ACTIVE'&&u.role==='EMPLOYEE';}).length;
  var hr=new Date().getHours(); var greet=hr<12?'Good morning':hr<18?'Good afternoon':'Good evening';
  var h='<div style="margin-bottom:24px"><div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--text)">'+greet+', '+esc(u.name.split(' ')[0])+' 👋</div>'+
    '<div style="font-size:13px;color:var(--text2);margin-top:4px">'+new Date().toLocaleDateString('en',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'</div></div>';

  h+='<div class="stat-grid">';
  h+=statCard('Shifts This Week','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',weekShifts.length,'#6366f1','rgba(99,102,241,.12)');
  h+=statCard("Today's Shifts",'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',todayShifts.length,'#10b981','rgba(16,185,129,.12)');
  h+=statCard('Pending Swaps','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',pendingSwaps.length,'#f59e0b','rgba(245,158,11,.12)');
  if (isMgr) {
    h+=statCard('Active Employees','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',activeEmp,'#3b82f6','rgba(59,130,246,.12)');
  } else {
    h+=statCard('My Swaps','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',DB.swaps.filter(function(s){return s.requesterId===u.id||s.receiverId===u.id;}).length,'#a855f7','rgba(168,85,247,.12)');
  }
  h+='</div>';

  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
  // Today's shifts card
  h+='<div class="card"><div class="card-header"><span class="card-title">Today\'s Shifts</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'schedule\')">View all →</button></div><div style="padding:16px">';
  if (!todayShifts.length) h+='<div class="empty-state" style="padding:24px"><div class="empty-icon">📅</div><div class="empty-title">No shifts today</div></div>';
  else todayShifts.forEach(function(s){
    var emp=getUser(s.employeeId); if(!emp)return;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(emp.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+esc(s.startTime)+' – '+esc(s.endTime)+(s.position?' · '+esc(s.position):'')+'</div></div>';
    h+='<span class="badge badge-active" style="font-size:10px">Active</span></div>';
  });
  h+='</div></div>';

  // Pending swaps card
  h+='<div class="card"><div class="card-header"><span class="card-title">Pending Swaps</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'swaps\')">View all →</button></div><div style="padding:16px">';
  if (!pendingSwaps.length) h+='<div class="empty-state" style="padding:24px"><div class="empty-icon">🔄</div><div class="empty-title">No pending swaps</div></div>';
  else pendingSwaps.slice(0,4).forEach(function(sw){
    var req=getUser(sw.requesterId); if(!req)return;
    var rs=getShift(sw.requesterShiftId); if(!rs)return;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+esc(rs.date)+' · '+esc(rs.startTime)+'–'+esc(rs.endTime)+'</div></div>';
    h+='<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';
  });
  h+='</div></div></div>';
  return h;
}
function statCard(label, icon, val, color, bg) {
  return '<div class="stat-card"><div class="stat-icon" style="background:'+bg+';color:'+color+'">'+icon+'</div>'+
    '<div class="stat-value" style="color:'+color+'">'+val+'</div>'+
    '<div class="stat-label">'+label+'</div></div>';
}

// ─── SCHEDULE ────────────────────────────────────────────────────
function renderSchedule() {
  var h='<div class="week-nav">'+
    '<button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">‹ Prev</button>'+
    '<span class="week-label">'+weekLabel(state.weekOffset)+'</span>'+
    '<button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">Next ›</button>'+
    '<button class="btn btn-ghost btn-sm" onclick="state.weekOffset=0;render()">Today</button>'+
    '<div class="view-tabs" style="margin-left:auto">'+
    '<button class="view-tab'+(state.view==='week'?' active':'')+'" onclick="state.view=\'week\';render()">Week</button>'+
    '<button class="view-tab'+(state.view==='list'?' active':'')+'" onclick="state.view=\'list\';render()">List</button>'+
    '</div></div>';
  h+='<div class="card">';
  if (state.view==='week') h+=renderWeekView();
  else h+=renderListView();
  h+='</div>';
  return h;
}
function changeWeek(dir) { state.weekOffset+=dir; render(); }

function renderWeekView() {
  var days=getWeekDays(state.weekOffset); var today=todayStr();
  var HOURS=[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
  var SLOT_H=52; var START_H=6;
  var weekShifts=getWeekShifts(state.weekOffset);

  var h='<div class="cal-wrap"><div style="overflow-x:auto"><div style="min-width:700px">';
  // Header
  h+='<div class="cal-header">';
  h+='<div class="cal-time-head"></div>';
  days.forEach(function(d){
    var ds=fmtDate(d); var isToday=ds===today;
    var dayName=d.toLocaleDateString('en',{weekday:'short'});
    h+='<div class="cal-day-head"><div class="cal-day-name">'+dayName+'</div>'+
      '<div class="cal-day-num'+(isToday?' today':'')+'" onclick="'+(isAdmin()?"openModal('create-shift',{date:'"+ds+"'})":'')+'">'+d.getDate()+'</div></div>';
  });
  h+='</div>';
  // Body
  h+='<div class="cal-body" style="height:'+(HOURS.length*SLOT_H)+'px">';
  // Time col
  h+='<div class="cal-time-col">';
  HOURS.forEach(function(hr){
    var lbl=hr===12?'12pm':hr<12?hr+'am':(hr-12)+'pm';
    h+='<div class="cal-time-slot">'+lbl+'</div>';
  });
  h+='</div>';
  // Day cols
  days.forEach(function(d){
    var ds=fmtDate(d);
    h+='<div class="cal-day-col">';
    HOURS.forEach(function(hr,i){
      h+='<div class="cal-hour-line" style="top:'+(i*SLOT_H)+'px"></div>';
    });
    var dayShifts=weekShifts.filter(function(s){return s.date===ds;});
    dayShifts.forEach(function(s){
      var startMin=timeToMins(s.startTime)-START_H*60;
      var endMin=timeToMins(s.endTime)-START_H*60;
      var top=Math.max(0,startMin*(SLOT_H/60));
      var height=Math.max(20,(endMin-startMin)*(SLOT_H/60)-2);
      var emp=getUser(s.employeeId);
      var cls='color-'+(s.colorTag||'indigo');
      h+='<div class="shift-block '+cls+'" style="top:'+top+'px;height:'+height+'px" onclick="openModal(\'view-shift\',{id:\''+s.id+'\'})">'+
        '<div class="shift-name">'+(isAdmin()?(emp?esc(emp.name):'?'):esc(s.position||'Shift'))+'</div>'+
        '<div class="shift-time">'+esc(s.startTime)+'–'+esc(s.endTime)+'</div></div>';
    });
    h+='</div>';
  });
  h+='</div></div></div></div>';
  return h;
}

function renderListView() {
  var weekDates=getWeekDays(state.weekOffset).map(fmtDate);
  var weekShifts=getWeekShifts(state.weekOffset);
  var grouped={};
  weekDates.forEach(function(d){grouped[d]=[];});
  weekShifts.forEach(function(s){if(grouped[s.date])grouped[s.date].push(s);});
  var h='<div style="padding:16px">';
  var hasAny=false;
  weekDates.forEach(function(d){
    var shifts=grouped[d]; if(!shifts||!shifts.length)return; hasAny=true;
    h+='<div class="list-day-group"><div class="list-day-header">'+fmtDateLabel(d)+'</div>';
    shifts.forEach(function(s){
      var emp=getUser(s.employeeId); if(!emp)return;
      var cls='color-'+(s.colorTag||'indigo');
      // extract color for pill
      var pillColor=COLOR_HEX[s.colorTag||'indigo']||'#6366f1';
      h+='<div class="list-shift-row" onclick="openModal(\'view-shift\',{id:\''+s.id+'\'})">'+
        '<div class="shift-pill" style="background:'+pillColor+'"></div>'+
        (isAdmin()?'<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+';flex-shrink:0">'+esc(initials(emp.name))+'</div>':'')+
        '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+(isAdmin()?esc(emp.name)+' · ':'')+esc(s.startTime)+' – '+esc(s.endTime)+'</div>'+
        (s.position?'<div style="font-size:12px;color:var(--text2)">'+esc(s.position)+'</div>':'')+
        (s.notes?'<div style="font-size:11px;color:var(--text3)">'+esc(s.notes)+'</div>':'')+
        '</div>'+
        (isAdmin()?'<button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();openModal(\'edit-shift\',{id:\''+s.id+'\'})">Edit</button>':'')+'</div>';
    });
    h+='</div>';
  });
  if (!hasAny) h+='<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-title">No shifts this week</div><div class="empty-sub">Try a different week or add some shifts</div></div>';
  h+='</div>'; return h;
}

// ─── SWAPS ───────────────────────────────────────────────────────
function renderSwaps() {
  var u=state.currentUser; var isMgr=isAdmin();
  var tabs=['ALL','PENDING','ACCEPTED','APPROVED','DECLINED','REJECTED','CANCELLED'];
  var allSwaps=DB.swaps.filter(function(s){
    return isMgr||s.requesterId===u.id||s.receiverId===u.id;
  });
  var filtered=state.swapFilter==='ALL'?allSwaps:allSwaps.filter(function(s){return s.status===state.swapFilter;});

  var h='<div class="swap-tabs">';
  tabs.forEach(function(t){
    var cnt=t==='ALL'?allSwaps.length:allSwaps.filter(function(s){return s.status===t;}).length;
    h+='<button class="swap-tab'+(state.swapFilter===t?' active':'')+'" onclick="state.swapFilter=\''+t+'\';render()">'+
      (t==='ALL'?'All':t.charAt(0)+t.slice(1).toLowerCase())+' <span style="opacity:.5;font-size:11px">('+cnt+')</span></button>';
  });
  h+='</div>';

  if (!filtered.length) {
    h+='<div class="empty-state"><div class="empty-icon">🔄</div><div class="empty-title">No swap requests</div><div class="empty-sub">Swap requests will appear here</div></div>';
  } else {
    filtered.forEach(function(sw){h+=renderSwapCard(sw);});
  }
  return h;
}

function renderSwapCard(sw) {
  var u=state.currentUser; var isMgr=isAdmin();
  var req=getUser(sw.requesterId); var rec=sw.receiverId?getUser(sw.receiverId):null;
  var rs=getShift(sw.requesterShiftId); var recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
  if (!req||!rs)return '';
  var canRespond=sw.status==='PENDING'&&sw.receiverId===u.id;
  var canReview=isMgr&&sw.status==='ACCEPTED';
  var canCancel=(sw.requesterId===u.id||isMgr)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;

  var h='<div class="swap-card">';
  // Header
  h+='<div class="swap-header"><div style="display:flex;align-items:center;gap:10px">'+
    '<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>'+
    '<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+(rec?' → '+esc(rec.name):'')+'</div>'+
    '<div class="swap-meta">'+relTime(sw.createdAt)+' · Expires '+new Date(sw.expiresAt).toLocaleDateString('en',{month:'short',day:'numeric'})+'</div></div></div>'+
    '<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';
  // Shifts
  h+='<div class="swap-shifts">'+
    '<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div>'+
    '<div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div>'+
    '<div class="swap-shift-time">'+esc(rs.startTime)+' – '+esc(rs.endTime)+(rs.position?' · '+esc(rs.position):'')+'</div></div>'+
    '<div class="swap-arrow">⇄</div>';
  if (recS) {
    h+='<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div>'+
      '<div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div>'+
      '<div class="swap-shift-time">'+esc(recS.startTime)+' – '+esc(recS.endTime)+(recS.position?' · '+esc(recS.position):'')+'</div></div>';
  } else {
    h+='<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">Open swap</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:4px">'+(rec?'With '+esc(rec.name):'Any employee')+'</div></div>';
  }
  h+='</div>';
  if (sw.message) h+='<div class="swap-message">💬 '+esc(sw.message)+'</div>';
  if (sw.adminNotes) h+='<div class="swap-message" style="border:1px solid rgba(245,158,11,.2);background:rgba(245,158,11,.05);color:var(--amber)">📋 '+esc(sw.adminNotes)+'</div>';
  // Actions
  h+='<div class="swap-actions">';
  if (canRespond) {
    h+='<button class="btn btn-success btn-sm" onclick="openModal(\'respond-swap\',{id:\''+sw.id+'\',action:\'ACCEPT\'})">Accept</button>'+
       '<button class="btn btn-danger btn-sm" onclick="openModal(\'respond-swap\',{id:\''+sw.id+'\',action:\'DECLINE\'})">Decline</button>';
  }
  if (canReview) {
    h+='<button class="btn btn-success btn-sm" onclick="openModal(\'review-swap\',{id:\''+sw.id+'\',action:\'APPROVE\'})">Approve</button>'+
       '<button class="btn btn-danger btn-sm" onclick="openModal(\'review-swap\',{id:\''+sw.id+'\',action:\'REJECT\'})">Reject</button>';
  }
  if (canCancel) h+='<button class="btn btn-ghost btn-sm" onclick="cancelSwap(\''+sw.id+'\')">Cancel</button>';
  h+='</div></div>';
  return h;
}

// ─── ADMIN ───────────────────────────────────────────────────────
function renderAdmin() {
  if (!isAdmin()){return '<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Access restricted</div></div>';}
  var tabs=[{id:'users',label:'Users'},{id:'swaps',label:'Swap Queue'},{id:'audit',label:'Audit Log'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.adminTab===t.id?' active':'')+'" onclick="state.adminTab=\''+t.id+'\';render()">'+t.label+'</button>';});
  h+='</div>';
  if (state.adminTab==='users') h+=renderAdminUsers();
  else if (state.adminTab==='swaps') h+=renderAdminSwaps();
  else h+=renderAuditLog();
  return h;
}

function renderAdminUsers() {
  var sq=state.searchUser.toLowerCase();
  var users=DB.users.filter(function(u){
    return !sq||u.name.toLowerCase().includes(sq)||u.email.toLowerCase().includes(sq)||(u.department||'').toLowerCase().includes(sq);
  });
  var h='<div class="section-header">'+
    '<div><div class="section-title">Users</div><div style="font-size:13px;color:var(--text2);margin-top:2px">'+DB.users.length+' total · '+DB.users.filter(function(u){return u.status==='ACTIVE';}).length+' active</div></div>'+
    '<div style="display:flex;gap:10px">'+
    '<input class="search-input" placeholder="Search users…" value="'+esc(state.searchUser)+'" oninput="state.searchUser=this.value;renderAdminUsersInPlace()" style="width:180px">'+
    '<button class="btn btn-primary btn-sm" onclick="openModal(\'create-user\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add User</button>'+
    '</div></div>';
  h+='<div class="card table-wrap" id="usersTable"><table><thead><tr>'+
    '<th>User</th><th>Role</th><th>Department</th><th>Status</th><th>Actions</th>'+
    '</tr></thead><tbody>';
  users.forEach(function(u){
    h+='<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div><div style="font-weight:600;color:var(--text)">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div></td>'+
      '<td><span class="badge badge-'+u.role.toLowerCase()+'">'+esc(u.role.charAt(0)+u.role.slice(1).toLowerCase())+'</span></td>'+
      '<td>'+(u.department?esc(u.department):'<span style="color:var(--text3)">—</span>')+'</td>'+
      '<td><span class="badge badge-'+u.status.toLowerCase()+'">'+esc(u.status.charAt(0)+u.status.slice(1).toLowerCase())+'</span></td>'+
      '<td><div style="display:flex;gap:6px">'+
      '<button class="btn btn-xs btn-ghost" onclick="openModal(\'edit-user\',{id:\''+u.id+'\'})">Edit</button>'+
      (u.id!==state.currentUser.id?'<button class="btn btn-xs '+(u.status==='ACTIVE'?'btn-danger':'btn-success')+'" onclick="toggleUserStatus(\''+u.id+'\')">'+(u.status==='ACTIVE'?'Deactivate':'Activate')+'</button>':'')+
      '</div></td></tr>';
  });
  h+='</tbody></table></div>';
  return h;
}
function renderAdminUsersInPlace() { var el=document.getElementById('usersTable'); if(el){var tmp=document.createElement('div');tmp.innerHTML=renderAdminUsers();el.parentNode.replaceChild(tmp.firstChild,el);} }

function renderAdminSwaps() {
  var pending=DB.swaps.filter(function(s){return s.status==='ACCEPTED';});
  var h='<div class="section-header"><div class="section-title">Swap Approval Queue</div></div>';
  if (!pending.length) {
    h+='<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">Queue is clear</div><div class="empty-sub">No swaps awaiting review</div></div>';
  } else {
    pending.forEach(function(sw){h+=renderSwapCard(sw);});
  }
  return h;
}

function renderAuditLog() {
  var log=DB.auditLog.slice().reverse().slice(0,50);
  var h='<div class="section-header"><div class="section-title">Audit Log</div></div>';
  if (!log.length) {
    h+='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No activity yet</div></div>';
    return h;
  }
  h+='<div class="card card-p">';
  log.forEach(function(entry){
    var actor=getUser(entry.userId);
    h+='<div class="audit-row"><div class="audit-dot"></div><div style="flex:1"><div class="audit-action">'+esc(entry.action.replace(/_/g,' '))+'</div>'+
      '<div class="audit-detail">'+(actor?esc(actor.name):'System')+(entry.entityType?' · '+esc(entry.entityType):'')+'</div></div>'+
      '<div class="audit-time">'+relTime(entry.createdAt)+'</div></div>';
  });
  h+='</div>';
  return h;
}

// ─── PROFILE ──────────────────────────────────────────────────────
function renderProfile() {
  var u=state.currentUser;
  return '<div class="profile-wrap">'+
    '<div class="profile-header"><div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>'+
    '<div><div class="profile-name">'+esc(u.name)+'</div><div class="profile-email">'+esc(u.email)+'</div>'+
    '<div style="margin-top:8px"><span class="badge badge-'+u.role.toLowerCase()+'">'+u.role+'</span></div></div></div>'+
    '<div class="card card-p">'+
    '<div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Edit Profile</div>'+
    '<div class="form-group"><label>Display Name</label><input id="pName" value="'+esc(u.name)+'"></div>'+
    '<div class="form-group"><label>Email</label><input value="'+esc(u.email)+'" disabled style="opacity:.5;cursor:not-allowed"></div>'+
    (u.department?'<div class="form-group"><label>Department</label><input value="'+esc(u.department)+'" disabled style="opacity:.5;cursor:not-allowed"></div>':'')+
    '<button class="btn btn-primary" onclick="saveProfile()">Save Changes</button>'+
    '</div>'+
    '<div class="card card-p" style="margin-top:16px">'+
    '<div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Change Password</div>'+
    '<div class="form-group"><label>New Password</label><input type="password" id="pNewPw" placeholder="Min 8 characters"></div>'+
    '<div class="form-group"><label>Confirm Password</label><input type="password" id="pConPw" placeholder="Repeat password"></div>'+
    '<button class="btn btn-ghost" onclick="savePassword()">Update Password</button>'+
    '</div></div>';
}
function saveProfile() {
  var el=document.getElementById('pName'); if(!el)return;
  state.currentUser.name=el.value.trim()||state.currentUser.name;
  toast('Profile updated','success');render();
}
function savePassword() {
  var n=document.getElementById('pNewPw'); var c=document.getElementById('pConPw');
  if(!n||!c)return;
  if(n.value.length<8){toast('Password must be at least 8 characters','error');return;}
  if(n.value!==c.value){toast('Passwords do not match','error');return;}
  state.currentUser.password=n.value;
  toast('Password updated','success');
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────
function toggleNotif(){state.notifOpen=!state.notifOpen;render();}
function renderNotifPanel() {
  var u=state.currentUser;
  var notifs=DB.notifications.filter(function(n){return n.userId===u.id;}).slice(0,30);
  var unread=notifs.filter(function(n){return !n.read;}).length;
  return '<div class="notif-panel"><div class="notif-header"><span class="notif-title">Notifications'+(unread>0?' <span style="background:var(--brand-bg);color:var(--brand2);font-size:10px;padding:1px 6px;border-radius:5px;font-weight:700">'+unread+' new</span>':'')+'</span>'+
    (unread>0?'<button class="btn btn-xs btn-ghost" onclick="markAllRead()">Mark all read</button>':'')+
    '</div><div class="notif-list">'+
    (!notifs.length?'<div class="notif-empty">No notifications yet</div>':
      notifs.map(function(n){
        return '<div class="notif-item'+(n.read?'':' unread')+'" onclick="readNotif(\''+n.id+'\')"><div class="notif-dot2" style="opacity:'+(n.read?0:1)+'"></div><div><div class="notif-text-title">'+esc(n.title)+'</div><div class="notif-text-msg">'+esc(n.message)+'</div><div class="notif-time">'+relTime(n.createdAt)+'</div></div></div>';
      }).join(''))+
    '</div></div>';
}
function markAllRead(){var u=state.currentUser;DB.notifications.filter(function(n){return n.userId===u.id;}).forEach(function(n){n.read=true;});render();}
function readNotif(id){var n=DB.notifications.find(function(x){return x.id===id;});if(n)n.read=true;render();}

// ─── MODAL ────────────────────────────────────────────────────────
function openModal(type,data){state.modal={type:type,data:data||{}};render();}
function closeModal(){state.modal=null;render();}
function renderModal() {
  var m=state.modal; if(!m)return '';
  var content='';
  if(m.type==='create-shift')content=renderCreateShiftModal();
  else if(m.type==='edit-shift')content=renderEditShiftModal(m.data.id);
  else if(m.type==='view-shift')content=renderViewShiftModal(m.data.id);
  else if(m.type==='request-swap')content=renderRequestSwapModal(m.data.shiftId);
  else if(m.type==='respond-swap')content=renderRespondSwapModal(m.data.id,m.data.action);
  else if(m.type==='review-swap')content=renderReviewSwapModal(m.data.id,m.data.action);
  else if(m.type==='create-user')content=renderCreateUserModal();
  else if(m.type==='edit-user')content=renderEditUserModal(m.data.id);
  return '<div class="modal-overlay" onclick="if(event.target===this)closeModal()">'+content+'</div>';
}

function colorPicker(selected,name) {
  var h='<div class="color-picker">';
  COLORS.forEach(function(c){
    h+='<div class="color-dot'+(selected===c?' selected':'')+'" style="background:'+COLOR_HEX[c]+'" title="'+c+'" onclick="document.getElementById(\''+name+'\').value=\''+c+'\';this.parentNode.querySelectorAll(\'.color-dot\').forEach(function(d){d.classList.remove(\'selected\')});this.classList.add(\'selected\')"></div>';
  });
  h+='</div><input type="hidden" id="'+name+'" value="'+(selected||'indigo')+'">'; return h;
}

function renderCreateShiftModal() {
  var defaultDate=state.modal.data.date||todayStr();
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var h='<div class="modal"><div class="modal-title">Create Shift</div>'+
    '<div class="form-group"><label>Employee *</label><select id="mEmp"><option value="">Select employee…</option>';
  employees.forEach(function(u){h+='<option value="'+u.id+'">'+esc(u.name)+' ('+esc(u.role.toLowerCase())+')</option>';});
  h+='</select></div>'+
    '<div class="form-row">'+
    '<div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+defaultDate+'"></div>'+
    '<div class="form-group"><label>Position</label><input id="mPos" placeholder="e.g. Front Desk"></div></div>'+
    '<div class="form-row">'+
    '<div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="09:00"></div>'+
    '<div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="17:00"></div></div>'+
    '<div class="form-group"><label>Color Tag</label>'+colorPicker('indigo','mColor')+'</div>'+
    '<div class="form-group"><label>Notes</label><textarea id="mNotes" placeholder="Optional notes…"></textarea></div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="createShift()">Create Shift</button></div></div>';
  return h;
}
function createShift() {
  var emp=document.getElementById('mEmp')?.value;
  var date=document.getElementById('mDate')?.value;
  var start=document.getElementById('mStart')?.value;
  var end=document.getElementById('mEnd')?.value;
  var pos=document.getElementById('mPos')?.value||'';
  var notes=document.getElementById('mNotes')?.value||'';
  var color=document.getElementById('mColor')?.value||'indigo';
  if(!emp){toast('Please select an employee','error');return;}
  if(!date||!start||!end){toast('Date and times are required','error');return;}
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start time','error');return;}
  if(hasConflict(emp,date,start,end,null)){toast('This employee already has a conflicting shift!','error');return;}
  var shift={id:nextId('s'),employeeId:emp,createdById:state.currentUser.id,date:date,startTime:start,endTime:end,position:pos,notes:notes,colorTag:color,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  DB.shifts.push(shift);
  var empUser=getUser(emp); if(empUser) addNotif(emp,'Shift Assigned','You have a new shift on '+date+' from '+start+' to '+end,'shift');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_CREATED',entityType:'Shift',entityId:shift.id,createdAt:new Date().toISOString()});
  toast('Shift created','success');closeModal();
}

function renderEditShiftModal(id) {
  var s=getShift(id); if(!s)return'<div class="modal"><div class="modal-title">Not Found</div><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>';
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var h='<div class="modal"><div class="modal-title">Edit Shift</div>'+
    '<div class="form-group"><label>Employee *</label><select id="mEmp">';
  employees.forEach(function(u){h+='<option value="'+u.id+'"'+(u.id===s.employeeId?' selected':'')+'>'+esc(u.name)+'</option>';});
  h+='</select></div>'+
    '<div class="form-row">'+
    '<div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+s.date+'"></div>'+
    '<div class="form-group"><label>Position</label><input id="mPos" value="'+esc(s.position||'')+'"></div></div>'+
    '<div class="form-row">'+
    '<div class="form-group"><label>Start Time</label><input type="time" id="mStart" value="'+s.startTime+'"></div>'+
    '<div class="form-group"><label>End Time</label><input type="time" id="mEnd" value="'+s.endTime+'"></div></div>'+
    '<div class="form-group"><label>Color</label>'+colorPicker(s.colorTag||'indigo','mColor')+'</div>'+
    '<div class="form-group"><label>Notes</label><textarea id="mNotes">'+esc(s.notes||'')+'</textarea></div>'+
    '<div class="modal-actions">'+
    '<button class="btn btn-danger" onclick="deleteShift(\''+id+'\')">Delete</button>'+
    '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="updateShift(\''+id+'\')">Save</button>'+
    '</div></div>';
  return h;
}
function updateShift(id) {
  var s=getShift(id); if(!s)return;
  var hasSwap=DB.swaps.some(function(sw){return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;});
  if(hasSwap){toast('Cannot edit: this shift has an active swap request','error');return;}
  var emp=document.getElementById('mEmp')?.value||s.employeeId;
  var date=document.getElementById('mDate')?.value||s.date;
  var start=document.getElementById('mStart')?.value||s.startTime;
  var end=document.getElementById('mEnd')?.value||s.endTime;
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start time','error');return;}
  if(hasConflict(emp,date,start,end,id)){toast('Conflicting shift exists!','error');return;}
  s.employeeId=emp;s.date=date;s.startTime=start;s.endTime=end;
  s.position=document.getElementById('mPos')?.value||s.position;
  s.notes=document.getElementById('mNotes')?.value||'';
  s.colorTag=document.getElementById('mColor')?.value||s.colorTag;
  s.updatedAt=new Date().toISOString();
  addNotif(s.employeeId,'Shift Updated','Your shift on '+date+' has been updated.','shift');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_UPDATED',entityType:'Shift',entityId:id,createdAt:new Date().toISOString()});
  toast('Shift updated','success');closeModal();
}
function deleteShift(id) {
  var hasSwap=DB.swaps.some(function(sw){return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;});
  if(hasSwap){toast('Cannot delete: shift has active swap request','error');return;}
  if(!confirm('Delete this shift?'))return;
  var s=getShift(id);
  if(s)addNotif(s.employeeId,'Shift Removed','Your shift on '+s.date+' has been removed.','shift');
  DB.shifts=DB.shifts.filter(function(s){return s.id!==id;});
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SHIFT_DELETED',entityType:'Shift',entityId:id,createdAt:new Date().toISOString()});
  toast('Shift deleted','success');closeModal();
}

function renderViewShiftModal(id) {
  var s=getShift(id); if(!s)return'<div class="modal"><div class="modal-title">Not Found</div><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>';
  var emp=getUser(s.employeeId); var u=state.currentUser; var isMgr=isAdmin();
  var isOwn=s.employeeId===u.id;
  var isPast=s.date<todayStr();
  var hasSwap=DB.swaps.some(function(sw){return (sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;});
  var cls='color-'+(s.colorTag||'indigo');
  return '<div class="modal"><div class="modal-title">Shift Details</div>'+
    '<div class="'+cls+'" style="border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,.06)">'+
    (isMgr&&emp?'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div class="avatar" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div><div style="font-weight:600">'+esc(emp.name)+'</div><div style="font-size:12px;opacity:.7">'+esc(emp.email)+'</div></div></div>':'')+
    '<div style="font-size:15px;font-weight:700">'+fmtDateLabel(s.date)+'</div>'+
    '<div style="font-size:14px;margin-top:4px">'+esc(s.startTime)+' → '+esc(s.endTime)+'</div>'+
    (s.position?'<div style="font-size:13px;margin-top:4px;opacity:.8">'+esc(s.position)+'</div>':'')+
    (s.notes?'<div style="font-size:12px;margin-top:8px;opacity:.7">'+esc(s.notes)+'</div>':'')+
    '</div>'+
    (hasSwap?'<div style="font-size:12px;color:var(--amber);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);border-radius:8px;padding:10px;margin-bottom:16px">⚠️ This shift has an active swap request</div>':'')+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
    (isOwn&&!isPast&&!hasSwap?'<button class="btn btn-brand" onclick="closeModal();openModal(\'request-swap\',{shiftId:\''+id+'\'})">Request Swap</button>':'')+
    (isMgr?'<button class="btn btn-ghost btn-sm" onclick="closeModal();openModal(\'edit-shift\',{id:\''+id+'\'})">Edit</button>':'')+
    '<button class="btn btn-ghost" onclick="closeModal()">Close</button></div></div>';
}

function renderRequestSwapModal(shiftId) {
  var u=state.currentUser;
  var shift=getShift(shiftId);
  if(!shift){return '<div class="modal"><div class="modal-title">Shift not found</div><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>';}
  var employees=DB.users.filter(function(x){return x.status==='ACTIVE'&&x.id!==u.id;});
  var cls='color-'+(shift.colorTag||'indigo');
  return '<div class="modal"><div class="modal-title">Request Shift Swap</div>'+
    '<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Your shift</div>'+
    '<div class="'+cls+'" style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06)">'+
    '<div style="font-weight:600">'+fmtDateLabel(shift.date)+'</div>'+
    '<div style="font-size:13px;opacity:.8">'+esc(shift.startTime)+' – '+esc(shift.endTime)+(shift.position?' · '+esc(shift.position):'')+'</div></div></div>'+
    '<div class="form-group"><label>Swap with (optional — leave blank for open request)</label>'+
    '<select id="swEmp"><option value="">Open swap (any employee)</option>';
  employees.forEach(function(e){return'<option value="'+e.id+'">'+esc(e.name)+'</option>';}).forEach(function(opt){return document.createRange().createContextualFragment(opt);});
  // build inline
  var opts='';employees.forEach(function(e){opts+='<option value="'+e.id+'">'+esc(e.name)+'</option>';});
  return '<div class="modal"><div class="modal-title">Request Shift Swap</div>'+
    '<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text2);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Your shift</div>'+
    '<div class="'+cls+'" style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06)">'+
    '<div style="font-weight:600">'+fmtDateLabel(shift.date)+'</div>'+
    '<div style="font-size:13px;opacity:.8">'+esc(shift.startTime)+' – '+esc(shift.endTime)+(shift.position?' · '+esc(shift.position):'')+'</div></div></div>'+
    '<div class="form-group"><label>Swap with (optional)</label><select id="swEmp"><option value="">Open swap — any employee</option>'+opts+'</select></div>'+
    '<div class="form-group"><label>Message (optional)</label><textarea id="swMsg" placeholder="Reason for swap…"></textarea></div>'+
    '<div style="font-size:12px;color:var(--text3);background:var(--bg3);border-radius:8px;padding:10px;margin-bottom:16px">This swap requires approval from a manager before it takes effect.</div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="createSwap(\''+shiftId+'\')">Send Request</button></div></div>';
}
function createSwap(shiftId) {
  var u=state.currentUser; var shift=getShift(shiftId); if(!shift)return;
  if(shift.date<todayStr()){toast('Cannot swap a past shift','error');return;}
  var dupSwap=DB.swaps.find(function(sw){return (sw.requesterShiftId===shiftId)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;});
  if(dupSwap){toast('This shift already has an active swap request','error');return;}
  var recId=document.getElementById('swEmp')?.value||null;
  var msg=document.getElementById('swMsg')?.value||'';
  var sw={
    id:nextId('sw'),status:'PENDING',requesterId:u.id,receiverId:recId||null,
    requesterShiftId:shiftId,receiverShiftId:null,message:msg,adminNotes:'',
    expiresAt:new Date(Date.now()+7*864e5).toISOString(),
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    reviewedById:null,reviewedAt:null
  };
  DB.swaps.push(sw);
  if(recId){addNotif(recId,'Swap Request',u.name+' has requested a swap with you.','swap');}
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_REQUESTED',entityType:'SwapRequest',entityId:sw.id,createdAt:new Date().toISOString()});
  toast('Swap request sent!','success');closeModal();
}

function renderRespondSwapModal(swapId, defaultAction) {
  var sw=getSwap(swapId); if(!sw)return'';
  var rs=getShift(sw.requesterShiftId); if(!rs)return'';
  var req=getUser(sw.requesterId);
  return '<div class="modal"><div class="modal-title">Respond to Swap Request</div>'+
    '<div style="margin-bottom:16px"><div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Shift to swap</div>'+
    '<div class="color-'+(rs.colorTag||'indigo')+'" style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06)">'+
    '<div style="font-weight:600">'+fmtDateLabel(rs.date)+'</div>'+
    '<div style="font-size:13px;opacity:.8">'+esc(rs.startTime)+' – '+esc(rs.endTime)+'</div>'+
    '<div style="font-size:12px;margin-top:4px;opacity:.7">Requested by '+esc(req?req.name:'?')+(sw.message?' · "'+esc(sw.message)+'"':'')+'</div>'+
    '</div></div>'+
    '<div class="form-group"><label>Your Response</label>'+
    '<div style="display:flex;gap:8px">'+
    '<button id="rBtnA" class="btn '+(defaultAction==='ACCEPT'?'btn-success':'btn-ghost')+' flex:1" style="flex:1;justify-content:center" onclick="document.getElementById(\'rAction\').value=\'ACCEPT\';document.getElementById(\'rBtnA\').className=\'btn btn-success\';document.getElementById(\'rBtnD\').className=\'btn btn-ghost\'">✓ Accept</button>'+
    '<button id="rBtnD" class="btn '+(defaultAction==='DECLINE'?'btn-danger':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="document.getElementById(\'rAction\').value=\'DECLINE\';document.getElementById(\'rBtnD\').className=\'btn btn-danger\';document.getElementById(\'rBtnA\').className=\'btn btn-ghost\'">✕ Decline</button>'+
    '</div><input type="hidden" id="rAction" value="'+defaultAction+'"></div>'+
    '<div class="form-group"><label>Message (optional)</label><textarea id="rMsg" placeholder="Add a note…"></textarea></div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="respondSwap(\''+swapId+'\')">Confirm</button></div></div>';
}
function respondSwap(swapId) {
  var sw=getSwap(swapId); if(!sw)return;
  if(new Date()>new Date(sw.expiresAt)){toast('This swap request has expired','error');return;}
  var action=document.getElementById('rAction')?.value;
  var msg=document.getElementById('rMsg')?.value||'';
  var u=state.currentUser;
  if(action==='ACCEPT'){
    // Check conflict for receiver
    var rs=getShift(sw.requesterShiftId);
    if(rs&&hasConflict(u.id,rs.date,rs.startTime,rs.endTime,sw.receiverShiftId)){
      toast('You have a conflicting shift on that date!','error');return;
    }
    sw.status='ACCEPTED';
    addNotif(sw.requesterId,'Swap Accepted',u.name+' accepted your swap request.','swap');
    // Notify admins
    DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(adm){
      addNotif(adm.id,'Swap Needs Approval','A swap between '+getUser(sw.requesterId)?.name+' and '+u.name+' is awaiting your review.','swap');
    });
  } else {
    sw.status='DECLINED';
    addNotif(sw.requesterId,'Swap Declined',u.name+' declined your swap request.','swap');
  }
  sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action,entityType:'SwapRequest',entityId:swapId,createdAt:new Date().toISOString()});
  toast('Swap '+action.toLowerCase()+'ed','success');closeModal();
}

function renderReviewSwapModal(swapId, defaultAction) {
  var sw=getSwap(swapId); if(!sw)return'';
  var req=getUser(sw.requesterId); var rec=sw.receiverId?getUser(sw.receiverId):null;
  var rs=getShift(sw.requesterShiftId); var recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
  return '<div class="modal modal-lg"><div class="modal-title">Review Swap Request</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'+
    '<div style="background:var(--bg3);border-radius:10px;padding:14px"><div style="font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Requester</div>'+
    '<div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+(req?esc(req.avatarColor):'#666')+'">'+esc(req?initials(req.name):'?')+'</div><span style="font-weight:600">'+(req?esc(req.name):'?')+'</span></div></div>'+
    (rec?'<div style="background:var(--bg3);border-radius:10px;padding:14px"><div style="font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Receiver</div>'+
    '<div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+esc(rec.avatarColor)+'">'+esc(initials(rec.name))+'</div><span style="font-weight:600">'+esc(rec.name)+'</span></div></div>':'<div></div>')+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 32px 1fr;gap:8px;align-items:center;margin-bottom:20px">'+
    (rs?'<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div><div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div><div class="swap-shift-time">'+esc(rs.startTime)+' – '+esc(rs.endTime)+'</div></div>':'<div></div>')+
    '<div style="text-align:center;color:var(--text3);font-size:20px">⇄</div>'+
    (recS?'<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div><div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div><div class="swap-shift-time">'+esc(recS.startTime)+' – '+esc(recS.endTime)+'</div></div>':'<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">No specific shift</div></div>')+
    '</div>'+
    (sw.message?'<div class="swap-message" style="margin-bottom:16px">💬 '+esc(sw.message)+'</div>':'')+
    '<div class="form-group"><label>Decision</label>'+
    '<div style="display:flex;gap:8px">'+
    '<button id="rvA" class="btn '+(defaultAction==='APPROVE'?'btn-success':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="document.getElementById(\'rvAction\').value=\'APPROVE\';document.getElementById(\'rvA\').className=\'btn btn-success\';document.getElementById(\'rvR\').className=\'btn btn-ghost\'">✓ Approve</button>'+
    '<button id="rvR" class="btn '+(defaultAction==='REJECT'?'btn-danger':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="document.getElementById(\'rvAction\').value=\'REJECT\';document.getElementById(\'rvR\').className=\'btn btn-danger\';document.getElementById(\'rvA\').className=\'btn btn-ghost\'">✕ Reject</button>'+
    '</div><input type="hidden" id="rvAction" value="'+defaultAction+'"></div>'+
    '<div class="form-group"><label>Admin Notes (optional)</label><textarea id="rvNotes" placeholder="Reason for decision…"></textarea></div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="reviewSwap(\''+swapId+'\')">Confirm Decision</button></div></div>';
}
function reviewSwap(swapId) {
  var sw=getSwap(swapId); if(!sw)return;
  var action=document.getElementById('rvAction')?.value;
  var notes=document.getElementById('rvNotes')?.value||'';
  var u=state.currentUser;
  if(action==='APPROVE'){
    // Final conflict check
    var rs=getShift(sw.requesterShiftId); var recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
    if(rs&&recS){
      // Swap the employeeIds
      var tempEmp=rs.employeeId; rs.employeeId=recS.employeeId; recS.employeeId=tempEmp;
    } else if(rs&&sw.receiverId){
      // Just assign the shift to receiver (open swap)
      rs.employeeId=sw.receiverId;
    }
    sw.status='APPROVED';
    addNotif(sw.requesterId,'Swap Approved','Your shift swap has been approved!','swap');
    if(sw.receiverId)addNotif(sw.receiverId,'Swap Approved','The shift swap you accepted has been approved!','swap');
  } else {
    sw.status='REJECTED';
    addNotif(sw.requesterId,'Swap Rejected','Your swap request was rejected.'+(notes?' Note: '+notes:''),'swap');
    if(sw.receiverId)addNotif(sw.receiverId,'Swap Rejected','The swap was rejected by management.','swap');
  }
  sw.adminNotes=notes;sw.reviewedById=u.id;sw.reviewedAt=new Date().toISOString();sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action,entityType:'SwapRequest',entityId:swapId,createdAt:new Date().toISOString()});
  toast('Swap '+action.toLowerCase()+'d','success');closeModal();
}

function cancelSwap(swapId) {
  if(!confirm('Cancel this swap request?'))return;
  var sw=getSwap(swapId); if(!sw)return;
  sw.status='CANCELLED';sw.updatedAt=new Date().toISOString();
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SWAP_CANCELLED',entityType:'SwapRequest',entityId:swapId,createdAt:new Date().toISOString()});
  toast('Swap cancelled','info');render();
}

function renderCreateUserModal() {
  return '<div class="modal"><div class="modal-title">Create User</div>'+
    '<div class="form-row"><div class="form-group"><label>Full Name *</label><input id="uName" placeholder="Jane Smith"></div>'+
    '<div class="form-group"><label>Email *</label><input type="email" id="uEmail" placeholder="jane@company.com"></div></div>'+
    '<div class="form-row"><div class="form-group"><label>Password *</label><input type="password" id="uPass" placeholder="Min 8 characters"></div>'+
    '<div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div></div>'+
    '<div class="form-group"><label>Department</label><input id="uDept" placeholder="e.g. Front of House"></div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createUser()">Create User</button></div></div>';
}
function createUser() {
  var name=document.getElementById('uName')?.value.trim();
  var email=document.getElementById('uEmail')?.value.trim();
  var pass=document.getElementById('uPass')?.value;
  var role=document.getElementById('uRole')?.value||'EMPLOYEE';
  var dept=document.getElementById('uDept')?.value||'';
  if(!name||!email||!pass){toast('Name, email and password are required','error');return;}
  if(pass.length<8){toast('Password must be at least 8 characters','error');return;}
  if(DB.users.find(function(u){return u.email.toLowerCase()===email.toLowerCase();})){toast('Email already registered','error');return;}
  var col=AV_COLORS[DB.users.length%AV_COLORS.length];
  var user={id:nextId('u'),name:name,email:email,password:pass,role:role,status:'ACTIVE',department:dept,avatarColor:col,createdAt:new Date().toISOString()};
  DB.users.push(user);
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_CREATED',entityType:'User',entityId:user.id,createdAt:new Date().toISOString()});
  toast('User created','success');closeModal();
}

function renderEditUserModal(id) {
  var u=getUser(id); if(!u)return'';
  return '<div class="modal"><div class="modal-title">Edit User</div>'+
    '<div class="form-row"><div class="form-group"><label>Full Name</label><input id="uName" value="'+esc(u.name)+'"></div>'+
    '<div class="form-group"><label>Email</label><input value="'+esc(u.email)+'" disabled style="opacity:.5;cursor:not-allowed"></div></div>'+
    '<div class="form-row"><div class="form-group"><label>New Password (leave blank to keep)</label><input type="password" id="uPass" placeholder="••••••••"></div>'+
    '<div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE"'+(u.role==='EMPLOYEE'?' selected':'')+'>Employee</option><option value="MANAGER"'+(u.role==='MANAGER'?' selected':'')+'>Manager</option><option value="ADMIN"'+(u.role==='ADMIN'?' selected':'')+'>Admin</option></select></div></div>'+
    '<div class="form-group"><label>Department</label><input id="uDept" value="'+esc(u.department||'')+'"></div>'+
    '<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="updateUser(\''+id+'\')">Save</button></div></div>';
}
function updateUser(id) {
  var u=getUser(id); if(!u)return;
  var name=document.getElementById('uName')?.value.trim();
  var pass=document.getElementById('uPass')?.value;
  var role=document.getElementById('uRole')?.value;
  var dept=document.getElementById('uDept')?.value;
  if(name)u.name=name;
  if(pass){if(pass.length<8){toast('Password min 8 chars','error');return;}u.password=pass;}
  if(role)u.role=role;
  if(dept!==undefined)u.department=dept;
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_UPDATED',entityType:'User',entityId:id,createdAt:new Date().toISOString()});
  toast('User updated','success');closeModal();
}
function toggleUserStatus(id) {
  var u=getUser(id); if(!u)return;
  if(u.id===state.currentUser.id){toast('Cannot deactivate your own account','error');return;}
  if(u.status==='ACTIVE'){
    var upcoming=DB.shifts.filter(function(s){return s.employeeId===id&&s.date>=todayStr();}).length;
    if(upcoming>0){toast('Cannot deactivate: '+upcoming+' upcoming shift(s)','error');return;}
  }
  u.status=u.status==='ACTIVE'?'INACTIVE':'ACTIVE';
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'USER_STATUS_CHANGED',entityType:'User',entityId:id,createdAt:new Date().toISOString()});
  toast('User '+(u.status==='ACTIVE'?'activated':'deactivated'),'info');render();
}

// ─── EVENTS ───────────────────────────────────────────────────────
function bindEvents() {
  document.addEventListener('keydown', function handler(e) {
    if(e.key==='Escape'){
      if(state.modal){closeModal();}
      else if(state.notifOpen){state.notifOpen=false;render();}
      document.removeEventListener('keydown',handler);
    }
  });
}

// ─── EXPOSE GLOBALS ───────────────────────────────────────────────
window.navigate=navigate; window.logout=logout;
window.login=login; window.handleLogin=handleLogin; window.quickLogin=quickLogin;
window.changeWeek=changeWeek;
window.openModal=openModal; window.closeModal=closeModal;
window.createShift=createShift; window.updateShift=updateShift; window.deleteShift=deleteShift;
window.createSwap=createSwap; window.respondSwap=respondSwap; window.reviewSwap=reviewSwap; window.cancelSwap=cancelSwap;
window.createUser=createUser; window.updateUser=updateUser; window.toggleUserStatus=toggleUserStatus;
window.saveProfile=saveProfile; window.savePassword=savePassword;
window.toggleNotif=toggleNotif; window.markAllRead=markAllRead; window.readNotif=readNotif;
window.renderAdminUsersInPlace=renderAdminUsersInPlace;

// ─── START ────────────────────────────────────────────────────────
render();

}); // end DOMContentLoaded
