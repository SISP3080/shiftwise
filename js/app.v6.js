'use strict';
// ===================================================================
// ShiftWise v6.0 — Task-Based Scheduling + Staffing + Communication
// Builds on v4 stable base. New: Task system, Month view, Employee
// schedule toggle, Shift comments, Swap comment threads, Preview
// schedule with publish auth, Settings tab, Open shifts.
// ===================================================================
(function() {

// ─── CONSTANTS ─────────────────────────────────────────────────────
var AV_COLORS  = ['#6366f1','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#14b8a6','#a855f7','#06b6d4','#84cc16'];
var DAYS_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var AVAIL_DAYS  = [
  {idx:1,label:'Monday'},{idx:2,label:'Tuesday'},{idx:3,label:'Wednesday'},
  {idx:4,label:'Thursday'},{idx:5,label:'Friday'},{idx:6,label:'Saturday'},{idx:0,label:'Sunday'}
];

// ─── EARLY UTILITIES ──────────────────────────────────────────────
function now()     { return new Date().toISOString(); }
function fmtDate(d){ return d.toISOString().slice(0,10); }
function todayStr(){ return fmtDate(new Date()); }
function nextId(p) { return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function addNotif(uid,title,msg,type){
  DB.notifications.unshift({id:nextId('n'),userId:uid,title:title,message:msg,type:type||'info',read:false,createdAt:now()});
}

// ─── DATABASE ─────────────────────────────────────────────────────
var DB = {
  users: [
    {id:'u1',name:'Alex Rivera',  email:'admin@shiftwise.com',  password:'Admin1234!', role:'ADMIN',   status:'ACTIVE',  avatarColor:'#6366f1',createdAt:'2024-01-01T00:00:00Z'},
    {id:'u2',name:'Morgan Chen',  email:'manager@shiftwise.com',password:'Manager123!',role:'MANAGER', status:'ACTIVE',  avatarColor:'#10b981',createdAt:'2024-01-15T00:00:00Z'},
    {id:'u3',name:'Jamie Park',   email:'jane@shiftwise.com',   password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',  avatarColor:'#f59e0b',createdAt:'2024-02-01T00:00:00Z'},
    {id:'u4',name:'Sam Torres',   email:'john@shiftwise.com',   password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',  avatarColor:'#3b82f6',createdAt:'2024-02-15T00:00:00Z'},
    {id:'u5',name:'Casey Nguyen', email:'sarah@shiftwise.com',  password:'Employee123!',role:'EMPLOYEE',status:'ACTIVE',  avatarColor:'#ec4899',createdAt:'2024-03-01T00:00:00Z'},
    {id:'u6',name:'Riley Kim',    email:'riley@shiftwise.com',  password:'Employee123!',role:'EMPLOYEE',status:'INACTIVE',avatarColor:'#a855f7',createdAt:'2024-03-15T00:00:00Z'},
  ],
  // v6: tasks[] replace color tags and position fields
  // {id, name, color, description, active}
  tasks: [
    {id:'t1',name:'Skate Guard',    color:'#6366f1',description:'Ice surface supervision and guest safety.',active:true},
    {id:'t2',name:'Skate Rental',   color:'#10b981',description:'Skate fitting, rental, and returns.',active:true},
    {id:'t3',name:'House League',   color:'#f59e0b',description:'Organize and supervise house league games.',active:true},
    {id:'t4',name:'Concessions',    color:'#ef4444',description:'Food and beverage service.',active:true},
    {id:'t5',name:'Facility Ops',   color:'#3b82f6',description:'General facility maintenance and operations.',active:true},
    {id:'t6',name:'Event Staff',    color:'#a855f7',description:'Special events and programming support.',active:false},
  ],
  // v6: shifts now have taskId/taskName/taskColor + employeeComments[]
  // {id,date,startTime,endTime,taskId,taskName,taskColor,notes,employeeComments[],employeeId,createdById}
  shifts: [],
  // v6: previewShifts — isolated from live shifts, same structure
  previewShifts: [],
  swaps:         [],
  notifications: [],
  auditLog:      [],
  availability:     [],
  availRequests:    [],
  timeOffRequests:  [],
  openShifts:       [],
  // v6: settings — admin-controlled system rules
  settings: {
    maxShiftsPerDay:       2,
    minRestHours:          8,
    overlapWarnings:       true,
    openSwapsEnabled:      true,
    swapApprovalRequired:  true,
    swapExpiryDays:        7,
    notifySwaps:           true,
    notifyApprovals:       true,
    notifySchedulePublish: true,
  },
};

// ─── SEED: SHIFTS (v6 task-based) ─────────────────────────────────
(function seedShifts() {
  var today = new Date(); today.setHours(0,0,0,0);
  var dow = (today.getDay()+6)%7;
  var mon = new Date(today); mon.setDate(today.getDate()-dow);
  // {emp, task, st, et, days}
  var tpl = [
    {emp:'u3',task:'t1',st:'08:00',et:'16:00',days:[0,2,4]},
    {emp:'u3',task:'t2',st:'12:00',et:'20:00',days:[1,3]},
    {emp:'u4',task:'t3',st:'07:00',et:'15:00',days:[0,1,2]},
    {emp:'u4',task:'t5',st:'15:00',et:'23:00',days:[3,4]},
    {emp:'u5',task:'t1',st:'09:00',et:'17:00',days:[0,2,3]},
    {emp:'u5',task:'t4',st:'14:00',et:'22:00',days:[1,4]},
  ];
  var id=1;
  tpl.forEach(function(t){
    var task = DB.tasks.find(function(tk){return tk.id===t.task;})||DB.tasks[0];
    [0,1].forEach(function(w){ t.days.forEach(function(d){
      var dt=new Date(mon); dt.setDate(mon.getDate()+d+w*7);
      DB.shifts.push({id:'s'+(id++),employeeId:t.emp,createdById:'u1',
        date:fmtDate(dt),startTime:t.st,endTime:t.et,
        taskId:task.id,taskName:task.name,taskColor:task.color,
        notes:'',employeeComments:[],
        createdAt:now(),updatedAt:now()});
    });});
  });
  var ts=todayStr();
  ['u3','u4'].forEach(function(emp){
    if(!DB.shifts.find(function(s){return s.employeeId===emp&&s.date===ts;})){
      var tk=DB.tasks[0];
      DB.shifts.push({id:'s'+(id++),employeeId:emp,createdById:'u1',date:ts,
        startTime:'09:00',endTime:'17:00',taskId:tk.id,taskName:tk.name,taskColor:tk.color,
        notes:'Check all gates at start of shift.',employeeComments:[],createdAt:now(),updatedAt:now()});
    }
  });
})();

// ─── SEED: SWAP ───────────────────────────────────────────────────
(function seedSwap() {
  var rs = DB.shifts.find(function(s){return s.employeeId==='u3'&&s.date>=todayStr();});
  var recS= DB.shifts.find(function(s){return s.employeeId==='u4'&&s.date>=todayStr()&&(!rs||s.date!==rs.date);});
  if(rs&&recS){
    DB.swaps.push({id:'sw1',status:'PENDING',requesterId:'u3',receiverId:'u4',
      requesterShiftId:rs.id,receiverShiftId:recS.id,
      message:'Can we swap? I have a dentist appointment.',adminNotes:'',
      responseMessage:'',responseBy:null,responseAt:null,
      comments:[{userId:'u3',userName:'Jamie Park',role:'EMPLOYEE',message:'Hope this works for you, Sam!',timestamp:now()}],
      expiresAt:new Date(Date.now()+7*864e5).toISOString(),
      createdAt:now(),updatedAt:now(),reviewedById:null,reviewedAt:null});
    addNotif('u4','Swap Request','Jamie Park requested a shift swap with you.','swap');
  }
})();

// ─── SEED: AVAILABILITY ────────────────────────────────────────────
(function seedAvailability() {
  ['u3','u4','u5'].forEach(function(uid) {
    [1,2,3,4,5].forEach(function(d){DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:true});});
    [0,6].forEach(function(d){DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:false});});
  });
  DB.availRequests.push({id:nextId('avr'),userId:'u3',status:'PENDING',
    notes:'Starting evening classes on Fridays.',reviewedBy:null,reviewedAt:null,
    createdAt:now(),updatedAt:now(),
    proposedAvailability:[
      {dayOfWeek:1,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:2,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:3,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:4,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:5,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:6,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:0,startTime:'08:00',endTime:'22:00',isAvailable:false},
    ]});
  addNotif('u1','Availability Request','Jamie Park submitted an availability change request.','info');
  addNotif('u2','Availability Request','Jamie Park submitted an availability change request.','info');
})();

// ─── SEED: TIME OFF ────────────────────────────────────────────────
(function seedTimeOff() {
  var nw=new Date(); nw.setDate(nw.getDate()+7);
  var nw2=new Date(nw); nw2.setDate(nw.getDate()+2);
  DB.timeOffRequests.push({id:nextId('to'),userId:'u4',
    startDate:fmtDate(nw),endDate:fmtDate(nw2),type:'sick',
    notes:'Scheduled medical procedure.',digitalSignatureName:'Sam Torres',
    submittedAt:now(),status:'PENDING',reviewedBy:null,reviewedAt:null,adminNotes:'',
    createdAt:now(),updatedAt:now()});
  addNotif('u1','Time-Off Request','Sam Torres submitted a time-off request.','info');
  addNotif('u2','Time-Off Request','Sam Torres submitted a time-off request.','info');
})();

// ─── SEED: OPEN SHIFT ─────────────────────────────────────────────
(function seedOpenShift() {
  var tom=new Date(); tom.setDate(tom.getDate()+2); tom.setHours(0,0,0,0);
  var tk=DB.tasks[1];
  DB.openShifts.push({id:nextId('os'),date:fmtDate(tom),startTime:'10:00',endTime:'18:00',
    taskId:tk.id,taskName:tk.name,taskColor:tk.color,
    notes:'Flexible shift, any qualified team member.',
    createdById:'u1',createdAt:now(),
    status:'OPEN',claimedBy:null,claimType:null,swapShiftId:null,
    approvedBy:null,approvedAt:null,
    comments:[]});
})();

// ─── SEED: PREVIEW SHIFTS ─────────────────────────────────────────
(function seedPreview() {
  var next=new Date(); next.setDate(next.getDate()+14); next.setHours(0,0,0,0);
  var dow=(next.getDay()+6)%7;
  var mon=new Date(next); mon.setDate(next.getDate()-dow);
  var tks=[DB.tasks[0],DB.tasks[1],DB.tasks[2]];
  var id=1;
  [['u3',0,'08:00','16:00'],['u4',1,'07:00','15:00'],['u5',2,'09:00','17:00']].forEach(function(r,i){
    var dt=new Date(mon); dt.setDate(mon.getDate()+i);
    var tk=tks[i];
    DB.previewShifts.push({id:'ps'+(id++),employeeId:r[0],createdById:'u1',
      date:fmtDate(dt),startTime:r[2],endTime:r[3],
      taskId:tk.id,taskName:tk.name,taskColor:tk.color,
      notes:'Preview only — not yet published.',employeeComments:[],
      createdAt:now(),updatedAt:now()});
  });
})();


// ─── STATE ────────────────────────────────────────────────────────
var state = {
  currentUser:  null,
  page:         'login',  // login|register|dashboard|schedule|swaps|admin|profile|availability|timeoff|openshift|settings|preview
  modal:        null,
  view:         'week',   // week|list|month
  weekOffset:   0,
  monthOffset:  0,
  filterEmp:    'all',
  scheduleScope:'full',   // v6: full | mine (employee toggle)
  swapFilter:   'ALL',
  adminTab:     'users',
  notifOpen:    false,
  searchUser:   '',
  availTab:     'overview',
  toTab:        'pending',
  openShiftTab: 'open',
  settingsTab:  'tasks',
};

// ─── ESCAPE LISTENER (single instance) ───────────────────────────
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(state.modal){closeModal();return;}
  if(state.notifOpen){state.notifOpen=false;render();return;}
});

// ─── CORE HELPERS ─────────────────────────────────────────────────
function fmt12(t){if(!t)return'';var p=t.split(':'),h=+p[0],m=p[1]||'00';return(h%12||12)+':'+m+' '+(h<12?'AM':'PM');}
function fmtRange(s,e){return fmt12(s)+' \u2013 '+fmt12(e);}
function timeToMins(t){var p=t.split(':');return +p[0]*60+(+p[1]||0);}
function fmtDateLabel(s){
  var t=todayStr(),d=new Date(s+'T00:00:00');
  var tom=new Date();tom.setDate(tom.getDate()+1);
  if(s===t)return'Today, '+MONTHS[d.getMonth()]+' '+d.getDate();
  if(s===fmtDate(tom))return'Tomorrow, '+MONTHS[d.getMonth()]+' '+d.getDate();
  return DAYS_SHORT[d.getDay()]+', '+MONTHS[d.getMonth()]+' '+d.getDate();
}
function relTime(iso){var diff=(Date.now()-new Date(iso).getTime())/1000;if(diff<60)return'just now';if(diff<3600)return Math.floor(diff/60)+'m ago';if(diff<86400)return Math.floor(diff/3600)+'h ago';return Math.floor(diff/86400)+'d ago';}
function getUser(id){return DB.users.find(function(u){return u.id===id;});}
function getShift(id){return DB.shifts.find(function(s){return s.id===id;});}
function getSwap(id){return DB.swaps.find(function(s){return s.id===id;});}
function getAvReq(id){return DB.availRequests.find(function(r){return r.id===id;});}
function getTOReq(id){return DB.timeOffRequests.find(function(r){return r.id===id;});}
function getTask(id){return DB.tasks.find(function(t){return t.id===id;});}
function initials(n){return n.split(' ').map(function(x){return x[0];}).slice(0,2).join('').toUpperCase();}
function isAdminOrMgr(){return state.currentUser&&(state.currentUser.role==='ADMIN'||state.currentUser.role==='MANAGER');}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function validatePassword(pw){if(!pw||pw.length<8)return'Password must be at least 8 characters.';if(!/[A-Z]/.test(pw))return'Must include an uppercase letter.';if(!/[0-9]/.test(pw))return'Must include a number.';return null;}
function validateEmail(em){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);}
function shiftsOverlap(s1,e1,s2,e2){return timeToMins(s1)<timeToMins(e2)&&timeToMins(e1)>timeToMins(s2);}
function hasConflict(eid,date,s,e,excl,shiftsArr){
  var arr=shiftsArr||DB.shifts;
  return arr.some(function(sh){return sh.employeeId===eid&&sh.date===date&&sh.id!==excl&&shiftsOverlap(s,e,sh.startTime,sh.endTime);});
}
function isOnApprovedTimeOff(empId,date){
  return DB.timeOffRequests.some(function(r){return r.userId===empId&&r.status==='APPROVED'&&r.startDate<=date&&r.endDate>=date;});
}
function getUserAvailability(userId){
  return AVAIL_DAYS.map(function(wd){
    return DB.availability.find(function(a){return a.userId===userId&&a.dayOfWeek===wd.idx;})||
           {userId:userId,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false};
  });
}
// v6: role badge HTML
function roleBadgeHtml(role){
  if(role==='ADMIN')   return ' <span class="comment-role-badge badge-admin-role">Admin</span>';
  if(role==='MANAGER') return ' <span class="comment-role-badge badge-manager-role">Manager</span>';
  return '';
}
// v6: task badge HTML
function taskBadgeHtml(taskName,taskColor){
  return '<span class="task-badge" style="background:'+esc(taskColor||'#6366f1')+'">'+
    '<span class="task-dot"></span>'+esc(taskName||'Shift')+'</span>';
}

// ─── TOAST ────────────────────────────────────────────────────────
function toast(msg,type){
  var c=document.getElementById('toast-container');if(!c)return;
  var t=document.createElement('div');
  t.className='toast toast-'+(type||'info');
  t.innerHTML='<span>'+(type==='success'?'\u2713':type==='error'?'\u2715':'\u2139')+'</span><span>'+esc(msg)+'</span>';
  c.appendChild(t);
  setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(function(){if(t.parentNode)t.remove();},320);},3200);
}

// ─── AUTH ─────────────────────────────────────────────────────────
function login(email,pass){
  if(!email||!pass){toast('Please enter your email and password.','error');return;}
  if(!validateEmail(email)){toast('Please enter a valid email address.','error');return;}
  var u=DB.users.find(function(x){return x.email.toLowerCase()===email.toLowerCase();});
  if(!u){toast('No account found with that email.','error');return;}
  if(u.status==='INACTIVE'){toast('This account has been deactivated.','error');return;}
  if(u.password!==pass){toast('Incorrect password.','error');return;}
  state.currentUser=u;state.page='dashboard';
  addNotif(u.id,'Welcome back','Signed in as '+u.name+'.','info');
  render();
}
function handleLogin(){var em=document.getElementById('loginEmail'),pw=document.getElementById('loginPass');if(em&&pw)login(em.value.trim(),pw.value);}
function handleRegister(){
  var name=((document.getElementById('regName')||{}).value||'').trim();
  var email=((document.getElementById('regEmail')||{}).value||'').trim().toLowerCase();
  var pw=(document.getElementById('regPass')||{}).value||'';
  var pw2=(document.getElementById('regPass2')||{}).value||'';
  if(!name){toast('Full name is required.','error');return;}
  if(!validateEmail(email)){toast('Enter a valid email address.','error');return;}
  var pwe=validatePassword(pw);if(pwe){toast(pwe,'error');return;}
  if(pw!==pw2){toast('Passwords do not match.','error');return;}
  if(DB.users.find(function(u){return u.email.toLowerCase()===email;})){toast('Email already registered.','error');return;}
  var col=AV_COLORS[DB.users.length%AV_COLORS.length];
  var user={id:nextId('u'),name:name,email:email,password:pw,role:'EMPLOYEE',status:'ACTIVE',avatarColor:col,createdAt:now()};
  DB.users.push(user);
  AVAIL_DAYS.forEach(function(wd){DB.availability.push({id:nextId('av'),userId:user.id,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false});});
  DB.auditLog.push({id:nextId('a'),userId:user.id,action:'USER_REGISTERED',entityType:'User',entityId:user.id,createdAt:now()});
  state.currentUser=user;state.page='dashboard';
  addNotif(user.id,'Welcome to ShiftWise','Your account has been created.','info');
  toast('Account created! Welcome, '+name.split(' ')[0]+'.','success');render();
}
function logout(){state.currentUser=null;state.page='login';state.notifOpen=false;state.modal=null;render();}
function navigate(page){state.page=page;state.notifOpen=false;state.modal=null;render();}

// ─── WEEK/MONTH HELPERS ───────────────────────────────────────────
function getWeekMon(off){var d=new Date();d.setHours(0,0,0,0);var dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow+(off||0)*7);return d;}
function getWeekDays(off){var m=getWeekMon(off),r=[];for(var i=0;i<7;i++){var d=new Date(m);d.setDate(m.getDate()+i);r.push(d);}return r;}
function weekLabel(off){var d=getWeekDays(off);return MONTHS[d[0].getMonth()]+' '+d[0].getDate()+' \u2013 '+MONTHS[d[6].getMonth()]+' '+d[6].getDate()+', '+d[6].getFullYear();}
function getMonthDays(off){
  var now_=new Date();now_.setHours(0,0,0,0);
  var y=now_.getFullYear(),m=now_.getMonth()+off;
  while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}
  var first=new Date(y,m,1),last=new Date(y,m+1,0);
  var days=[];
  var startDow=(first.getDay()+6)%7; // Mon=0
  for(var i=0;i<startDow;i++){var d=new Date(first);d.setDate(1-startDow+i);days.push({date:d,otherMonth:true});}
  for(var i=1;i<=last.getDate();i++){days.push({date:new Date(y,m,i),otherMonth:false});}
  while(days.length%7!==0){var d2=new Date(days[days.length-1].date);d2.setDate(d2.getDate()+1);days.push({date:d2,otherMonth:true});}
  return {days:days,year:y,month:m};
}
function monthLabel(off){var md=getMonthDays(off);return MONTHS[md.month]+' '+md.year;}
function getVisibleShifts(shiftsArr){
  var u=state.currentUser;
  var arr=shiftsArr||DB.shifts;
  var shifts=isAdminOrMgr()?arr.slice():arr.filter(function(s){return s.employeeId===u.id;});
  if(isAdminOrMgr()&&state.filterEmp!=='all') shifts=shifts.filter(function(s){return s.employeeId===state.filterEmp;});
  // v6: employee schedule scope toggle
  if(!isAdminOrMgr()&&state.scheduleScope==='mine') shifts=shifts.filter(function(s){return s.employeeId===u.id;});
  return shifts;
}
function getWeekShifts(off,shiftsArr){var dates=getWeekDays(off).map(fmtDate);return getVisibleShifts(shiftsArr).filter(function(s){return dates.indexOf(s.date)!==-1;});}

// ─── RENDER CORE ──────────────────────────────────────────────────
function render(){
  var app=document.getElementById('app');if(!app)return;
  if(state.page==='login'){app.innerHTML=renderLogin();var pw=document.getElementById('loginPass');if(pw)pw.onkeydown=function(e){if(e.key==='Enter')handleLogin();};return;}
  if(state.page==='register'){app.innerHTML=renderRegister();var rp=document.getElementById('regPass2');if(rp)rp.onkeydown=function(e){if(e.key==='Enter')handleRegister();};return;}
  if(!state.currentUser){state.page='login';render();return;}
  var html='<div class="app">'+renderSidebar()+renderMain()+'</div>';
  if(state.notifOpen)html+=renderNotifPanel();
  if(state.modal)html+=renderModal();
  app.innerHTML=html;
}

function renderLogin(){
  return '<div class="login-screen"><div class="login-card">'+
    '<div class="login-logo"><div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>'+
    '<div class="login-logo-title">ShiftWise</div><div class="login-subtitle">Task-Based Scheduling Platform</div></div>'+
    '<div class="form-group"><label>Email Address</label><input type="email" id="loginEmail" placeholder="you@company.com" autocomplete="email"></div>'+
    '<div class="form-group"><label>Password</label><input type="password" id="loginPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password"></div>'+
    '<button class="login-btn" onclick="handleLogin()">Sign In</button>'+
    '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">Don\'t have an account? <a href="#" onclick="navigate(\'register\');return false;" style="color:var(--brand2);font-weight:600;">Create account</a></div>'+
    '</div></div>';
}
function renderRegister(){
  return '<div class="login-screen"><div class="login-card" style="max-width:440px">'+
    '<div class="login-logo"><div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>'+
    '<div class="login-logo-title">Create Account</div><div class="login-subtitle">Join your team on ShiftWise</div></div>'+
    '<div class="form-group"><label>Full Name *</label><input id="regName" placeholder="Jane Smith" autocomplete="name"></div>'+
    '<div class="form-group"><label>Email Address *</label><input type="email" id="regEmail" placeholder="you@company.com" autocomplete="email"></div>'+
    '<div class="form-row"><div class="form-group"><label>Password *</label><input type="password" id="regPass" placeholder="Min 8 chars, 1 uppercase, 1 number" autocomplete="new-password"></div>'+
    '<div class="form-group"><label>Confirm *</label><input type="password" id="regPass2" placeholder="Repeat password" autocomplete="new-password"></div></div>'+
    '<button class="login-btn" onclick="handleRegister()">Create Account</button>'+
    '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">Already have an account? <a href="#" onclick="navigate(\'login\');return false;" style="color:var(--brand2);font-weight:600;">Sign in</a></div>'+
    '</div></div>';
}


// ─── SIDEBAR ──────────────────────────────────────────────────────
function renderSidebar(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var pages=[
    {id:'dashboard',   label:'Dashboard',    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>'},
    {id:'schedule',    label:'Schedule',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'},
    {id:'swaps',       label:'Shift Swaps',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>'},
    {id:'openshift',   label:'Open Shifts',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>'},
    {id:'availability',label:'Availability', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'},
    {id:'timeoff',     label:'Time Off',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg>'},
  ];
  if(isMgr){
    pages.push({id:'preview',label:'Preview Schedule',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'});
    pages.push({id:'settings',label:'Settings',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'});
    pages.push({id:'admin',  label:'Admin Panel',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'});
  }
  var swapBadge=DB.swaps.filter(function(s){return s.status==='PENDING'&&s.receiverId===u.id;}).length+(isMgr?DB.swaps.filter(function(s){return s.status==='ACCEPTED';}).length:0);
  var openBadge=DB.openShifts.filter(function(s){return s.status==='OPEN';}).length+(isMgr?DB.openShifts.filter(function(s){return s.status==='PENDING';}).length:0);
  var availBadge=isMgr?DB.availRequests.filter(function(r){return r.status==='PENDING';}).length:0;
  var toBadge=isMgr?DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length:0;
  var prevBadge=isMgr?DB.previewShifts.length:0;
  var html='<aside class="sidebar"><div class="logo"><div class="logo-mark" style="display:flex;align-items:center;justify-content:center">SW</div><span class="logo-text">ShiftWise</span></div><nav class="nav">';
  pages.forEach(function(p){
    var badge='';
    if(p.id==='swaps'&&swapBadge>0)badge='<span class="nav-badge">'+swapBadge+'</span>';
    if(p.id==='openshift'&&openBadge>0)badge='<span class="nav-badge">'+openBadge+'</span>';
    if(p.id==='availability'&&availBadge>0)badge='<span class="nav-badge">'+availBadge+'</span>';
    if(p.id==='timeoff'&&toBadge>0)badge='<span class="nav-badge">'+toBadge+'</span>';
    if(p.id==='preview'&&prevBadge>0)badge='<span class="nav-badge">'+prevBadge+'</span>';
    html+='<div class="nav-item'+(state.page===p.id?' active':'')+'" onclick="navigate(\''+p.id+'\')">'+p.icon+' '+p.label+badge+'</div>';
  });
  html+='</nav><div class="sidebar-footer"><div class="user-chip" onclick="navigate(\'profile\')" title="My Profile"><div class="avatar" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div style="flex:1;min-width:0"><div class="user-name">'+esc(u.name)+'</div><div class="user-role-label">'+esc(u.role.toLowerCase())+'</div></div></div>';
  html+='<div class="nav-item" style="margin-top:2px;color:var(--text3)" onclick="logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign out</div>';
  html+='<div style="font-size:10px;color:var(--text3);text-align:center;padding:6px 0;opacity:.5">ShiftWise v6.0</div>';
  html+='</div></aside>';
  return html;
}

// ─── TOPBAR ───────────────────────────────────────────────────────
function renderTopbar(){
  var u=state.currentUser;
  var unread=DB.notifications.filter(function(n){return n.userId===u.id&&!n.read;}).length;
  var titles={dashboard:'Dashboard',schedule:'Schedule',swaps:'Shift Swaps',admin:'Admin Panel',profile:'Profile',availability:'Availability',timeoff:'Time Off Requests',openshift:'Open Shifts',settings:'Settings',preview:'Preview Schedule'};
  var extra='';
  if(state.page==='schedule'&&state.view==='list'&&isAdminOrMgr())
    extra='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Shift</button>';
  if(state.page==='preview'&&isAdminOrMgr())
    extra='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\',{preview:true})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Preview</button>';
  if(state.page==='timeoff'&&!isAdminOrMgr())
    extra='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-timeoff\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Request Time Off</button>';
  return '<header class="topbar"><span class="topbar-title">'+(titles[state.page]||'ShiftWise')+'</span>'+extra+
    '<button class="icon-btn" onclick="toggleNotif()" aria-label="Notifications"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'+(unread>0?'<span class="notif-dot"></span>':'')+
    '</button></header>';
}
function renderMain(){return'<div class="main">'+renderTopbar()+'<div class="content">'+renderPage()+'</div></div>';}
function renderPage(){
  var map={dashboard:renderDashboard,schedule:renderSchedule,swaps:renderSwaps,admin:renderAdmin,profile:renderProfile,availability:renderAvailability,timeoff:renderTimeOff,openshift:renderOpenShifts,settings:renderSettings,preview:renderPreview};
  return(map[state.page]||renderDashboard)();
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function renderDashboard(){
  var u=state.currentUser,isMgr=isAdminOrMgr(),today=todayStr();
  var allSh=isMgr?DB.shifts:DB.shifts.filter(function(s){return s.employeeId===u.id;});
  var wkD=getWeekDays(0).map(fmtDate);
  var wkSh=allSh.filter(function(s){return wkD.indexOf(s.date)!==-1;});
  var todSh=allSh.filter(function(s){return s.date===today;});
  var pendTO=isMgr?DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length:DB.timeOffRequests.filter(function(r){return r.userId===u.id&&r.status==='PENDING';}).length;
  var openCnt=DB.openShifts.filter(function(s){return s.status==='OPEN';}).length;
  var mySwaps=DB.swaps.filter(function(s){return isMgr?['PENDING','ACCEPTED'].indexOf(s.status)!==-1:(s.requesterId===u.id||s.receiverId===u.id)&&['PENDING','ACCEPTED'].indexOf(s.status)!==-1;});
  var hr=new Date().getHours();var greet=hr<12?'Good morning':hr<18?'Good afternoon':'Good evening';
  var h='<div style="margin-bottom:24px"><div style="font-family:var(--font-display);font-size:22px;font-weight:700">'+greet+', '+esc(u.name.split(' ')[0])+' \uD83D\uDC4B</div>';
  h+='<div style="font-size:13px;color:var(--text2);margin-top:4px">'+new Date().toLocaleDateString('en',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'</div></div>';
  h+='<div class="stat-grid">';
  h+=statCard('Shifts This Week','cal',wkSh.length,'#6366f1','rgba(99,102,241,.12)');
  h+=statCard('Active Swaps','swap',mySwaps.length,'#f59e0b','rgba(245,158,11,.12)');
  h+=statCard('Open Shifts','open',openCnt,'#a855f7','rgba(168,85,247,.12)');
  h+=statCard(isMgr?'Pending Time Off':'My Pending','timeoff',pendTO,'#ec4899','rgba(236,72,153,.12)');
  h+='</div>';
  h+='<div class="dash-grid">';
  // Today shifts
  h+='<div class="card"><div class="card-header"><span class="card-title">Today\'s Shifts</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'schedule\')">View all \u2192</button></div><div style="padding:0 16px 16px">';
  if(!todSh.length)h+='<div class="empty-state" style="padding:24px 0"><div class="empty-icon">\uD83D\uDCC5</div><div class="empty-title">No shifts today</div></div>';
  else todSh.forEach(function(s){
    var emp=getUser(s.employeeId);if(!emp)return;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(emp.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(s.startTime,s.endTime)+'</div>';
    h+=taskBadgeHtml(s.taskName,s.taskColor)+'</div>';
    h+='<span class="badge badge-active">On shift</span></div>';
  });
  h+='</div></div>';
  // Active swaps
  h+='<div class="card"><div class="card-header"><span class="card-title">Active Swaps</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'swaps\')">View all \u2192</button></div><div style="padding:0 16px 16px">';
  if(!mySwaps.length)h+='<div class="empty-state" style="padding:24px 0"><div class="empty-icon">\uD83D\uDD04</div><div class="empty-title">No active swaps</div></div>';
  else mySwaps.slice(0,4).forEach(function(sw){
    var req=getUser(sw.requesterId);if(!req)return;var rs=getShift(sw.requesterShiftId);if(!rs)return;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+esc(rs.date)+' \u00B7 '+fmtRange(rs.startTime,rs.endTime)+'</div></div>';
    h+='<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';
  });
  h+='</div></div></div>';
  return h;
}
function statCard(label,iconKey,val,color,bg){
  var icons={cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',swap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',open:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',timeoff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg>'};
  return'<div class="stat-card"><div class="stat-icon" style="background:'+bg+';color:'+color+'">'+(icons[iconKey]||'')+'</div><div class="stat-value" style="color:'+color+'">'+val+'</div><div class="stat-label">'+label+'</div></div>';
}


// ─── SCHEDULE PAGE (WEEK / LIST / MONTH) ─────────────────────────
function renderSchedule(){
  var isMgr=isAdminOrMgr();
  var h='<div class="week-nav">';
  // Navigation
  if(state.view==='month'){
    h+='<button class="btn btn-ghost btn-sm" onclick="changeMonth(-1)">\u2039 Prev</button>';
    h+='<span class="week-label">'+monthLabel(state.monthOffset)+'</span>';
    h+='<button class="btn btn-ghost btn-sm" onclick="changeMonth(1)">Next \u203A</button>';
    h+='<button class="btn btn-ghost btn-sm" onclick="goToday()">Today</button>';
  } else {
    h+='<button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">\u2039 Prev</button>';
    h+='<span class="week-label">'+weekLabel(state.weekOffset)+'</span>';
    h+='<button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">Next \u203A</button>';
    h+='<button class="btn btn-ghost btn-sm" onclick="goToday()">Today</button>';
  }
  if(isMgr){
    h+='<select class="filter-select" onchange="state.filterEmp=this.value;render()" style="margin-left:8px">';
    h+='<option value="all"'+(state.filterEmp==='all'?' selected':'')+'>All Employees</option>';
    DB.users.filter(function(u){return u.status==='ACTIVE';}).forEach(function(u){h+='<option value="'+u.id+'"'+(state.filterEmp===u.id?' selected':'')+'>'+esc(u.name)+'</option>';});
    h+='</select>';
  } else {
    // v6: Employee schedule scope toggle
    h+='<div class="schedule-toggle" style="margin-left:8px">';
    h+='<button class="schedule-toggle-btn'+(state.scheduleScope==='full'?' active':'')+'" onclick="setScheduleScope(\'full\')">Full Schedule</button>';
    h+='<button class="schedule-toggle-btn'+(state.scheduleScope==='mine'?' active':'')+'" onclick="setScheduleScope(\'mine\')">My Schedule</button>';
    h+='</div>';
  }
  h+='<div class="view-tabs" style="margin-left:auto">';
  h+='<button class="view-tab'+(state.view==='week'?' active':'')+'" onclick="setView(\'week\')">Week</button>';
  h+='<button class="view-tab'+(state.view==='list'?' active':'')+'" onclick="setView(\'list\')">List</button>';
  h+='<button class="view-tab'+(state.view==='month'?' active':'')+'" onclick="setView(\'month\')">Month</button>';
  h+='</div></div>';
  h+='<div class="card">';
  if(state.view==='week'){
    h+='<div style="background:var(--bg3);border-bottom:1px solid var(--border);padding:8px 16px;font-size:11.5px;color:var(--text3);display:flex;align-items:center;gap:6px">';
    h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    h+='Week view is <strong>read-only</strong>. Switch to <button class="btn btn-xs btn-ghost" style="display:inline-flex;margin:0 2px" onclick="setView(\'list\')">List</button> view to create and edit shifts.';
    h+='</div>';
    h+=renderWeekView();
  } else if(state.view==='list'){
    h+=renderListView();
  } else {
    h+=renderMonthView();
  }
  h+='</div>';
  return h;
}
function changeWeek(dir){state.weekOffset+=dir;render();}
function changeMonth(dir){state.monthOffset+=dir;render();}
function goToday(){state.weekOffset=0;state.monthOffset=0;render();}
function setView(v){state.view=v;render();}
function setScheduleScope(s){state.scheduleScope=s;render();}

// ── WEEK VIEW (read-only) ─────────────────────────────────────────
function renderWeekView(shiftsArr){
  var days=getWeekDays(state.weekOffset),today=todayStr();
  var shifts=getWeekShifts(state.weekOffset,shiftsArr);
  var HOURS=[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22],SH=52,isMgr=isAdminOrMgr();
  var h='<div style="overflow-x:auto"><div style="min-width:680px">';
  h+='<div class="cal-header"><div class="cal-time-head"></div>';
  days.forEach(function(d){
    var ds=fmtDate(d),isToday=ds===today;
    h+='<div class="cal-day-head"><div class="cal-day-name">'+DAYS_SHORT[d.getDay()]+'</div>';
    h+='<div class="cal-day-num'+(isToday?' today':'')+'">'+d.getDate()+'</div></div>';
  });
  h+='</div>';
  h+='<div style="display:grid;grid-template-columns:68px repeat(7,1fr);position:relative;height:'+(HOURS.length*SH)+'px"><div>';
  HOURS.forEach(function(hr){h+='<div class="cal-time-slot">'+fmt12(hr+':00')+'</div>';});
  h+='</div>';
  days.forEach(function(d){
    var ds=fmtDate(d);
    h+='<div class="cal-day-col">';
    HOURS.forEach(function(hr,i){h+='<div class="cal-hour-line" style="top:'+(i*SH)+'px"></div>';});
    shifts.filter(function(s){return s.date===ds;}).forEach(function(s){
      var emp=getUser(s.employeeId);
      var sm=timeToMins(s.startTime)-6*60,em=timeToMins(s.endTime)-6*60;
      var top=Math.max(0,sm*(SH/60)),height=Math.max(20,(em-sm)*(SH/60)-2);
      var onTO=isOnApprovedTimeOff(s.employeeId,ds);
      h+='<div style="position:absolute;left:2px;right:2px;top:'+top+'px;height:'+height+'px;border-radius:6px;padding:4px 6px;overflow:hidden;cursor:default;background:'+esc(s.taskColor||'#6366f1')+(onTO?';opacity:.4':'')+'"';
      h+=' title="'+esc(s.taskName||'Shift')+' \u00B7 '+fmtRange(s.startTime,s.endTime)+'">';
      h+='<div style="font-size:10px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(isMgr&&emp?esc(emp.name):esc(s.taskName||'Shift'))+'</div>';
      h+='<div style="font-size:9px;color:rgba(255,255,255,.8)">'+fmtRange(s.startTime,s.endTime)+'</div>';
      if(onTO)h+='<div style="font-size:8px;color:#fff;opacity:.8">\u26d4 Time Off</div>';
      h+='</div>';
    });
    h+='</div>';
  });
  h+='</div></div></div>';
  return h;
}

// ── LIST VIEW (editable) ──────────────────────────────────────────
function renderListView(shiftsArr){
  var dates=getWeekDays(state.weekOffset).map(fmtDate);
  var shifts=getWeekShifts(state.weekOffset,shiftsArr),isMgr=isAdminOrMgr();
  var byDay={};dates.forEach(function(d){byDay[d]=[];});
  shifts.forEach(function(s){if(byDay[s.date])byDay[s.date].push(s);});
  var h='<div style="padding:16px">',hasAny=false;
  dates.forEach(function(d){
    var ds=byDay[d];if(!ds||!ds.length)return;hasAny=true;
    h+='<div class="list-day-group"><div class="list-day-header">'+fmtDateLabel(d)+'</div>';
    ds.forEach(function(s){
      var emp=getUser(s.employeeId);if(!emp)return;
      var onTO=isOnApprovedTimeOff(s.employeeId,d);
      h+='<div class="list-shift-row'+(onTO?' list-shift-to':'')+'" data-id="'+s.id+'" onclick="viewShift(this)">';
      h+='<div class="shift-pill" style="background:'+esc(s.taskColor||'#6366f1')+'"></div>';
      if(isMgr)h+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+';flex-shrink:0">'+esc(initials(emp.name))+'</div>';
      h+='<div style="flex:1">';
      h+='<div style="font-size:13px;font-weight:600;color:var(--text)">'+(isMgr?esc(emp.name)+' \u00B7 ':'')+fmtRange(s.startTime,s.endTime)+'</div>';
      h+='<div class="list-shift-tasks">'+taskBadgeHtml(s.taskName,s.taskColor)+'</div>';
      if(s.notes)h+='<div style="font-size:11px;color:var(--text3);margin-top:2px">\uD83D\uDCCB '+esc(s.notes)+'</div>';
      if(onTO)h+='<div style="font-size:11px;color:var(--amber)">\u26A0 Approved time off this day</div>';
      if(s.employeeComments&&s.employeeComments.length)h+='<div style="font-size:11px;color:var(--text3);margin-top:2px">\uD83D\uDCAC '+s.employeeComments.length+' comment'+(s.employeeComments.length!==1?'s':'')+'</div>';
      h+='</div>';
      if(isMgr)h+='<button class="btn btn-xs btn-ghost" data-id="'+s.id+'" onclick="editShiftBtn(event,this)">Edit</button>';
      h+='</div>';
    });
    h+='</div>';
  });
  if(!hasAny)h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDCC5</div><div class="empty-title">No shifts this week</div><div class="empty-sub">Navigate to another week or add shifts in the schedule</div></div>';
  h+='</div>';return h;
}

// ── MONTH VIEW (read-only staffing overview) ─────────────────────
function renderMonthView(){
  var md=getMonthDays(state.monthOffset);
  var today=todayStr();
  var allShifts=getVisibleShifts();
  var h='<div style="padding:12px">';
  h+='<div class="month-grid">';
  // Day headers
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(d){h+='<div class="month-day-head">'+d+'</div>';});
  md.days.forEach(function(cell){
    var ds=fmtDate(cell.date);
    var isToday=ds===today;
    var dayShifts=allShifts.filter(function(s){return s.date===ds;});
    // Aggregate by task
    var taskCounts={};
    dayShifts.forEach(function(s){
      var k=s.taskId||'other';
      if(!taskCounts[k])taskCounts[k]={name:s.taskName||'Shift',color:s.taskColor||'#888',count:0};
      taskCounts[k].count++;
    });
    var taskKeys=Object.keys(taskCounts);
    h+='<div class="month-cell'+(cell.otherMonth?' other-month':'')+(isToday?' today':'')+'">';
    h+='<div class="month-date-num'+(isToday?' today':'')+'">'+cell.date.getDate()+'</div>';
    taskKeys.slice(0,3).forEach(function(k){
      var tc=taskCounts[k];
      h+='<div class="month-task-pill" style="background:'+esc(tc.color)+'">'+tc.count+' '+esc(tc.name)+'</div>';
    });
    if(taskKeys.length>3)h+='<div class="month-more">+'+( taskKeys.length-3)+' more</div>';
    h+='</div>';
  });
  h+='</div>';
  // Legend
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;padding:0 4px">';
  activeTasks.forEach(function(t){h+='<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:50%;background:'+esc(t.color)+';flex-shrink:0"></div>'+esc(t.name)+'</div>';});
  h+='</div></div>';
  return h;
}

function viewShift(el){openModal('view-shift',{id:el.getAttribute('data-id')||''});}
function editShiftBtn(evt,el){evt.stopPropagation();openModal('edit-shift',{id:el.getAttribute('data-id')||''});}


// ─── PREVIEW SCHEDULE ─────────────────────────────────────────────
function renderPreview(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var h='';
  h+='<div class="preview-banner">';
  h+='<div><div class="preview-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview Mode</div>';
  h+='<div class="preview-count">'+DB.previewShifts.length+' preview shift'+(DB.previewShifts.length!==1?'s':'')+' staged \u2014 not visible to employees</div></div>';
  h+='<button class="btn btn-primary" onclick="openModal(\'publish-schedule\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Publish Schedule</button>';
  h+='</div>';
  // Show preview shifts in week view and list view
  h+='<div class="week-nav" style="margin-bottom:0">';
  h+='<button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">\u2039 Prev</button>';
  h+='<span class="week-label">'+weekLabel(state.weekOffset)+'</span>';
  h+='<button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">Next \u203A</button>';
  h+='<button class="btn btn-ghost btn-sm" onclick="goToday()">Today</button>';
  h+='<div class="view-tabs" style="margin-left:auto">';
  h+='<button class="view-tab'+(state.view==='week'?' active':'')+'" onclick="setView(\'week\')">Week</button>';
  h+='<button class="view-tab'+(state.view==='list'?' active':'')+'" onclick="setView(\'list\')">List</button>';
  h+='</div></div>';
  h+='<div class="card" style="border:2px dashed rgba(245,158,11,.3)">';
  if(DB.previewShifts.length===0){
    h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><div class="empty-title">No preview shifts</div><div class="empty-sub">Use "Add to Preview" to stage shifts before publishing</div></div>';
  } else if(state.view==='week'){
    h+=renderWeekView(DB.previewShifts);
  } else {
    h+=renderListView(DB.previewShifts);
  }
  h+='</div>';
  return h;
}

// ─── SETTINGS ─────────────────────────────────────────────────────
function renderSettings(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var tabs=[{id:'tasks',label:'Task Management'},{id:'scheduling',label:'Scheduling Rules'},{id:'swaps',label:'Swap Rules'},{id:'notifications',label:'Notifications'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.settingsTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setSettingsTab(this)">'+t.label+'</button>';});
  h+='</div>';
  if(state.settingsTab==='tasks')h+=renderSettingsTasks();
  else if(state.settingsTab==='scheduling')h+=renderSettingsScheduling();
  else if(state.settingsTab==='swaps')h+=renderSettingsSwaps();
  else h+=renderSettingsNotifications();
  return h;
}
function setSettingsTab(el){state.settingsTab=el.getAttribute('data-tab')||'tasks';render();}

function renderSettingsTasks(){
  var h='<div class="section-header"><div class="section-title">Task Management</div><button class="btn btn-primary" onclick="openModal(\'create-task\',{})">+ New Task</button></div>';
  h+='<div class="settings-section"><div class="settings-section-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Active Tasks</div><div class="settings-section-body">';
  DB.tasks.forEach(function(t){
    h+='<div class="task-item'+(t.active?'':' task-inactive')+'">';
    h+='<div class="task-color-swatch" style="background:'+esc(t.color)+'"></div>';
    h+='<div style="flex:1"><div class="task-name">'+esc(t.name)+'</div><div class="task-desc">'+esc(t.description||'')+'</div></div>';
    h+='<span class="badge badge-'+(t.active?'active':'inactive')+'" style="flex-shrink:0">'+(t.active?'Active':'Inactive')+'</span>';
    h+='<button class="btn btn-xs btn-ghost" data-tid="'+t.id+'" onclick="openModal(\'edit-task\',{id:\''+t.id+'\'})">Edit</button>';
    h+='<button class="btn btn-xs btn-ghost" data-tid="'+t.id+'" onclick="toggleTaskActive(this)">'+(t.active?'Deactivate':'Activate')+'</button>';
    h+='</div>';
  });
  h+='</div></div>';
  return h;
}
function toggleTaskActive(el){
  var id=el.getAttribute('data-tid'),t=getTask(id);if(!t)return;
  t.active=!t.active;toast('Task '+(t.active?'activated':'deactivated')+'.','success');render();
}
function renderSettingsScheduling(){
  var s=DB.settings;
  var h='<div class="settings-section"><div class="settings-section-header">Scheduling Rules</div><div class="settings-section-body">';
  h+=settingRowNum('Max shifts per employee per day','maxShiftsPerDay','Prevents over-scheduling on the same day',s.maxShiftsPerDay);
  h+=settingRowNum('Minimum rest between shifts (hours)','minRestHours','Enforces minimum break between consecutive shifts',s.minRestHours);
  h+=settingRowToggle('Show overlap warnings','overlapWarnings','Display warnings when shifts conflict',s.overlapWarnings);
  h+='</div></div>';
  return h;
}
function renderSettingsSwaps(){
  var s=DB.settings;
  var h='<div class="settings-section"><div class="settings-section-header">Swap Rules</div><div class="settings-section-body">';
  h+=settingRowToggle('Open swaps enabled','openSwapsEnabled','Allow employees to post shifts to the open pool',s.openSwapsEnabled);
  h+=settingRowToggle('Require admin approval','swapApprovalRequired','All swaps must be approved by a manager or admin',s.swapApprovalRequired);
  h+=settingRowNum('Swap request expiry (days)','swapExpiryDays','How many days before a swap request expires automatically',s.swapExpiryDays);
  h+='</div></div>';
  return h;
}
function renderSettingsNotifications(){
  var s=DB.settings;
  var h='<div class="settings-section"><div class="settings-section-header">Notification Preferences (UI Only)</div><div class="settings-section-body">';
  h+=settingRowToggle('Swap notifications','notifySwaps','Receive in-app alerts for swap requests',s.notifySwaps);
  h+=settingRowToggle('Approval notifications','notifyApprovals','Receive alerts when requests are approved or rejected',s.notifyApprovals);
  h+=settingRowToggle('Schedule publish alerts','notifySchedulePublish','Receive alerts when the schedule is published',s.notifySchedulePublish);
  h+='<div style="font-size:11.5px;color:var(--text3);margin-top:12px;background:var(--bg3);border-radius:8px;padding:10px">\uD83D\uDCA1 These are UI preference toggles. Email/push integrations are not yet connected.</div>';
  h+='</div></div>';
  return h;
}
function settingRowToggle(label,key,desc,val){
  return '<div class="setting-row"><div><div class="setting-label">'+label+'</div><div class="setting-desc">'+desc+'</div></div>'+
    '<label class="toggle-switch"><input type="checkbox" '+(val?'checked':'')+' onchange="toggleSetting(\''+key+'\',this.checked)"><span class="toggle-slider"></span></label></div>';
}
function settingRowNum(label,key,desc,val){
  return '<div class="setting-row"><div><div class="setting-label">'+label+'</div><div class="setting-desc">'+desc+'</div></div>'+
    '<input type="number" value="'+val+'" min="1" max="24" style="width:70px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:13px;text-align:center" onchange="setSettingNum(\''+key+'\',+this.value)"></div>';
}
function toggleSetting(key,val){DB.settings[key]=val;toast('Setting updated.','success');}
function setSettingNum(key,val){if(val>0)DB.settings[key]=val;toast('Setting updated.','success');}


// ─── SWAPS ────────────────────────────────────────────────────────
function renderSwaps(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var tabs=['ALL','PENDING','ACCEPTED','APPROVED','DECLINED','REJECTED','CANCELLED'];
  var all=DB.swaps.filter(function(s){return isMgr||s.requesterId===u.id||s.receiverId===u.id;});
  var shown=state.swapFilter==='ALL'?all:all.filter(function(s){return s.status===state.swapFilter;});
  var h='<div class="swap-tabs">';
  tabs.forEach(function(t){var cnt=t==='ALL'?all.length:all.filter(function(s){return s.status===t;}).length;h+='<button class="swap-tab'+(state.swapFilter===t?' active':'')+'" data-tab="'+t+'" onclick="setSwapFilter(this)">'+(t==='ALL'?'All':t.charAt(0)+t.slice(1).toLowerCase())+(cnt>0?' <span style="opacity:.5;font-size:10px">('+cnt+')</span>':'')+' </button>';});
  h+='</div>';
  if(!shown.length)h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDD04</div><div class="empty-title">No swap requests</div></div>';
  else shown.forEach(function(sw){h+=renderSwapCard(sw);});
  return h;
}
function setSwapFilter(el){state.swapFilter=el.getAttribute('data-tab')||'ALL';render();}

function renderSwapCard(sw){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var req=getUser(sw.requesterId),rec=sw.receiverId?getUser(sw.receiverId):null;
  var rs=getShift(sw.requesterShiftId),recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
  if(!req||!rs)return'';
  var expired=new Date()>new Date(sw.expiresAt);
  var canRespond=sw.status==='PENDING'&&sw.receiverId===u.id&&!expired;
  var canReview=isMgr&&sw.status==='ACCEPTED';
  var canCancel=(sw.requesterId===u.id||isMgr)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;
  var h='<div class="swap-card">';
  h+='<div class="swap-header"><div style="display:flex;align-items:center;gap:10px">';
  h+='<div class="avatar avatar-sm" style="background:'+esc(req.avatarColor)+'">'+esc(initials(req.name))+'</div>';
  h+='<div><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(req.name)+(rec?' \u2192 '+esc(rec.name):'')+'</div>';
  h+='<div class="swap-meta">'+relTime(sw.createdAt)+' \u00B7 Expires '+new Date(sw.expiresAt).toLocaleDateString('en',{month:'short',day:'numeric'})+(expired?' (EXPIRED)':'')+'</div></div></div>';
  h+='<span class="badge badge-'+sw.status.toLowerCase()+'">'+sw.status.charAt(0)+sw.status.slice(1).toLowerCase()+'</span></div>';
  h+='<div class="swap-shifts">';
  h+='<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div><div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div>';
  h+='<div class="swap-shift-time">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
  h+='<div style="margin-top:4px">'+taskBadgeHtml(rs.taskName,rs.taskColor)+'</div></div>';
  h+='<div class="swap-arrow">\u21C4</div>';
  if(recS){h+='<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div><div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div><div class="swap-shift-time">'+fmtRange(recS.startTime,recS.endTime)+'</div><div style="margin-top:4px">'+taskBadgeHtml(recS.taskName,recS.taskColor)+'</div></div>';}
  else{h+='<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">Open swap</div><div style="font-size:12px;color:var(--text3);margin-top:4px">'+(rec?'With '+esc(rec.name):'Any employee')+'</div></div>';}
  h+='</div>';
  if(sw.message)h+='<div class="swap-message">\uD83D\uDCAC '+esc(sw.message)+'</div>';
  if(sw.responseMessage){var respUser=getUser(sw.responseBy);h+='<div class="swap-message" style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15)">\uD83D\uDCAC <strong>'+(respUser?esc(respUser.name):'Receiver')+'</strong> replied: '+esc(sw.responseMessage)+'</div>';}
  if(sw.adminNotes)h+='<div class="swap-message" style="background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);color:var(--amber)">\uD83D\uDCCB Admin: '+esc(sw.adminNotes)+'</div>';
  // v6: comment thread
  if(sw.comments&&sw.comments.length){
    h+='<div class="swap-comment-section"><div class="swap-comment-title">Thread</div>';
    sw.comments.forEach(function(c){
      var cu=getUser(c.userId);
      h+='<div class="comment-item" style="margin-bottom:8px">';
      h+='<div class="avatar avatar-sm" style="background:'+(cu?esc(cu.avatarColor):'#888')+'">'+(cu?esc(initials(cu.name)):'?')+'</div>';
      h+='<div class="comment-bubble"><div class="comment-header"><span class="comment-author">'+esc(c.userName||'User')+'</span>'+roleBadgeHtml(c.role)+'<span class="comment-time">'+relTime(c.timestamp)+'</span></div>';
      h+='<div class="comment-text">'+esc(c.message)+'</div></div></div>';
    });
    h+='<div class="comment-input-row"><input id="swComment-'+sw.id+'" placeholder="Add to thread..." style="font-size:13px"><button class="btn btn-sm btn-ghost" data-swid="'+sw.id+'" onclick="addSwapComment(this)">Send</button></div>';
    h+='</div>';
  } else {
    h+='<div class="swap-comment-section"><div class="swap-comment-title">Thread</div>';
    h+='<div class="comment-input-row"><input id="swComment-'+sw.id+'" placeholder="Add a comment..." style="font-size:13px"><button class="btn btn-sm btn-ghost" data-swid="'+sw.id+'" onclick="addSwapComment(this)">Send</button></div>';
    h+='</div>';
  }
  h+='<div class="swap-actions">';
  if(canRespond){h+='<button class="btn btn-success btn-sm" data-id="'+sw.id+'" data-action="ACCEPT" onclick="respondSwapBtn(this)">\u2713 Accept</button><button class="btn btn-danger btn-sm" data-id="'+sw.id+'" data-action="DECLINE" onclick="respondSwapBtn(this)">\u2715 Decline</button>';}
  if(canReview){h+='<button class="btn btn-success btn-sm" data-id="'+sw.id+'" data-action="APPROVE" onclick="reviewSwapBtn(this)">\u2713 Approve</button><button class="btn btn-danger btn-sm" data-id="'+sw.id+'" data-action="REJECT" onclick="reviewSwapBtn(this)">\u2715 Reject</button>';}
  if(canCancel)h+='<button class="btn btn-ghost btn-sm" data-id="'+sw.id+'" onclick="cancelSwapBtn(this)">Cancel</button>';
  h+='</div></div>';return h;
}

function addSwapComment(el){
  var swId=el.getAttribute('data-swid');
  var sw=getSwap(swId);if(!sw)return;
  var inp=document.getElementById('swComment-'+swId);
  var msg=(inp&&inp.value||'').trim();if(!msg)return;
  var u=state.currentUser;
  if(!sw.comments)sw.comments=[];
  sw.comments.push({userId:u.id,userName:u.name,role:u.role,message:msg,timestamp:now()});
  if(inp)inp.value='';
  toast('Comment added.','success');render();
}
function respondSwapBtn(el){openModal('respond-swap',{id:el.getAttribute('data-id'),action:el.getAttribute('data-action')||'ACCEPT'});}
function reviewSwapBtn(el){openModal('review-swap',{id:el.getAttribute('data-id'),action:el.getAttribute('data-action')||'APPROVE'});}
function cancelSwapBtn(el){if(!confirm('Cancel this swap request?'))return;var sw=getSwap(el.getAttribute('data-id'));if(!sw)return;sw.status='CANCELLED';sw.updatedAt=now();DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'SWAP_CANCELLED',entityType:'SwapRequest',entityId:sw.id,createdAt:now()});toast('Swap cancelled.','info');render();}


// ─── OPEN SHIFTS ──────────────────────────────────────────────────
function renderOpenShifts(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var openList=DB.openShifts.filter(function(s){return s.status==='OPEN';});
  var pendingList=DB.openShifts.filter(function(s){return s.status==='PENDING';});
  var filledList=DB.openShifts.filter(function(s){return s.status==='FILLED';});
  var h='';
  if(isMgr&&pendingList.length){
    h+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:16px;margin-bottom:24px">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:14px">\u26A0\uFE0F '+pendingList.length+' Open Shift'+(pendingList.length!==1?'s':'')+' Awaiting Approval</div>';
    pendingList.forEach(function(os){
      var claimer=getUser(os.claimedBy);
      h+='<div class="v3-card" style="margin-bottom:10px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
      h+='<div><div style="font-weight:600;color:var(--text)">'+fmtDateLabel(os.date)+' \u00B7 '+fmtRange(os.startTime,os.endTime)+'</div>';
      h+='<div style="margin-top:4px">'+taskBadgeHtml(os.taskName,os.taskColor)+'</div>';
      if(claimer)h+='<div style="font-size:12px;color:var(--text2);margin-top:4px">Claimed by <strong>'+esc(claimer.name)+'</strong> \u00B7 '+(os.claimType==='take'?'Extra shift':'Shift + swap proposal')+'</div>';
      h+='</div><div style="display:flex;gap:8px"><button class="btn btn-success btn-sm" data-osid="'+os.id+'" onclick="approveOpenShift(this)">\u2713 Approve</button><button class="btn btn-danger btn-sm" data-osid="'+os.id+'" onclick="rejectOpenShift(this)">\u2715 Return to Pool</button></div></div></div>';
    });
    h+='</div>';
  }
  h+='<div class="section-header"><div><div class="section-title">Open Shifts</div><div style="font-size:13px;color:var(--text2);margin-top:2px">Available shifts — take one to get started</div></div>';
  if(isMgr)h+='<button class="btn btn-primary" onclick="openModal(\'create-openshift\',{})">+ Post Open Shift</button>';
  h+='</div>';
  if(!openList.length){h+='<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No open shifts available</div><div class="empty-sub">All shifts are currently assigned.</div></div>';}
  else{
    h+='<div style="display:grid;gap:12px">';
    openList.forEach(function(os){
      var conflict=hasConflict(u.id,os.date,os.startTime,os.endTime,null);
      h+='<div class="v3-card"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">';
      h+='<div><div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(os.date)+'</div>';
      h+='<div style="font-size:13px;color:var(--text2);margin-top:3px">'+fmtRange(os.startTime,os.endTime)+'</div>';
      h+='<div style="margin-top:6px">'+taskBadgeHtml(os.taskName,os.taskColor)+'</div>';
      if(os.notes)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCDD '+esc(os.notes)+'</div></div>';
      h+='<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">';
      if(!conflict)h+='<button class="btn btn-primary btn-sm" data-osid="'+os.id+'" onclick="openModal(\'claim-openshift\',{id:\''+os.id+'\'})">Take Shift</button>';
      else h+='<span style="font-size:11px;color:var(--amber)">\u26A0 Scheduling conflict</span>';
      if(isMgr)h+='<button class="btn btn-ghost btn-xs" data-osid="'+os.id+'" onclick="removeOpenShift(this)">Remove</button>';
      h+='</div></div>';
      // Open shift comment thread (public)
      if(!os.comments)os.comments=[];
      h+='<div class="swap-comment-section" style="margin-top:10px"><div class="swap-comment-title">Discussion</div>';
      os.comments.forEach(function(c){
        var cu=getUser(c.userId);
        h+='<div class="comment-item" style="margin-bottom:8px"><div class="avatar avatar-sm" style="background:'+(cu?esc(cu.avatarColor):'#888')+'">'+(cu?esc(initials(cu.name)):'?')+'</div>';
        h+='<div class="comment-bubble"><div class="comment-header"><span class="comment-author">'+esc(c.userName||'User')+'</span>'+roleBadgeHtml(c.role)+'<span class="comment-time">'+relTime(c.timestamp)+'</span></div><div class="comment-text">'+esc(c.message)+'</div></div></div>';
      });
      h+='<div class="comment-input-row"><input id="osComment-'+os.id+'" placeholder="Ask a question..." style="font-size:13px"><button class="btn btn-sm btn-ghost" data-osid="'+os.id+'" onclick="addOpenShiftComment(this)">Send</button></div>';
      h+='</div></div>';
    });
    h+='</div>';
  }
  if(filledList.length){
    h+='<div style="margin-top:28px"><div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:14px">Recently Filled</div>';
    filledList.slice(0,5).forEach(function(os){var claimer=getUser(os.claimedBy);h+='<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between"><div style="font-size:13px;color:var(--text2)">'+fmtDateLabel(os.date)+' \u00B7 '+fmtRange(os.startTime,os.endTime)+' \u00B7 '+taskBadgeHtml(os.taskName,os.taskColor)+'</div><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+(claimer?esc(claimer.avatarColor):'#888')+'">'+(claimer?esc(initials(claimer.name)):'?')+'</div><span style="font-size:12px;color:var(--text2)">'+(claimer?esc(claimer.name):'Unknown')+'</span><span class="badge badge-active">Filled</span></div></div>';});
    h+='</div>';
  }
  return h;
}
function addOpenShiftComment(el){
  var osId=el.getAttribute('data-osid');
  var os=DB.openShifts.find(function(s){return s.id===osId;});if(!os)return;
  var inp=document.getElementById('osComment-'+osId);
  var msg=(inp&&inp.value||'').trim();if(!msg)return;
  var u=state.currentUser;
  if(!os.comments)os.comments=[];
  os.comments.push({userId:u.id,userName:u.name,role:u.role,message:msg,timestamp:now()});
  if(inp)inp.value='';
  toast('Comment posted.','success');render();
}
function approveOpenShift(el){
  var osId=el.getAttribute('data-osid'),os=DB.openShifts.find(function(s){return s.id===osId;});if(!os)return;
  var newShift={id:nextId('s'),employeeId:os.claimedBy,createdById:state.currentUser.id,date:os.date,startTime:os.startTime,endTime:os.endTime,taskId:os.taskId,taskName:os.taskName,taskColor:os.taskColor,notes:os.notes||'',employeeComments:[],createdAt:now(),updatedAt:now()};
  DB.shifts.push(newShift);
  if(os.claimType==='swap'&&os.swapShiftId){var swapSh=getShift(os.swapShiftId);if(swapSh){DB.swaps.push({id:nextId('sw'),status:'PENDING',requesterId:os.claimedBy,receiverId:null,requesterShiftId:os.swapShiftId,receiverShiftId:newShift.id,message:'Open shift claim with swap proposal.',adminNotes:'',responseMessage:'',responseBy:null,responseAt:null,comments:[],expiresAt:new Date(Date.now()+7*864e5).toISOString(),createdAt:now(),updatedAt:now(),reviewedById:null,reviewedAt:null});}}
  os.status='FILLED';os.approvedBy=state.currentUser.id;os.approvedAt=now();
  addNotif(os.claimedBy,'Open Shift Approved','Your claim for the open shift on '+os.date+' has been approved!','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_APPROVED',entityType:'OpenShift',entityId:osId,createdAt:now()});
  toast('Open shift approved and assigned.','success');render();
}
function rejectOpenShift(el){
  var osId=el.getAttribute('data-osid'),os=DB.openShifts.find(function(s){return s.id===osId;});if(!os)return;
  var claimer=getUser(os.claimedBy);os.status='OPEN';os.claimedBy=null;os.claimType=null;os.swapShiftId=null;
  if(claimer)addNotif(claimer.id,'Open Shift Returned','Your claim for the open shift on '+os.date+' was not approved. The shift is back in the pool.','info');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'OPEN_SHIFT_REJECTED',entityType:'OpenShift',entityId:osId,createdAt:now()});
  toast('Claim rejected. Shift returned to pool.','info');render();
}
function removeOpenShift(el){if(!confirm('Remove this open shift from the pool?'))return;var osId=el.getAttribute('data-osid');DB.openShifts=DB.openShifts.filter(function(s){return s.id!==osId;});toast('Open shift removed.','info');render();}


// ─── AVAILABILITY ─────────────────────────────────────────────────
function renderAvailability(){
  return isAdminOrMgr()?renderAvailabilityManagerView():renderAvailabilityEmployee();
}
function renderAvailabilityManagerView(){
  var h='<div style="margin-bottom:28px"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">My Availability</div><div style="font-size:12px;color:var(--text3)">Your personal recurring availability</div></div>';
  h+=renderAvailabilityEmployee();
  h+='<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">Team Availability Management</div>';
  h+=renderAvailabilityAdmin();h+='</div>';return h;
}
function renderAvailabilityEmployee(){
  var u=state.currentUser,myAvail=getUserAvailability(u.id);
  var myReqs=DB.availRequests.filter(function(r){return r.userId===u.id;}).slice().reverse();
  var hasPending=myReqs.some(function(r){return r.status==='PENDING';});
  var h='<div style="max-width:720px">';
  h+='<div class="section-header"><div><div class="section-title">My Weekly Availability</div></div>';
  if(!hasPending)h+='<button class="btn btn-primary" onclick="openModal(\'edit-availability\',{})">Request Change</button>';
  else h+='<span class="badge badge-pending">Change request pending</span>';
  h+='</div>';
  h+='<div class="card" style="margin-bottom:20px"><div class="card-header"><span class="card-title">Current Availability</span></div>';
  h+='<div style="padding:16px;display:grid;grid-template-columns:repeat(7,1fr);gap:8px">';
  AVAIL_DAYS.forEach(function(wd){
    var rec=myAvail.find(function(a){return a.dayOfWeek===wd.idx;})||{isAvailable:false,startTime:'09:00',endTime:'17:00'};
    h+='<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:10px 4px">';
    h+='<div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">'+wd.label.slice(0,3)+'</div>';
    if(rec.isAvailable)h+='<div style="font-size:10px;color:var(--green);line-height:1.6">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>';
    else h+='<div style="font-size:12px;color:var(--text3);font-weight:500">Off</div>';
    h+='</div>';
  });
  h+='</div></div>';
  if(myReqs.length){
    h+='<div style="font-size:15px;font-weight:600;margin-bottom:14px">Change Requests</div>';
    myReqs.slice(0,5).forEach(function(r){
      h+='<div class="v3-card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
      h+='<div style="font-size:13px;font-weight:600;color:var(--text)">Availability Change Request</div>';
      h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
      if(r.notes)h+='<div style="font-size:12px;color:var(--text2);margin-bottom:10px">'+esc(r.notes)+'</div>';
      h+='<div style="font-size:11px;color:var(--text3);margin-top:8px">Submitted '+relTime(r.createdAt)+(r.reviewedAt?' \u00B7 Reviewed '+relTime(r.reviewedAt):'')+'</div></div>';
    });
  }
  h+='</div>';return h;
}
function renderAvailabilityAdmin(){
  var pending=DB.availRequests.filter(function(r){return r.status==='PENDING';}).length;
  var tabs=[{id:'overview',label:'Team Overview'},{id:'requests',label:'Requests'+(pending?' ('+pending+')':'')}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.availTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAvailTab(this)">'+t.label+'</button>';});
  h+='</div>';
  return h+(state.availTab==='overview'?renderAvailOverview():renderAvailRequests());
}
function setAvailTab(el){state.availTab=el.getAttribute('data-tab')||'overview';render();}
function renderAvailOverview(){
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE'&&u.role==='EMPLOYEE';});
  var h='<div class="section-header"><div class="section-title">Team Weekly Availability</div></div>';
  employees.forEach(function(emp){
    var avail=getUserAvailability(emp.id);
    h+='<div class="card" style="margin-bottom:16px"><div class="card-header"><div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div></div></div>';
    h+='<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
    AVAIL_DAYS.forEach(function(wd){var rec=avail.find(function(a){return a.dayOfWeek===wd.idx;});h+='<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:8px 4px"><div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:4px">'+wd.label.slice(0,3).toUpperCase()+'</div>'+(rec&&rec.isAvailable?'<div style="font-size:9px;color:var(--green);line-height:1.5">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>':'<div style="font-size:10px;color:var(--text3)">Off</div>')+'</div>';});
    h+='</div></div>';
  });
  return h;
}
function renderAvailRequests(){
  var reqs=DB.availRequests.slice().reverse();
  var h='<div class="section-header"><div class="section-title">Availability Change Requests</div></div>';
  if(!reqs.length)return h+'<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No requests</div></div>';
  reqs.forEach(function(r){
    var emp=getUser(r.userId);if(!emp)return;
    h+='<div class="v3-card"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">';
    h+='<div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div><div class="swap-meta">'+relTime(r.createdAt)+'</div></div></div>';
    h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
    if(r.notes)h+='<div class="swap-message" style="margin-bottom:12px">'+esc(r.notes)+'</div>';
    if(r.status==='PENDING'){
      h+='<div class="swap-actions">';
      if(r.userId!==state.currentUser.id){h+='<button class="btn btn-success btn-sm" data-id="'+r.id+'" onclick="approveAvailBtn(this)">\u2713 Approve</button><button class="btn btn-danger btn-sm" data-id="'+r.id+'" onclick="openModal(\'reject-avail\',{id:\''+r.id+'\'})">Reject</button>';}
      else h+='<span style="font-size:12px;color:var(--text3);font-style:italic">\u26A0 Cannot self-approve</span>';
      h+='</div>';
    }
    h+='</div>';
  });
  return h;
}
function approveAvailBtn(el){
  var id=el.getAttribute('data-id'),r=getAvReq(id);if(!r)return;
  if(r.userId===state.currentUser.id){toast('You cannot approve your own availability request.','error');return;}
  r.proposedAvailability.forEach(function(pa){var ex=DB.availability.find(function(a){return a.userId===r.userId&&a.dayOfWeek===pa.dayOfWeek;});if(ex){ex.isAvailable=pa.isAvailable;ex.startTime=pa.startTime;ex.endTime=pa.endTime;}else DB.availability.push({id:nextId('av'),userId:r.userId,dayOfWeek:pa.dayOfWeek,startTime:pa.startTime,endTime:pa.endTime,isAvailable:pa.isAvailable});});
  r.status='APPROVED';r.reviewedBy=state.currentUser.id;r.reviewedAt=now();r.updatedAt=now();
  addNotif(r.userId,'Availability Approved','Your availability change request has been approved.','info');
  toast('Availability approved.','success');render();
}

// ─── TIME OFF ─────────────────────────────────────────────────────
function renderTimeOff(){
  if(!isAdminOrMgr())return renderTimeOffEmployee();
  var h='<div style="margin-bottom:28px"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">My Time Off</div><div style="font-size:12px;color:var(--text3)">Your personal time-off requests</div></div>';
  h+=renderTimeOffEmployee();
  h+='<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">Team Time Off Management</div>';
  h+=renderTimeOffAdmin();h+='</div>';return h;
}
function renderTimeOffEmployee(){
  var u=state.currentUser;
  var myReqs=DB.timeOffRequests.filter(function(r){return r.userId===u.id;}).slice().reverse();
  var h='<div style="max-width:700px"><div class="section-header"><div><div class="section-title">My Time Off Requests</div><div style="font-size:13px;color:var(--text2);margin-top:2px">Sick days and unpaid leave</div></div>';
  h+='<button class="btn btn-primary" onclick="openModal(\'create-timeoff\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Request Time Off</button>';
  h+='</div>';
  if(!myReqs.length)h+='<div class="empty-state"><div class="empty-icon">\uD83C\uDF34</div><div class="empty-title">No time-off requests</div><div class="empty-sub">Click "Request Time Off" above to submit your first request.</div></div>';
  else myReqs.forEach(function(r){h+=renderTOCard(r,false);});
  h+='</div>';return h;
}
function renderTimeOffAdmin(){
  var tabs=[{id:'pending',label:'Pending ('+DB.timeOffRequests.filter(function(r){return r.status==='PENDING';}).length+')'},{id:'all',label:'All Requests'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.toTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setTOTab(this)">'+t.label+'</button>';});
  h+='</div>';
  var reqs=DB.timeOffRequests.slice().reverse();
  if(state.toTab==='pending')reqs=reqs.filter(function(r){return r.status==='PENDING';});
  if(!reqs.length)return h+'<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No requests here</div></div>';
  reqs.forEach(function(r){h+=renderTOCard(r,true);}); return h;
}
function setTOTab(el){state.toTab=el.getAttribute('data-tab')||'pending';render();}
function renderTOCard(r,adminView){
  var emp=getUser(r.userId);
  var d1=new Date(r.startDate+'T00:00:00'),d2=new Date(r.endDate+'T00:00:00'),days=Math.round((d2-d1)/864e5)+1;
  var h='<div class="v3-card">';
  if(adminView&&emp){h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div></div></div>';}
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">';
  h+='<div><div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(r.startDate)+(r.startDate!==r.endDate?' \u2192 '+fmtDateLabel(r.endDate):'')+'</div>';
  h+='<div style="font-size:12px;color:var(--text2);margin-top:3px">'+days+' day'+(days!==1?'s':'')+' \u00B7 <span style="text-transform:capitalize;color:'+(r.type==='sick'?'var(--amber)':'var(--text2)')+'">'+esc(r.type)+'</span></div></div>';
  h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0)+r.status.slice(1).toLowerCase()+'</span></div>';
  if(r.notes)h+='<div class="swap-message">'+esc(r.notes)+'</div>';
  h+='<div style="font-size:11px;color:var(--text3);margin-top:8px">Submitted '+relTime(r.submittedAt)+' \u00B7 Signed: <em>'+esc(r.digitalSignatureName)+'</em></div>';
  if(r.adminNotes)h+='<div class="swap-message" style="margin-top:8px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.15);color:var(--amber)">'+esc(r.adminNotes)+'</div>';
  if(adminView&&r.status==='PENDING'){
    h+='<div class="swap-actions" style="margin-top:12px">';
    if(r.userId!==state.currentUser.id){h+='<button class="btn btn-success btn-sm" data-id="'+r.id+'" onclick="approveTOBtn(this)">\u2713 Approve</button><button class="btn btn-danger btn-sm" data-id="'+r.id+'" onclick="openModal(\'reject-timeoff\',{id:\''+r.id+'\'})">Reject</button>';}
    else h+='<span style="font-size:12px;color:var(--text3);font-style:italic">\u26A0 Cannot self-approve \u2014 assign to another admin</span>';
    h+='</div>';
  }
  h+='</div>';return h;
}
function approveTOBtn(el){
  var id=el.getAttribute('data-id'),r=getTOReq(id);if(!r)return;
  if(r.userId===state.currentUser.id){toast('You cannot approve your own time-off request.','error');return;}
  r.status='APPROVED';r.reviewedBy=state.currentUser.id;r.reviewedAt=now();r.updatedAt=now();
  addNotif(r.userId,'Time Off Approved','Your time-off from '+r.startDate+' to '+r.endDate+' has been approved.','info');
  toast('Time-off approved.','success');render();
}


// ─── ADMIN PANEL ──────────────────────────────────────────────────
function renderAdmin(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var tabs=[{id:'users',label:'Users'},{id:'swaps',label:'Swap Queue'},{id:'openshift',label:'Open Shifts'},{id:'avail',label:'Availability'},{id:'timeoff',label:'Time Off'},{id:'audit',label:'Audit Log'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.adminTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAdminTab(this)">'+t.label+'</button>';});
  h+='</div>';
  if(state.adminTab==='users')h+=renderAdminUsers();
  else if(state.adminTab==='swaps')h+=renderAdminSwaps();
  else if(state.adminTab==='openshift')h+=renderOpenShifts();
  else if(state.adminTab==='avail')h+=renderAvailRequests();
  else if(state.adminTab==='timeoff')h+=renderTimeOffAdmin();
  else h+=renderAuditLog();
  return h;
}
function setAdminTab(el){state.adminTab=el.getAttribute('data-tab')||'users';render();}
function renderAdminUsers(){
  var sq=(state.searchUser||'').toLowerCase();
  var users=DB.users.filter(function(u){return!sq||u.name.toLowerCase().includes(sq)||u.email.toLowerCase().includes(sq);});
  var active=DB.users.filter(function(u){return u.status==='ACTIVE';}).length;
  var h='<div class="section-header"><div><div class="section-title">Users</div><div style="font-size:13px;color:var(--text2);margin-top:2px">'+DB.users.length+' total \u00B7 '+active+' active</div></div>';
  h+='<div style="display:flex;gap:10px;align-items:center"><input class="search-input" id="userSearch" placeholder="Search users\u2026" value="'+esc(state.searchUser||'')+'" oninput="filterUsers(this.value)" style="width:180px"><button class="btn btn-primary btn-sm" onclick="openModal(\'create-user\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add User</button></div></div>';
  h+='<div class="card table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody>';
  if(!users.length)h+='<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">No users match your search</td></tr>';
  else users.forEach(function(u){
    h+='<tr><td><div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div><div style="font-weight:600;color:var(--text)">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div></td>';
    h+='<td><span class="badge badge-'+u.role.toLowerCase()+'">'+esc(u.role.charAt(0)+u.role.slice(1).toLowerCase())+'</span></td>';
    h+='<td><span class="badge badge-'+u.status.toLowerCase()+'">'+esc(u.status.charAt(0)+u.status.slice(1).toLowerCase())+'</span></td>';
    h+='<td style="text-align:right"><div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-xs btn-ghost" data-id="'+u.id+'" onclick="editUserBtn(this)">Edit</button>';
    if(u.id!==state.currentUser.id)h+='<button class="btn btn-xs '+(u.status==='ACTIVE'?'btn-danger':'btn-success')+'" data-id="'+u.id+'" onclick="toggleStatusBtn(this)">'+(u.status==='ACTIVE'?'Deactivate':'Activate')+'</button>';
    h+='</div></td></tr>';
  });
  h+='</tbody></table></div>';return h;
}
function filterUsers(val){state.searchUser=val;render();}
function editUserBtn(el){openModal('edit-user',{id:el.getAttribute('data-id')||''});}
function toggleStatusBtn(el){
  var id=el.getAttribute('data-id'),u=getUser(id);if(!u)return;
  if(u.id===state.currentUser.id){toast('Cannot change your own status.','error');return;}
  u.status=u.status==='ACTIVE'?'INACTIVE':'ACTIVE';
  toast('User '+(u.status==='ACTIVE'?'activated':'deactivated')+'.','success');render();
}
function renderAdminSwaps(){var queue=DB.swaps.filter(function(s){return s.status==='ACCEPTED';});var h='<div class="section-header"><div class="section-title">Swap Approval Queue</div></div>';if(!queue.length)h+='<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">Queue is clear</div></div>';else queue.forEach(function(sw){h+=renderSwapCard(sw);});return h;}
function renderAuditLog(){
  var log=DB.auditLog.slice().reverse().slice(0,60);
  var h='<div class="section-header"><div class="section-title">Audit Log</div><div style="font-size:13px;color:var(--text2)">Last '+log.length+' actions</div></div>';
  if(!log.length)return h+'<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><div class="empty-title">No activity yet</div></div>';
  h+='<div class="card card-p">';
  log.forEach(function(entry){var actor=getUser(entry.userId);h+='<div class="audit-row"><div class="audit-dot"></div><div style="flex:1"><div class="audit-action">'+esc(entry.action.replace(/_/g,' '))+'</div><div class="audit-detail">'+(actor?esc(actor.name):'System')+(entry.entityType?' \u00B7 '+esc(entry.entityType):'')+'</div></div><div class="audit-time">'+relTime(entry.createdAt)+'</div></div>';});
  h+='</div>';return h;
}

// ─── PROFILE ──────────────────────────────────────────────────────
function renderProfile(){
  var u=state.currentUser;
  var h='<div class="profile-wrap"><div class="profile-header"><div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div>';
  h+='<div><div class="profile-name">'+esc(u.name)+'</div><div class="profile-email">'+esc(u.email)+'</div>';
  h+='<div style="margin-top:8px"><span class="badge badge-'+u.role.toLowerCase()+'">'+esc(u.role)+'</span></div></div></div>';
  h+='<div class="card card-p" style="margin-top:16px"><div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Edit Profile</div>';
  h+='<div class="form-group"><label>Display Name</label><input id="pName" value="'+esc(u.name)+'"></div>';
  h+='<div class="form-group"><label>Email <span style="color:var(--text3);font-size:11px">(contact admin to change)</span></label><input value="'+esc(u.email)+'" disabled style="opacity:.45;cursor:not-allowed"></div>';
  h+='<button class="btn btn-primary" onclick="saveProfile()">Save Changes</button></div>';
  h+='<div class="card card-p" style="margin-top:16px"><div style="font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:18px">Change Password</div>';
  h+='<div class="form-group"><label>New Password</label><input type="password" id="pNewPw" placeholder="Min 8 chars, 1 uppercase, 1 number"></div>';
  h+='<div class="form-group"><label>Confirm New Password</label><input type="password" id="pConPw" placeholder="Repeat password"></div>';
  h+='<button class="btn btn-ghost" onclick="savePassword()">Update Password</button></div></div>';
  return h;
}
function saveProfile(){var el=document.getElementById('pName');if(!el)return;var name=el.value.trim();if(!name){toast('Name cannot be empty.','error');return;}state.currentUser.name=name;toast('Profile updated.','success');render();}
function savePassword(){var n=document.getElementById('pNewPw'),c=document.getElementById('pConPw');if(!n||!c)return;var err=validatePassword(n.value);if(err){toast(err,'error');return;}if(n.value!==c.value){toast('Passwords do not match.','error');return;}state.currentUser.password=n.value;n.value='';c.value='';toast('Password updated.','success');}

// ─── NOTIFICATIONS ────────────────────────────────────────────────
function toggleNotif(){state.notifOpen=!state.notifOpen;render();}
function markAllRead(){var uid=state.currentUser.id;DB.notifications.filter(function(n){return n.userId===uid;}).forEach(function(n){n.read=true;});render();}
function readNotifBtn(el){var id=el.getAttribute('data-id');var n=DB.notifications.find(function(x){return x.id===id;});if(n)n.read=true;render();}
function renderNotifPanel(){
  var u=state.currentUser;
  var notifs=DB.notifications.filter(function(n){return n.userId===u.id;}).slice(0,40);
  var unread=notifs.filter(function(n){return !n.read;}).length;
  var h='<div class="notif-panel"><div class="notif-header"><span class="notif-title">Notifications'+(unread>0?' <span style="background:var(--brand-bg);color:var(--brand2);font-size:10px;padding:1px 6px;border-radius:5px;font-weight:700">'+unread+' new</span>':'')+'</span>';
  h+='<div style="display:flex;gap:6px">'+(unread>0?'<button class="btn btn-xs btn-ghost" onclick="markAllRead()">Mark all read</button>':'')+'<button class="btn btn-xs btn-ghost" onclick="toggleNotif()" aria-label="Close">\u2715</button></div></div>';
  h+='<div class="notif-list">';
  if(!notifs.length)h+='<div class="notif-empty">No notifications yet</div>';
  else notifs.forEach(function(n){h+='<div class="notif-item'+(n.read?'':' unread')+'" data-id="'+n.id+'" onclick="readNotifBtn(this)"><div class="notif-dot2" style="opacity:'+(n.read?0:1)+'"></div><div><div class="notif-text-title">'+esc(n.title)+'</div><div class="notif-text-msg">'+esc(n.message)+'</div><div class="notif-time">'+relTime(n.createdAt)+'</div></div></div>';});
  h+='</div></div><div style="position:fixed;inset:0;z-index:149" onclick="toggleNotif()"></div>';
  return h;
}


// ─── MODAL SYSTEM ─────────────────────────────────────────────────
function openModal(type,data){state.modal={type:type,data:data||{}};render();}
function closeModal(){state.modal=null;render();}
function modalWrap(title,body,size){
  var w=size==='lg'?'max-width:640px':'max-width:500px';
  return'<div class="modal-overlay" onclick="if(event.target===this)closeModal()">'+
    '<div class="modal" style="'+w+'"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px">'+
    '<div class="modal-title" style="margin-bottom:0">'+title+'</div>'+
    '<button onclick="closeModal()" class="btn btn-xs btn-ghost" style="flex-shrink:0;font-size:16px;padding:4px 8px;">\u2715</button></div>'+
    body+'</div></div>';
}

function renderModal(){
  var m=state.modal;if(!m)return'';
  var fns={
    'create-shift':      renderCreateShiftModal,
    'edit-shift':        function(){return renderEditShiftModal(m.data.id);},
    'view-shift':        function(){return renderViewShiftModal(m.data.id);},
    'request-swap':      function(){return renderRequestSwapModal(m.data.shiftId);},
    'respond-swap':      function(){return renderRespondSwapModal(m.data.id,m.data.action);},
    'review-swap':       function(){return renderReviewSwapModal(m.data.id,m.data.action);},
    'create-user':       renderCreateUserModal,
    'edit-user':         function(){return renderEditUserModal(m.data.id);},
    'edit-availability': renderEditAvailabilityModal,
    'reject-avail':      function(){return renderRejectAvailModal(m.data.id);},
    'create-timeoff':    renderCreateTimeOffModal,
    'reject-timeoff':    function(){return renderRejectTOModal(m.data.id);},
    'claim-openshift':   renderClaimOpenShiftModal,
    'create-openshift':  renderCreateOpenShiftModal,
    'create-task':       renderCreateTaskModal,
    'edit-task':         function(){return renderEditTaskModal(m.data.id);},
    'publish-schedule':  renderPublishScheduleModal,
  };
  return(fns[m.type]||function(){return'';})();
}

// ─── TASK MODALS ──────────────────────────────────────────────────
var TASK_COLORS=['#6366f1','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#14b8a6','#a855f7','#06b6d4','#84cc16'];
function colorSwatchHtml(selected,fieldId){
  var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" id="tc_'+fieldId+'">';
  TASK_COLORS.forEach(function(c){h+='<div onclick="pickTaskColor(\''+c+'\',\''+fieldId+'\')" style="width:22px;height:22px;border-radius:50%;background:'+c+';cursor:pointer;border:3px solid '+(c===selected?'var(--text)':'transparent')+';transition:.1s" data-color="'+c+'"></div>';});
  h+='</div><input type="hidden" id="'+fieldId+'" value="'+(selected||'#6366f1')+'">';return h;
}
function pickTaskColor(color,fieldId){
  var inp=document.getElementById(fieldId);if(inp)inp.value=color;
  var container=document.getElementById('tc_'+fieldId);
  if(container)container.querySelectorAll('div[data-color]').forEach(function(d){d.style.borderColor=d.getAttribute('data-color')===color?'var(--text)':'transparent';});
}
function renderCreateTaskModal(){
  var body='<div class="form-group"><label>Task Name *</label><input id="tkName" placeholder="e.g. Skate Guard"></div>';
  body+='<div class="form-group"><label>Description</label><textarea id="tkDesc" placeholder="What does this task involve?"></textarea></div>';
  body+='<div class="form-group"><label>Color</label>'+colorSwatchHtml('#6366f1','tkColor')+'</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createTask()">Create Task</button></div>';
  return modalWrap('Create Task',body);
}
function createTask(){
  var name=((document.getElementById('tkName')||{}).value||'').trim();
  var desc=((document.getElementById('tkDesc')||{}).value||'').trim();
  var color=(document.getElementById('tkColor')||{}).value||'#6366f1';
  if(!name){toast('Task name is required.','error');return;}
  DB.tasks.push({id:nextId('t'),name:name,color:color,description:desc,active:true});
  toast('Task "'+name+'" created.','success');closeModal();
}
function renderEditTaskModal(id){
  var t=getTask(id);if(!t)return'';
  var body='<div class="form-group"><label>Task Name *</label><input id="tkName" value="'+esc(t.name)+'"></div>';
  body+='<div class="form-group"><label>Description</label><textarea id="tkDesc">'+esc(t.description||'')+'</textarea></div>';
  body+='<div class="form-group"><label>Color</label>'+colorSwatchHtml(t.color,'tkColor')+'</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+id+'" onclick="updateTask(this)">Save Changes</button></div>';
  return modalWrap('Edit Task',body);
}
function updateTask(btn){
  var id=btn.getAttribute('data-id'),t=getTask(id);if(!t)return;
  var name=((document.getElementById('tkName')||{}).value||'').trim();
  if(!name){toast('Task name is required.','error');return;}
  t.name=name;t.description=((document.getElementById('tkDesc')||{}).value||'').trim();
  t.color=(document.getElementById('tkColor')||{}).value||t.color;
  // Update existing shifts that use this task
  DB.shifts.forEach(function(s){if(s.taskId===id){s.taskName=t.name;s.taskColor=t.color;}});
  DB.previewShifts.forEach(function(s){if(s.taskId===id){s.taskName=t.name;s.taskColor=t.color;}});
  toast('Task updated.','success');closeModal();
}

// ─── PUBLISH MODAL ────────────────────────────────────────────────
function renderPublishScheduleModal(){
  var u=state.currentUser;
  var body='<div class="publish-auth">';
  body+='<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">\uD83D\uDD10 Authentication Required</div>';
  body+='<div style="font-size:12px;color:var(--text2);margin-bottom:14px">Publishing will make '+DB.previewShifts.length+' preview shift'+(DB.previewShifts.length!==1?'s':'')+' live. Employees will be notified.</div>';
  body+='<div class="form-group"><label>Your Full Name</label><input id="pubName" placeholder="'+esc(u.name)+'" autocomplete="off"></div>';
  body+='<div class="form-group"><label>Your Password</label><input type="password" id="pubPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password"></div>';
  body+='</div>';
  body+='<div id="publishResult"></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="executePublish()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Publish Schedule</button></div>';
  return modalWrap('Publish Schedule',body);
}
function executePublish(){
  var nameIn=((document.getElementById('pubName')||{}).value||'').trim();
  var passIn=(document.getElementById('pubPass')||{}).value||'';
  var res=document.getElementById('publishResult');
  var u=state.currentUser;
  if(!nameIn||!passIn){if(res)res.innerHTML='<div class="publish-result denied">All fields are required.</div>';return;}
  if(nameIn.toLowerCase()!==u.name.toLowerCase()||passIn!==u.password){
    if(res)res.innerHTML='<div class="publish-result denied">\uD83D\uDEAB Denied — incorrect credentials.</div>';return;
  }
  if(DB.previewShifts.length===0){if(res)res.innerHTML='<div class="publish-result error">\u26A0\uFE0F No preview shifts to publish.</div>';return;}
  try{
    DB.previewShifts.forEach(function(s){
      var copy=JSON.parse(JSON.stringify(s));copy.id=nextId('s');DB.shifts.push(copy);
    });
    var count=DB.previewShifts.length;
    DB.previewShifts=[];
    DB.users.filter(function(x){return x.status==='ACTIVE';}).forEach(function(emp){addNotif(emp.id,'Schedule Published','A new schedule has been published. Check your shifts!','info');});
    DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SCHEDULE_PUBLISHED',entityType:'Schedule',entityId:'',createdAt:now()});
    if(res)res.innerHTML='<div class="publish-result success">\u2705 Schedule Published Successfully<br><span style="font-size:13px;font-weight:400">'+count+' shift'+(count!==1?'s':'')+' moved to live schedule</span></div>';
    setTimeout(function(){closeModal();navigate('schedule');},2000);
  }catch(e){if(res)res.innerHTML='<div class="publish-result error">\u274C Error: '+e.message+'</div>';}
}

// ─── SHIFT MODALS (v6 task-based) ────────────────────────────────
function renderCreateShiftModal(){
  var preview=state.modal.data&&state.modal.data.preview;
  var defaultDate=todayStr();
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var isMgr=isAdminOrMgr();
  var body='';
  if(isMgr){body+='<div class="form-group"><label>Employee *</label><select id="mEmp"><option value="">Select employee\u2026</option>';employees.forEach(function(u){body+='<option value="'+u.id+'">'+esc(u.name)+'</option>';});body+='</select></div>';}
  body+='<div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+esc(defaultDate)+'"></div>';
  body+='<div class="form-group"><label>Task *</label><select id="mTask"><option value="">Select task\u2026</option>';
  activeTasks.forEach(function(t){body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'">'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="09:00"></div>';
  body+='<div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="17:00"></div></div>';
  body+='<div class="form-group"><label>Shift Instructions</label><textarea id="mNotes" placeholder="Instructions, expectations, or guidance for this shift\u2026"></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-preview="'+(preview?'1':'0')+'" onclick="createShift(this)">'+( preview?'Add to Preview':'Create Shift')+'</button></div>';
  return modalWrap(preview?'Add Preview Shift':'Create Shift',body);
}
function createShift(btn){
  var preview=btn&&btn.getAttribute('data-preview')==='1';
  var isMgr=isAdminOrMgr();
  var empId=isMgr?(document.getElementById('mEmp')||{}).value:state.currentUser.id;
  var date=(document.getElementById('mDate')||{}).value||'';
  var taskVal=(document.getElementById('mTask')||{}).value||'';
  var start=(document.getElementById('mStart')||{}).value||'';
  var end=(document.getElementById('mEnd')||{}).value||'';
  var notes=(document.getElementById('mNotes')||{}).value||'';
  if(isMgr&&!empId){toast('Please select an employee.','error');return;}
  if(!date){toast('Date is required.','error');return;}
  if(!taskVal){toast('Please select a task.','error');return;}
  if(!start||!end){toast('Start and end times are required.','error');return;}
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start time.','error');return;}
  var tp=taskVal.split('|');
  var taskId=tp[0],taskName=tp[1],taskColor=tp[2];
  var shiftsArr=preview?DB.previewShifts:DB.shifts;
  if(hasConflict(empId,date,start,end,null,shiftsArr)){toast('Conflict: this employee already has an overlapping shift.','error');return;}
  if(!preview&&isOnApprovedTimeOff(empId,date)){if(!confirm('\u26A0\uFE0F This employee has approved time off on '+date+'. Schedule anyway?'))return;}
  var shift={id:nextId('s'),employeeId:empId,createdById:state.currentUser.id,date:date,startTime:start,endTime:end,taskId:taskId,taskName:taskName,taskColor:taskColor,notes:notes,employeeComments:[],createdAt:now(),updatedAt:now()};
  shiftsArr.push(shift);
  if(!preview){addNotif(empId,'Shift Assigned','New shift on '+date+' from '+fmt12(start)+' to '+fmt12(end)+' ('+taskName+').');}
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:preview?'PREVIEW_SHIFT_CREATED':'SHIFT_CREATED',entityType:'Shift',entityId:shift.id,createdAt:now()});
  toast(preview?'Preview shift added.':'Shift created.','success');closeModal();
}

function renderEditShiftModal(id){
  var s=getShift(id)||DB.previewShifts.find(function(x){return x.id===id;});
  if(!s)return modalWrap('Shift Not Found','<p style="color:var(--text2)">This shift could not be found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var body='<div class="form-group"><label>Employee *</label><select id="mEmp">';
  employees.forEach(function(u){body+='<option value="'+u.id+'"'+(u.id===s.employeeId?' selected':'')+'>'+esc(u.name)+'</option>';});
  body+='</select></div>';
  body+='<div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+esc(s.date)+'"></div>';
  body+='<div class="form-group"><label>Task *</label><select id="mTask"><option value="">Select task\u2026</option>';
  activeTasks.forEach(function(t){var sel=t.id===s.taskId?' selected':'';body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'"'+sel+'>'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="'+esc(s.startTime)+'"></div>';
  body+='<div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="'+esc(s.endTime)+'"></div></div>';
  body+='<div class="form-group"><label>Shift Instructions</label><textarea id="mNotes">'+esc(s.notes||'')+'</textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-danger" onclick="deleteShiftConfirm(\''+id+'\')">Delete</button><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="updateShift(\''+id+'\')">Save Changes</button></div>';
  return modalWrap('Edit Shift',body);
}
function updateShift(id){
  var s=getShift(id)||DB.previewShifts.find(function(x){return x.id===id;});if(!s)return;
  if(DB.swaps.some(function(sw){return(sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;})){toast('Cannot edit: shift has an active swap request.','error');return;}
  var empId=(document.getElementById('mEmp')||{}).value||s.employeeId;
  var date=(document.getElementById('mDate')||{}).value||s.date;
  var taskVal=(document.getElementById('mTask')||{}).value||'';
  var start=(document.getElementById('mStart')||{}).value||s.startTime;
  var end=(document.getElementById('mEnd')||{}).value||s.endTime;
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start time.','error');return;}
  if(taskVal){var tp=taskVal.split('|');s.taskId=tp[0];s.taskName=tp[1];s.taskColor=tp[2];}
  s.employeeId=empId;s.date=date;s.startTime=start;s.endTime=end;
  s.notes=(document.getElementById('mNotes')||{}).value||'';s.updatedAt=now();
  addNotif(s.employeeId,'Shift Updated','Your shift on '+date+' has been updated to '+fmt12(start)+' \u2013 '+fmt12(end)+'.','shift');
  toast('Shift updated.','success');closeModal();
}
function deleteShiftConfirm(id){
  if(DB.swaps.some(function(sw){return(sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;})){toast('Cannot delete: shift has an active swap request.','error');return;}
  if(!confirm('Delete this shift? This cannot be undone.'))return;
  var s=getShift(id);if(s)addNotif(s.employeeId,'Shift Removed','Your shift on '+s.date+' has been removed.','shift');
  DB.shifts=DB.shifts.filter(function(x){return x.id!==id;});
  DB.previewShifts=DB.previewShifts.filter(function(x){return x.id!==id;});
  toast('Shift deleted.','success');closeModal();
}

function renderViewShiftModal(id){
  var s=getShift(id);
  if(!s)return modalWrap('Shift Not Found','<p style="color:var(--text2)">Shift not found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var emp=getUser(s.employeeId),u=state.currentUser,isMgr=isAdminOrMgr();
  var isOwn=s.employeeId===u.id,isPast=s.date<todayStr();
  var hasSwap=DB.swaps.some(function(sw){return(sw.requesterShiftId===id||sw.receiverShiftId===id)&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;});
  var onTO=isOnApprovedTimeOff(s.employeeId,s.date);
  var body='<div style="border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,.07);background:'+esc(s.taskColor||'#6366f1')+'">';
  if(isMgr&&emp)body+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="avatar" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div><div style="font-weight:700;color:#fff">'+esc(emp.name)+'</div></div></div>';
  body+='<div style="font-size:15px;font-weight:700;color:#fff">'+fmtDateLabel(s.date)+'</div>';
  body+='<div style="font-size:14px;margin-top:4px;color:rgba(255,255,255,.9)">'+fmtRange(s.startTime,s.endTime)+'</div>';
  body+='<div style="margin-top:8px"><span style="background:rgba(255,255,255,.2);color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px">'+esc(s.taskName||'Shift')+'</span></div>';
  if(s.notes)body+='<div style="font-size:12px;margin-top:10px;color:rgba(255,255,255,.8)">\uD83D\uDCCB Instructions: '+esc(s.notes)+'</div>';
  body+='</div>';
  if(isPast) body+='<div style="font-size:12px;color:var(--text3);margin-bottom:14px">\u23F0 This shift is in the past.</div>';
  if(onTO)   body+='<div style="font-size:12px;color:var(--red);background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;margin-bottom:14px">\u26D4 Employee has approved time off on this date.</div>';
  if(hasSwap)body+='<div style="font-size:12px;color:var(--amber);background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.15);border-radius:8px;padding:10px;margin-bottom:14px">\u26A0\uFE0F This shift has an active swap request.</div>';
  // v6: employee comments
  if(!s.employeeComments)s.employeeComments=[];
  body+='<div class="comment-thread"><div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Shift Comments</div>';
  if(s.employeeComments.length){
    s.employeeComments.forEach(function(c){
      var cu=getUser(c.userId);
      body+='<div class="comment-item"><div class="avatar avatar-sm" style="background:'+(cu?esc(cu.avatarColor):'#888')+'">'+(cu?esc(initials(cu.name)):'?')+'</div>';
      body+='<div class="comment-bubble"><div class="comment-header"><span class="comment-author">'+esc(c.userName||'User')+'</span>'+roleBadgeHtml(c.role)+'<span class="comment-time">'+relTime(c.timestamp)+'</span></div><div class="comment-text">'+esc(c.message)+'</div></div></div>';
    });
  } else {
    body+='<div style="font-size:12px;color:var(--text3);font-style:italic">No comments yet.</div>';
  }
  // Only assigned employee or admins/managers can comment
  if(isOwn||isMgr){
    body+='<div class="comment-input-row"><input id="shiftComment-'+id+'" placeholder="Log an update or task note..." style="font-size:13px"><button class="btn btn-sm btn-ghost" data-sid="'+id+'" onclick="addShiftComment(this)">Post</button></div>';
  }
  body+='</div>';
  body+='<div class="modal-actions" style="flex-wrap:wrap;margin-top:16px">';
  if(isOwn&&!isPast&&!hasSwap)body+='<button class="btn btn-brand" onclick="closeModal();openModal(\'request-swap\',{shiftId:\''+id+'\'})">Request Swap</button>';
  if(isMgr)body+='<button class="btn btn-ghost" onclick="closeModal();openModal(\'edit-shift\',{id:\''+id+'\'})">Edit Shift</button>';
  body+='<button class="btn btn-ghost" onclick="closeModal()">Close</button></div>';
  return modalWrap('Shift Details',body,'lg');
}
function addShiftComment(btn){
  var sid=btn.getAttribute('data-sid');var s=getShift(sid);if(!s)return;
  var inp=document.getElementById('shiftComment-'+sid);
  var msg=(inp&&inp.value||'').trim();if(!msg)return;
  var u=state.currentUser;
  if(!s.employeeComments)s.employeeComments=[];
  s.employeeComments.push({userId:u.id,userName:u.name,role:u.role,message:msg,timestamp:now()});
  if(inp)inp.value='';
  s.updatedAt=now();
  toast('Comment posted.','success');render();
}


// ─── SWAP MODALS ──────────────────────────────────────────────────
function renderRequestSwapModal(shiftId){
  var u=state.currentUser,shift=getShift(shiftId);
  if(!shift)return modalWrap('Shift Not Found','<p style="color:var(--text2)">Shift not found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var employees=DB.users.filter(function(x){return x.status==='ACTIVE'&&x.id!==u.id;});
  var body='<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Your shift</div>';
  body+='<div style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06);background:'+esc(shift.taskColor||'#6366f1')+'">';
  body+='<div style="color:#fff;font-weight:600">'+fmtDateLabel(shift.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:13px">'+fmtRange(shift.startTime,shift.endTime)+'</div>';
  body+='<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:4px">'+esc(shift.taskName||'Shift')+'</div></div></div>';
  body+='<div class="form-group"><label>Swap with (optional)</label><select id="swEmp"><option value="">Open swap \u2014 any available employee</option>';
  employees.forEach(function(e){body+='<option value="'+e.id+'">'+esc(e.name)+'</option>';});
  body+='</select></div>';
  body+='<div class="form-group"><label>Message to recipient (optional)</label><textarea id="swMsg" placeholder="Explain why you need to swap\u2026"></textarea></div>';
  body+='<div style="font-size:12px;color:var(--text3);background:var(--bg3);border-radius:8px;padding:10px 12px;margin-bottom:16px;line-height:1.6">\u26A0\uFE0F Swaps require approval from a manager or admin before taking effect.</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-shiftid="'+shiftId+'" onclick="createSwapSubmit(this)">Send Request</button></div>';
  return modalWrap('Request Shift Swap',body);
}
function createSwapSubmit(btn){createSwap(btn.getAttribute('data-shiftid'));}
function createSwap(shiftId){
  var u=state.currentUser,shift=getShift(shiftId);if(!shift)return;
  if(shift.date<todayStr()){toast('Cannot swap a past shift.','error');return;}
  if(DB.swaps.some(function(sw){return sw.requesterShiftId===shiftId&&['PENDING','ACCEPTED'].indexOf(sw.status)!==-1;})){toast('This shift already has an active swap request.','error');return;}
  var recId=(document.getElementById('swEmp')||{}).value||null;
  var msg=(document.getElementById('swMsg')||{}).value||'';
  var sw={id:nextId('sw'),status:'PENDING',requesterId:u.id,receiverId:recId||null,requesterShiftId:shiftId,receiverShiftId:null,message:msg,adminNotes:'',responseMessage:'',responseBy:null,responseAt:null,comments:[],expiresAt:new Date(Date.now()+DB.settings.swapExpiryDays*864e5).toISOString(),createdAt:now(),updatedAt:now(),reviewedById:null,reviewedAt:null};
  DB.swaps.push(sw);
  if(recId)addNotif(recId,'Swap Request',u.name+' has requested a shift swap with you.','swap');
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_REQUESTED',entityType:'SwapRequest',entityId:sw.id,createdAt:now()});
  toast('Swap request sent!','success');closeModal();
}
function renderRespondSwapModal(swapId,defaultAction){
  var sw=getSwap(swapId);if(!sw)return'';
  var rs=getShift(sw.requesterShiftId),req=getUser(sw.requesterId);if(!rs||!req)return'';
  var body='<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Shift being swapped</div>';
  body+='<div style="border-radius:8px;padding:12px;border:1px solid rgba(255,255,255,.06);background:'+esc(rs.taskColor||'#6366f1')+'">';
  body+='<div style="color:#fff;font-weight:600">'+fmtDateLabel(rs.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:13px">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
  body+='<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:4px">'+esc(rs.taskName||'Shift')+'</div>';
  body+='<div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:4px">Requested by '+esc(req.name)+(sw.message?' \u00B7 "'+esc(sw.message)+'"':'')+'</div></div></div>';
  body+='<div class="form-group"><label>Your Decision</label><div style="display:flex;gap:8px;margin-top:4px">';
  body+='<button id="rBtnA" class="btn '+(defaultAction==='ACCEPT'?'btn-success':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setRespondAction(\'ACCEPT\')">\u2713 Accept</button>';
  body+='<button id="rBtnD" class="btn '+(defaultAction==='DECLINE'?'btn-danger':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setRespondAction(\'DECLINE\')">\u2715 Decline</button>';
  body+='</div><input type="hidden" id="rAction" value="'+(defaultAction||'ACCEPT')+'"></div>';
  body+='<div class="form-group"><label>Message (optional — will be visible to all parties)</label><textarea id="rMsg" placeholder="Add a note\u2026"></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+swapId+'" onclick="submitRespond(this)">Confirm Response</button></div>';
  return modalWrap('Respond to Swap Request',body);
}
function setRespondAction(action){
  var inp=document.getElementById('rAction');if(inp)inp.value=action;
  var a=document.getElementById('rBtnA'),d=document.getElementById('rBtnD');
  if(a){a.className='btn '+(action==='ACCEPT'?'btn-success':'btn-ghost');a.style.cssText='flex:1;justify-content:center';}
  if(d){d.className='btn '+(action==='DECLINE'?'btn-danger':'btn-ghost');d.style.cssText='flex:1;justify-content:center';}
}
function submitRespond(btn){
  var swapId=btn.getAttribute('data-id'),sw=getSwap(swapId);if(!sw)return;
  if(new Date()>new Date(sw.expiresAt)){toast('This swap request has expired.','error');return;}
  var action=(document.getElementById('rAction')||{}).value,rMsg=(document.getElementById('rMsg')||{}).value||'';
  var u=state.currentUser;
  sw.responseMessage=rMsg;sw.responseBy=u.id;sw.responseAt=now();
  if(action==='ACCEPT'){
    var rs=getShift(sw.requesterShiftId);
    if(rs&&hasConflict(u.id,rs.date,rs.startTime,rs.endTime,sw.receiverShiftId)){toast('You have a conflicting shift on that date.','error');return;}
    sw.status='ACCEPTED';
    addNotif(sw.requesterId,'Swap Accepted',u.name+' accepted your swap request. Awaiting manager approval.'+(rMsg?' Reply: '+rMsg:''),'swap');
    DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Swap Needs Review','A swap between '+getUser(sw.requesterId).name+' and '+u.name+' is awaiting your approval.','swap');});
    if(!sw.comments)sw.comments=[];
    sw.comments.push({userId:u.id,userName:u.name,role:u.role,message:'\u2713 Accepted'+(rMsg?' — '+rMsg:''),timestamp:now()});
  } else {
    sw.status='DECLINED';
    addNotif(sw.requesterId,'Swap Declined',u.name+' declined your swap request.'+(rMsg?' Reply: '+rMsg:''),'swap');
    if(!sw.comments)sw.comments=[];
    sw.comments.push({userId:u.id,userName:u.name,role:u.role,message:'\u2715 Declined'+(rMsg?' — '+rMsg:''),timestamp:now()});
  }
  sw.updatedAt=now();
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action+'D',entityType:'SwapRequest',entityId:swapId,createdAt:now()});
  toast('Swap '+action.toLowerCase()+'ed.','success');closeModal();
}
function renderReviewSwapModal(swapId,defaultAction){
  var sw=getSwap(swapId);if(!sw)return'';
  var req=getUser(sw.requesterId),rec=sw.receiverId?getUser(sw.receiverId):null;
  var rs=getShift(sw.requesterShiftId),recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
  var body='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">';
  body+='<div style="background:var(--bg3);border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Requester</div><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+(req?esc(req.avatarColor):'#888')+'">'+esc(req?initials(req.name):'?')+'</div><span style="font-weight:600;font-size:13px">'+(req?esc(req.name):'?')+'</span></div></div>';
  if(rec)body+='<div style="background:var(--bg3);border-radius:10px;padding:14px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Receiver</div><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:'+esc(rec.avatarColor)+'">'+esc(initials(rec.name))+'</div><span style="font-weight:600;font-size:13px">'+esc(rec.name)+'</span></div></div>';
  else body+='<div></div>';body+='</div>';
  body+='<div style="display:grid;grid-template-columns:1fr 32px 1fr;gap:8px;align-items:center;margin-bottom:16px">';
  if(rs)body+='<div class="swap-shift-box"><div class="swap-shift-label">Requester\'s shift</div><div class="swap-shift-date">'+fmtDateLabel(rs.date)+'</div><div class="swap-shift-time">'+fmtRange(rs.startTime,rs.endTime)+'</div><div style="margin-top:4px">'+taskBadgeHtml(rs.taskName,rs.taskColor)+'</div></div>';
  body+='<div style="text-align:center;color:var(--text3);font-size:18px">\u21C4</div>';
  if(recS)body+='<div class="swap-shift-box"><div class="swap-shift-label">Swap with</div><div class="swap-shift-date">'+fmtDateLabel(recS.date)+'</div><div class="swap-shift-time">'+fmtRange(recS.startTime,recS.endTime)+'</div><div style="margin-top:4px">'+taskBadgeHtml(recS.taskName,recS.taskColor)+'</div></div>';
  else body+='<div class="swap-shift-box" style="border-style:dashed"><div class="swap-shift-label">Open swap</div></div>';
  body+='</div>';
  if(sw.message)body+='<div class="swap-message" style="margin-bottom:16px">\uD83D\uDCAC '+esc(sw.message)+'</div>';
  if(sw.responseMessage)body+='<div class="swap-message" style="margin-bottom:16px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15)">\uD83D\uDCAC Reply: '+esc(sw.responseMessage)+'</div>';
  body+='<div class="form-group"><label>Decision</label><div style="display:flex;gap:8px;margin-top:4px">';
  body+='<button id="rvA" class="btn '+(defaultAction==='APPROVE'?'btn-success':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setReviewAction(\'APPROVE\')">\u2713 Approve</button>';
  body+='<button id="rvR" class="btn '+(defaultAction==='REJECT'?'btn-danger':'btn-ghost')+'" style="flex:1;justify-content:center" onclick="setReviewAction(\'REJECT\')">\u2715 Reject</button>';
  body+='</div><input type="hidden" id="rvAction" value="'+(defaultAction||'APPROVE')+'"></div>';
  body+='<div class="form-group"><label>Admin Notes (visible to all parties)</label><textarea id="rvNotes" placeholder="Reason for your decision\u2026"></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+swapId+'" onclick="submitReview(this)">Confirm Decision</button></div>';
  return modalWrap('Review Swap Request',body,'lg');
}
function setReviewAction(action){var inp=document.getElementById('rvAction');if(inp)inp.value=action;var a=document.getElementById('rvA'),r=document.getElementById('rvR');if(a){a.className='btn '+(action==='APPROVE'?'btn-success':'btn-ghost');a.style.cssText='flex:1;justify-content:center';}if(r){r.className='btn '+(action==='REJECT'?'btn-danger':'btn-ghost');r.style.cssText='flex:1;justify-content:center';}}
function submitReview(btn){
  var swapId=btn.getAttribute('data-id'),sw=getSwap(swapId);if(!sw)return;
  var action=(document.getElementById('rvAction')||{}).value;
  var notes=(document.getElementById('rvNotes')||{}).value||'';
  var u=state.currentUser;
  if(action==='APPROVE'){
    var rs=getShift(sw.requesterShiftId),recS=sw.receiverShiftId?getShift(sw.receiverShiftId):null;
    if(rs&&recS){var temp=rs.employeeId;rs.employeeId=recS.employeeId;recS.employeeId=temp;rs.updatedAt=recS.updatedAt=now();}
    else if(rs&&sw.receiverId){rs.employeeId=sw.receiverId;rs.updatedAt=now();}
    sw.status='APPROVED';
    addNotif(sw.requesterId,'Swap Approved','Your shift swap has been approved by management!','swap');
    if(sw.receiverId)addNotif(sw.receiverId,'Swap Approved','The swap you accepted has been approved by management!','swap');
  }else{
    sw.status='REJECTED';
    addNotif(sw.requesterId,'Swap Rejected','Your swap request was rejected.'+(notes?' Note: '+notes:''),'swap');
    if(sw.receiverId)addNotif(sw.receiverId,'Swap Rejected','The swap was rejected by management.','swap');
  }
  sw.adminNotes=notes;sw.reviewedById=u.id;sw.reviewedAt=now();sw.updatedAt=now();
  if(!sw.comments)sw.comments=[];
  sw.comments.push({userId:u.id,userName:u.name,role:u.role,message:(action==='APPROVE'?'\u2713 Approved':'\u2715 Rejected')+(notes?' — '+notes:''),timestamp:now()});
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_'+action+'D',entityType:'SwapRequest',entityId:swapId,createdAt:now()});
  toast('Swap '+(action==='APPROVE'?'approved':'rejected')+'.','success');closeModal();
}


// ─── REMAINING MODALS ─────────────────────────────────────────────
function renderEditAvailabilityModal(){
  var u=state.currentUser,cur=getUserAvailability(u.id);
  var body='<p style="font-size:13px;color:var(--text2);margin-bottom:16px">Set your recurring weekly availability. A manager will review before changes take effect.</p>';
  body+='<div class="form-group"><label>Reason / Notes (optional)</label><textarea id="availNotes" placeholder="Explain the reason for this change..."></textarea></div>';
  body+='<div style="margin-bottom:16px">';
  AVAIL_DAYS.forEach(function(wd){
    var rec=cur.find(function(a){return a.dayOfWeek===wd.idx;})||{isAvailable:false,startTime:'09:00',endTime:'17:00'};
    body+='<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">';
    body+='<div style="width:90px;font-size:13px;font-weight:600;color:var(--text)">'+wd.label+'</div>';
    body+='<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:var(--text2)"><input type="checkbox" id="avchk-'+wd.idx+'" '+(rec.isAvailable?'checked':'')+' onchange="availToggle('+wd.idx+')"> Available</label>';
    body+='<div id="avtimes-'+wd.idx+'" style="display:'+(rec.isAvailable?'flex':'none')+';gap:8px;align-items:center;margin-left:auto">';
    body+='<input type="time" id="avst-'+wd.idx+'" value="'+rec.startTime+'" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px">';
    body+='<span style="color:var(--text3);font-size:12px">to</span>';
    body+='<input type="time" id="avet-'+wd.idx+'" value="'+rec.endTime+'" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px">';
    body+='</div></div>';
  });
  body+='</div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAvailRequest()">Submit Request</button></div>';
  return modalWrap('Request Availability Change',body);
}
function availToggle(dayIdx){var chk=document.getElementById('avchk-'+dayIdx),times=document.getElementById('avtimes-'+dayIdx);if(times)times.style.display=(chk&&chk.checked)?'flex':'none';}
function submitAvailRequest(){
  var u=state.currentUser;
  var notes=((document.getElementById('availNotes')||{}).value||'').trim();
  if(DB.availRequests.some(function(r){return r.userId===u.id&&r.status==='PENDING';})){toast('You already have a pending availability request.','error');return;}
  var proposed=[],valid=true;
  AVAIL_DAYS.forEach(function(wd){
    var chk=document.getElementById('avchk-'+wd.idx),st=document.getElementById('avst-'+wd.idx),et=document.getElementById('avet-'+wd.idx);
    var avail=chk&&chk.checked,start=(st&&st.value)||'09:00',end=(et&&et.value)||'17:00';
    if(avail&&timeToMins(end)<=timeToMins(start)){toast('End time must be after start for '+wd.label,'error');valid=false;return;}
    proposed.push({dayOfWeek:wd.idx,startTime:start,endTime:end,isAvailable:avail});
  });
  if(!valid||proposed.length!==7)return;
  var req={id:nextId('avr'),userId:u.id,status:'PENDING',proposedAvailability:proposed,notes:notes,reviewedBy:null,reviewedAt:null,createdAt:now(),updatedAt:now()};
  DB.availRequests.push(req);
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Availability Request',u.name+' submitted an availability change request.','info');});
  toast('Availability change request submitted.','success');closeModal();
}
function renderRejectAvailModal(id){
  var r=getAvReq(id),emp=r?getUser(r.userId):null;if(!r||!emp)return'';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px"><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'\'s request</div><div style="font-size:12px;color:var(--text2);margin-top:4px">'+(r.notes?esc(r.notes):'No notes')+'</div></div>';
  body+='<div class="form-group"><label>Reason for Rejection</label><textarea id="rejectAvailNotes" placeholder="Explain why..."></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" data-id="'+id+'" onclick="rejectAvailSubmit(this)">Reject Request</button></div>';
  return modalWrap('Reject Availability Request',body);
}
function rejectAvailSubmit(btn){
  var id=btn.getAttribute('data-id'),r=getAvReq(id);if(!r)return;
  var notes=((document.getElementById('rejectAvailNotes')||{}).value||'').trim();
  r.status='REJECTED';r.reviewedBy=state.currentUser.id;r.reviewedAt=now();r.updatedAt=now();
  addNotif(r.userId,'Availability Rejected','Your availability change was not approved.'+(notes?' Reason: '+notes:''),'info');
  toast('Request rejected.','info');closeModal();
}
function renderCreateTimeOffModal(){
  var u=state.currentUser,today=todayStr();
  var body='<div class="form-row"><div class="form-group"><label>Start Date *</label><input type="date" id="toStart" value="'+today+'" min="'+today+'"></div><div class="form-group"><label>End Date *</label><input type="date" id="toEnd" value="'+today+'" min="'+today+'"></div></div>';
  body+='<div class="form-group"><label>Request Type *</label><div style="display:flex;gap:10px;margin-top:6px"><button id="toBtnSick" class="btn btn-amber" style="flex:1;justify-content:center" onclick="setTOType(\'sick\')">\uD83E\uDD12 Sick</button><button id="toBtnUnpaid" class="btn btn-ghost" style="flex:1;justify-content:center" onclick="setTOType(\'unpaid\')">\uD83D\uDCBC Unpaid</button></div><input type="hidden" id="toType" value="sick"></div>';
  body+='<div class="form-group"><label>Notes (optional)</label><textarea id="toNotes" placeholder="Additional context..."></textarea></div>';
  body+='<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Digital Signature</div><div style="font-size:12px;color:var(--text3);margin-bottom:10px">By typing your full name you confirm this request is accurate.</div><div class="form-group" style="margin-bottom:0"><label>Type your full legal name *</label><input id="toSig" placeholder="'+esc(u.name)+'" autocomplete="off"></div></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitTimeOff()">Submit Request</button></div>';
  return modalWrap('Request Time Off',body);
}
function setTOType(type){var inp=document.getElementById('toType');if(inp)inp.value=type;var s=document.getElementById('toBtnSick'),u=document.getElementById('toBtnUnpaid');if(s){s.className='btn '+(type==='sick'?'btn-amber':'btn-ghost');s.style.cssText='flex:1;justify-content:center';}if(u){u.className='btn '+(type==='unpaid'?'btn-brand':'btn-ghost');u.style.cssText='flex:1;justify-content:center';}}
function submitTimeOff(){
  var u=state.currentUser;
  var start=((document.getElementById('toStart')||{}).value||'').trim(),end=((document.getElementById('toEnd')||{}).value||'').trim();
  var type=(document.getElementById('toType')||{}).value||'sick';
  var notes=((document.getElementById('toNotes')||{}).value||'').trim();
  var sig=((document.getElementById('toSig')||{}).value||'').trim();
  if(!start||!end){toast('Start and end dates are required.','error');return;}
  if(end<start){toast('End date must be on or after start date.','error');return;}
  if(!sig){toast('Digital signature (your full name) is required.','error');return;}
  if(sig.toLowerCase()!==u.name.toLowerCase()){toast('Signature must match your full name: "'+u.name+'".','error');return;}
  if(DB.timeOffRequests.some(function(r){return r.userId===u.id&&r.status!=='REJECTED'&&r.status!=='CANCELLED'&&r.startDate<=end&&r.endDate>=start;})){toast('You already have a request for an overlapping period.','error');return;}
  var req={id:nextId('to'),userId:u.id,startDate:start,endDate:end,type:type,notes:notes,digitalSignatureName:sig,submittedAt:now(),status:'PENDING',reviewedBy:null,reviewedAt:null,adminNotes:'',createdAt:now(),updatedAt:now()};
  DB.timeOffRequests.push(req);
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Time-Off Request',u.name+' submitted a '+type+' time-off request ('+start+' to '+end+').','info');});
  toast('Time-off request submitted.','success');closeModal();
}
function renderRejectTOModal(id){
  var r=getTOReq(id),emp=r?getUser(r.userId):null;if(!r||!emp)return'';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px"><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'\'s request</div><div style="font-size:13px;color:var(--text2);margin-top:4px">'+fmtDateLabel(r.startDate)+' \u2192 '+fmtDateLabel(r.endDate)+' \u00B7 '+esc(r.type)+'</div>'+(r.notes?'<div style="font-size:12px;color:var(--text3);margin-top:4px">'+esc(r.notes)+'</div>':'')+'</div>';
  body+='<div class="form-group"><label>Reason for Rejection</label><textarea id="rejectTONotes" placeholder="Explain why..."></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" data-id="'+id+'" onclick="rejectTOSubmit(this)">Reject Request</button></div>';
  return modalWrap('Reject Time-Off Request',body);
}
function rejectTOSubmit(btn){
  var id=btn.getAttribute('data-id'),r=getTOReq(id);if(!r)return;
  var notes=((document.getElementById('rejectTONotes')||{}).value||'').trim();
  r.status='REJECTED';r.reviewedBy=state.currentUser.id;r.reviewedAt=now();r.updatedAt=now();r.adminNotes=notes;
  addNotif(r.userId,'Time Off Rejected','Your time-off request was not approved.'+(notes?' Reason: '+notes:''),'info');
  toast('Time-off request rejected.','info');closeModal();
}
function renderClaimOpenShiftModal(){
  var m=state.modal,osId=m&&m.data&&m.data.id;
  var os=DB.openShifts.find(function(s){return s.id===osId;});if(!os)return'';
  var body='<div style="border-radius:10px;padding:14px;margin-bottom:18px;border:1px solid rgba(255,255,255,.07);background:'+esc(os.taskColor||'#6366f1')+'">';
  body+='<div style="color:#fff;font-size:15px;font-weight:700">'+fmtDateLabel(os.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:14px;margin-top:4px">'+fmtRange(os.startTime,os.endTime)+'</div>';
  body+='<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:4px">'+esc(os.taskName||'Shift')+'</div>';
  if(os.notes)body+='<div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:6px">\uD83D\uDCDD '+esc(os.notes)+'</div>';
  body+='</div>';
  body+='<div class="form-group"><label>How would you like to take this shift?</label><div style="display:flex;gap:10px;margin-top:8px">';
  body+='<button id="claimTakeBtn" class="btn btn-primary" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'take\')"><div style="font-weight:700;margin-bottom:4px">\u2795 Take Shift</div><div style="font-size:11px;opacity:.7;font-weight:400">Extra work — no swap needed</div></button>';
  body+='<button id="claimSwapBtn" class="btn btn-ghost" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'swap\')"><div style="font-weight:700;margin-bottom:4px">\uD83D\uDD04 Take + Swap</div><div style="font-size:11px;opacity:.7;font-weight:400">Take it and propose to swap one of yours</div></button>';
  body+='</div><input type="hidden" id="claimType" value="take"></div>';
  body+='<div id="swapShiftSection" style="display:none" class="form-group"><label>Which of your shifts to swap?</label><select id="swapShiftId"><option value="">Select a shift...</option>';
  var myShifts=DB.shifts.filter(function(s){return s.employeeId===state.currentUser.id&&s.date>=todayStr();});
  myShifts.forEach(function(s){body+='<option value="'+s.id+'">'+fmtDateLabel(s.date)+' '+fmtRange(s.startTime,s.endTime)+' - '+esc(s.taskName||'Shift')+'</option>';});
  body+='</select></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-osid="'+osId+'" onclick="submitClaimOpenShift(this)">Submit Claim</button></div>';
  return modalWrap('Claim Open Shift',body);
}
function setClaimType(type){
  var inp=document.getElementById('claimType');if(inp)inp.value=type;
  var take=document.getElementById('claimTakeBtn'),swap=document.getElementById('claimSwapBtn'),sec=document.getElementById('swapShiftSection');
  if(take){take.className='btn '+(type==='take'?'btn-primary':'btn-ghost');take.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center';}
  if(swap){swap.className='btn '+(type==='swap'?'btn-brand':'btn-ghost');swap.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center';}
  if(sec)sec.style.display=type==='swap'?'block':'none';
}
function submitClaimOpenShift(btn){
  var osId=btn.getAttribute('data-osid'),os=DB.openShifts.find(function(s){return s.id===osId;});
  if(!os||os.status!=='OPEN'){toast('This shift is no longer available.','error');return;}
  var type=(document.getElementById('claimType')||{}).value||'take';
  var swapShiftId=type==='swap'?((document.getElementById('swapShiftId')||{}).value||null):null;
  os.status='PENDING';os.claimedBy=state.currentUser.id;os.claimType=type;os.swapShiftId=swapShiftId||null;
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Open Shift Claimed',state.currentUser.name+' wants to take the open shift on '+os.date+'.','info');});
  toast('Claim submitted! Awaiting manager approval.','success');closeModal();
}
function renderCreateOpenShiftModal(){
  var today=todayStr();
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var body='<div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="osDate" value="'+today+'" min="'+today+'"></div><div class="form-group"><label>Task *</label><select id="osTask"><option value="">Select task...</option>';
  activeTasks.forEach(function(t){body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'">'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="osStart" value="09:00"></div><div class="form-group"><label>End Time *</label><input type="time" id="osEnd" value="17:00"></div></div>';
  body+='<div class="form-group"><label>Notes</label><textarea id="osNotes" placeholder="Details about this shift..."></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createOpenShift()">Post Open Shift</button></div>';
  return modalWrap('Post Open Shift',body);
}
function createOpenShift(){
  var date=(document.getElementById('osDate')||{}).value||'';
  var taskVal=(document.getElementById('osTask')||{}).value||'';
  var start=(document.getElementById('osStart')||{}).value||'';
  var end=(document.getElementById('osEnd')||{}).value||'';
  var notes=(document.getElementById('osNotes')||{}).value||'';
  if(!date){toast('Date is required.','error');return;}
  if(!taskVal){toast('Please select a task.','error');return;}
  if(!start||!end){toast('Times are required.','error');return;}
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start.','error');return;}
  var tp=taskVal.split('|');
  DB.openShifts.push({id:nextId('os'),date:date,startTime:start,endTime:end,taskId:tp[0],taskName:tp[1],taskColor:tp[2],notes:notes,createdById:state.currentUser.id,createdAt:now(),status:'OPEN',claimedBy:null,claimType:null,swapShiftId:null,approvedBy:null,approvedAt:null,comments:[]});
  DB.users.filter(function(x){return x.role==='EMPLOYEE'&&x.status==='ACTIVE';}).forEach(function(emp){addNotif(emp.id,'New Open Shift','A new open shift is available on '+date+' ('+fmtRange(start,end)+' \u00B7 '+tp[1]+').','info');});
  toast('Open shift posted.','success');closeModal();
}
function renderCreateUserModal(){
  var body='<div class="form-row"><div class="form-group"><label>Full Name *</label><input id="uName" placeholder="Jane Smith" autocomplete="off"></div><div class="form-group"><label>Email Address *</label><input type="email" id="uEmail" placeholder="jane@company.com" autocomplete="off"></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Password *</label><input type="password" id="uPass" placeholder="Min 8 chars, 1 uppercase, 1 number"></div><div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createUser()">Create User</button></div>';
  return modalWrap('Create User',body);
}
function createUser(){
  var name=((document.getElementById('uName')||{}).value||'').trim(),email=((document.getElementById('uEmail')||{}).value||'').trim().toLowerCase();
  var pass=(document.getElementById('uPass')||{}).value||'',role=(document.getElementById('uRole')||{}).value||'EMPLOYEE';
  if(!name){toast('Full name is required.','error');return;}
  if(!validateEmail(email)){toast('Enter a valid email address.','error');return;}
  var pwErr=validatePassword(pass);if(pwErr){toast(pwErr,'error');return;}
  if(DB.users.find(function(u){return u.email.toLowerCase()===email;})){toast('Email already registered.','error');return;}
  var col=AV_COLORS[DB.users.length%AV_COLORS.length];
  var user={id:nextId('u'),name:name,email:email,password:pass,role:role,status:'ACTIVE',avatarColor:col,createdAt:now()};
  DB.users.push(user);
  AVAIL_DAYS.forEach(function(wd){DB.availability.push({id:nextId('av'),userId:user.id,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false});});
  toast('User '+name+' created.','success');closeModal();
}
function renderEditUserModal(id){
  var u=getUser(id);if(!u)return modalWrap('User Not Found','<p style="color:var(--text2)">User not found.</p><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var body='<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px;background:var(--bg3);border-radius:10px"><div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div><div style="font-weight:700;font-size:15px">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Full Name</label><input id="uName" value="'+esc(u.name)+'"></div><div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE"'+(u.role==='EMPLOYEE'?' selected':'')+'>Employee</option><option value="MANAGER"'+(u.role==='MANAGER'?' selected':'')+'>Manager</option><option value="ADMIN"'+(u.role==='ADMIN'?' selected':'')+'>Admin</option></select></div></div>';
  body+='<div class="form-group"><label>New Password <span style="color:var(--text3);font-size:11px">(leave blank to keep current)</span></label><input type="password" id="uPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"></div>';
  body+='<div class="form-group"><label>Email <span style="color:var(--text3);font-size:11px">(cannot be changed)</span></label><input value="'+esc(u.email)+'" disabled style="opacity:.4;cursor:not-allowed"></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+id+'" onclick="updateUserSubmit(this)">Save Changes</button></div>';
  return modalWrap('Edit User',body);
}
function updateUserSubmit(btn){updateUser(btn.getAttribute('data-id')||'');}
function updateUser(id){
  var u=getUser(id);if(!u)return;
  var name=((document.getElementById('uName')||{}).value||'').trim(),role=(document.getElementById('uRole')||{}).value;
  var pass=(document.getElementById('uPass')||{}).value||'';
  if(!name){toast('Name cannot be empty.','error');return;}
  if(pass){var err=validatePassword(pass);if(err){toast(err,'error');return;}u.password=pass;}
  u.name=name;u.role=role;toast('User updated.','success');closeModal();
}

// ─── EXPOSE + BOOT ────────────────────────────────────────────────
var expose = [
  'navigate','logout','handleLogin','handleRegister',
  'changeWeek','changeMonth','goToday','setView','setSwapFilter','setScheduleScope',
  'openModal','closeModal','pickTaskColor',
  'viewShift','editShiftBtn','createShift','updateShift','deleteShiftConfirm',
  'addShiftComment',
  'createSwapSubmit','createSwap','setRespondAction','submitRespond','setReviewAction','submitReview',
  'respondSwapBtn','reviewSwapBtn','cancelSwapBtn','addSwapComment',
  'createUser','updateUser','updateUserSubmit','toggleStatusBtn','editUserBtn','filterUsers','setAdminTab',
  'toggleNotif','markAllRead','readNotifBtn',
  'saveProfile','savePassword',
  'setAvailTab','approveAvailBtn','availToggle','submitAvailRequest','rejectAvailSubmit',
  'setTOTab','approveTOBtn','setTOType','submitTimeOff','rejectTOSubmit',
  'approveOpenShift','rejectOpenShift','removeOpenShift','submitClaimOpenShift','setClaimType','createOpenShift','addOpenShiftComment',
  'setSettingsTab','toggleSetting','setSettingNum','toggleTaskActive','createTask','updateTask',
  'executePublish',
];
var fns={navigate:navigate,logout:logout,handleLogin:handleLogin,handleRegister:handleRegister,changeWeek:changeWeek,changeMonth:changeMonth,goToday:goToday,setView:setView,setSwapFilter:setSwapFilter,setScheduleScope:setScheduleScope,openModal:openModal,closeModal:closeModal,pickTaskColor:pickTaskColor,viewShift:viewShift,editShiftBtn:editShiftBtn,createShift:createShift,updateShift:updateShift,deleteShiftConfirm:deleteShiftConfirm,addShiftComment:addShiftComment,createSwapSubmit:createSwapSubmit,createSwap:createSwap,setRespondAction:setRespondAction,submitRespond:submitRespond,setReviewAction:setReviewAction,submitReview:submitReview,respondSwapBtn:respondSwapBtn,reviewSwapBtn:reviewSwapBtn,cancelSwapBtn:cancelSwapBtn,addSwapComment:addSwapComment,createUser:createUser,updateUser:updateUser,updateUserSubmit:updateUserSubmit,toggleStatusBtn:toggleStatusBtn,editUserBtn:editUserBtn,filterUsers:filterUsers,setAdminTab:setAdminTab,toggleNotif:toggleNotif,markAllRead:markAllRead,readNotifBtn:readNotifBtn,saveProfile:saveProfile,savePassword:savePassword,setAvailTab:setAvailTab,approveAvailBtn:approveAvailBtn,availToggle:availToggle,submitAvailRequest:submitAvailRequest,rejectAvailSubmit:rejectAvailSubmit,setTOTab:setTOTab,approveTOBtn:approveTOBtn,setTOType:setTOType,submitTimeOff:submitTimeOff,rejectTOSubmit:rejectTOSubmit,approveOpenShift:approveOpenShift,rejectOpenShift:rejectOpenShift,removeOpenShift:removeOpenShift,submitClaimOpenShift:submitClaimOpenShift,setClaimType:setClaimType,createOpenShift:createOpenShift,addOpenShiftComment:addOpenShiftComment,setSettingsTab:setSettingsTab,toggleSetting:toggleSetting,setSettingNum:setSettingNum,toggleTaskActive:toggleTaskActive,createTask:createTask,updateTask:updateTask,executePublish:executePublish};
expose.forEach(function(name){ window[name]=fns[name]; });

render();

})(); // end IIFE — ShiftWise v6.0
