'use strict';
// ===================================================================
// ShiftWise v7.0 — Unified Request Engine + Gantt Schedule + Notification Drawer
// Architecture: All requests flow through DB.requests[] with unified schema.
// New: Request Engine, Gantt week view, notification drawer (right-side),
//      visibility/public-private, createdByRole attribution, cancel flow,
//      swap comment locking, open shift/swap global visibility split.
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
// Gantt config
var GANTT_START = 6;  // 6 AM
var GANTT_END   = 24; // midnight
var GANTT_W     = 100; // percentage width = 100%

// ─── EARLY UTILITIES ──────────────────────────────────────────────
function now()     { return new Date().toISOString(); }
function fmtDate(d){ return d.toISOString().slice(0,10); }
function todayStr(){ return fmtDate(new Date()); }
function nextId(p) { return p+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function addNotif(uid,title,msg,type,linkRef){
  DB.notifications.unshift({
    id:nextId('n'), userId:uid, type:type||'info', title:title, message:msg,
    read:false, createdAt:now(), linkRef:linkRef||null
  });
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
  tasks: [
    {id:'t1',name:'Skate Guard',    color:'#6366f1',description:'Ice surface supervision and guest safety.',active:true},
    {id:'t2',name:'Skate Rental',   color:'#10b981',description:'Skate fitting, rental, and returns.',active:true},
    {id:'t3',name:'House League',   color:'#f59e0b',description:'Organize and supervise house league games.',active:true},
    {id:'t4',name:'Concessions',    color:'#ef4444',description:'Food and beverage service.',active:true},
    {id:'t5',name:'Facility Ops',   color:'#3b82f6',description:'General facility maintenance and operations.',active:true},
    {id:'t6',name:'Event Staff',    color:'#a855f7',description:'Special events and programming support.',active:false},
  ],
  // Live and preview shifts (not requests — they are scheduled assignments)
  shifts:        [],
  previewShifts: [],
  // v7: UNIFIED REQUEST ENGINE
  // All requests: availability, timeOff, swap, openShift
  // {id, type, userId, userName, status, visibility, createdByRole, data:{}, comments:[], createdAt, updatedAt}
  requests: [],
  // legacy availability slots (not requests — just the recurring schedule)
  availability:  [],
  notifications: [],
  auditLog:      [],
  settings: {
    maxShiftsPerDay:2, minRestHours:8, overlapWarnings:true,
    openSwapsEnabled:true, swapApprovalRequired:true, swapExpiryDays:7,
    notifySwaps:true, notifyApprovals:true, notifySchedulePublish:true,
  },
  // v7 attendance: track absence-only; presence is the default assumption
  // [{id, shiftId, employeeId, date, status, reason, notes, markedById, markedAt}]
  attendanceLog: [],
};

// ─── AUTO-EXPIRE OPEN SWAPS (3-day rule) ─────────────────────────
function expireOpenSwaps(){
  var THREE_DAYS=3*864e5;
  DB.requests.forEach(function(r){
    if(r.type!=='swap'||r.visibility!=='public'||r.status!=='pending') return;
    if(Date.now()-new Date(r.createdAt).getTime()>=THREE_DAYS){
      r.status='rejected';r.updatedAt=now();
      addNotif(r.userId,'Open Swap Expired',
        'Your open swap request expired after 3 days with no interest.',
        'info','openswaps');
      DB.auditLog.push({id:nextId('a'),userId:r.userId,
        action:'OPEN_SWAP_EXPIRED',entityType:'Request',entityId:r.id,createdAt:now()});
    }
  });
}

// ─── REQUEST ENGINE HELPERS ────────────────────────────────────────
function getReq(id){ return DB.requests.find(function(r){return r.id===id;}); }
function getReqsByType(type){ return DB.requests.filter(function(r){return r.type===type;}); }
function getReqsByUser(uid){ return DB.requests.filter(function(r){return r.userId===uid;}); }
function reqRoleFromUser(u){ return u ? u.role.toLowerCase() : 'employee'; }

// Create a unified request
function createRequest(type, userId, data, visibility, comments) {
  var u = getUser(userId);
  var req = {
    id: nextId('rq'),
    type: type,
    userId: userId,
    userName: u ? u.name : 'Unknown',
    status: 'pending',
    visibility: visibility || 'private',
    createdByRole: reqRoleFromUser(u),
    data: data || {},
    comments: comments || [],
    createdAt: now(),
    updatedAt: now(),
  };
  DB.requests.push(req);
  return req;
}

// Can a user see a request?
function canSeeRequest(req, user) {
  if (!user) return false;
  if (req.visibility === 'public') return true;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if (req.userId === user.id) return true;
  // Swap: receiver can also see it
  if (req.type === 'swap' && req.data && req.data.receiverId === user.id) return true;
  return false;
}

// Are comments locked on this request?
function commentsLocked(req) {
  return req.status === 'approved' || req.status === 'rejected' || req.status === 'cancelled' || req.status === 'expired';
}


// ─── SEED: SHIFTS ─────────────────────────────────────────────────
(function seedShifts() {
  var today=new Date();today.setHours(0,0,0,0);
  var dow=(today.getDay()+6)%7;
  var mon=new Date(today);mon.setDate(today.getDate()-dow);
  var tpl=[
    {emp:'u3',task:'t1',st:'08:00',et:'16:00',days:[0,2,4]},
    {emp:'u3',task:'t2',st:'12:00',et:'20:00',days:[1,3]},
    {emp:'u4',task:'t3',st:'07:00',et:'15:00',days:[0,1,2]},
    {emp:'u4',task:'t5',st:'15:00',et:'23:00',days:[3,4]},
    {emp:'u5',task:'t1',st:'09:00',et:'17:00',days:[0,2,3]},
    {emp:'u5',task:'t4',st:'14:00',et:'22:00',days:[1,4]},
  ];
  var id=1;
  tpl.forEach(function(t){
    var task=DB.tasks.find(function(tk){return tk.id===t.task;})||DB.tasks[0];
    [0,1].forEach(function(w){t.days.forEach(function(d){
      var dt=new Date(mon);dt.setDate(mon.getDate()+d+w*7);
      DB.shifts.push({id:'s'+(id++),employeeId:t.emp,createdById:'u1',
        date:fmtDate(dt),startTime:t.st,endTime:t.et,
        taskId:task.id,taskName:task.name,taskColor:task.color,
        notes:'',employeeComments:[],createdAt:now(),updatedAt:now()});
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

// ─── SEED: PREVIEW SHIFTS ─────────────────────────────────────────
(function seedPreview() {
  var next=new Date();next.setDate(next.getDate()+14);next.setHours(0,0,0,0);
  var dow=(next.getDay()+6)%7;
  var mon=new Date(next);mon.setDate(next.getDate()-dow);
  var tks=[DB.tasks[0],DB.tasks[1],DB.tasks[2]];
  var id=1;
  [['u3',0],['u4',1],['u5',2]].forEach(function(r,i){
    var dt=new Date(mon);dt.setDate(mon.getDate()+i);
    var tk=tks[i];
    DB.previewShifts.push({id:'ps'+(id++),employeeId:r[0],createdById:'u1',
      date:fmtDate(dt),startTime:'08:00',endTime:'16:00',
      taskId:tk.id,taskName:tk.name,taskColor:tk.color,
      notes:'Preview — not yet published.',employeeComments:[],
      createdAt:now(),updatedAt:now()});
  });
})();

// ─── SEED: AVAILABILITY slots ─────────────────────────────────────
(function seedAvailability() {
  ['u3','u4','u5'].forEach(function(uid){
    [1,2,3,4,5].forEach(function(d){DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:true});});
    [0,6].forEach(function(d){DB.availability.push({id:nextId('av'),userId:uid,dayOfWeek:d,startTime:'08:00',endTime:'22:00',isAvailable:false});});
  });
})();

// ─── SEED: REQUESTS (unified engine) ──────────────────────────────
(function seedRequests() {
  // 1. Availability change request — private, by employee Jamie (u3)
  var avReq = createRequest('availability', 'u3', {
    notes: 'Starting evening classes on Fridays — need Fridays off.',
    proposedAvailability: [
      {dayOfWeek:1,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:2,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:3,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:4,startTime:'08:00',endTime:'22:00',isAvailable:true},
      {dayOfWeek:5,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:6,startTime:'08:00',endTime:'22:00',isAvailable:false},
      {dayOfWeek:0,startTime:'08:00',endTime:'22:00',isAvailable:false},
    ]
  }, 'private', []);
  addNotif('u1','Availability Request','Jamie Park submitted an availability change request.','request','availability');
  addNotif('u2','Availability Request','Jamie Park submitted an availability change request.','request','availability');

  // 2. Time-off request — private, by employee Sam (u4)
  var nw=new Date();nw.setDate(nw.getDate()+7);
  var nw2=new Date(nw);nw2.setDate(nw.getDate()+2);
  var toReq = createRequest('timeOff', 'u4', {
    startDate: fmtDate(nw), endDate: fmtDate(nw2),
    type: 'sick', notes: 'Scheduled medical procedure.',
    digitalSignatureName: 'Sam Torres', submittedAt: now(),
  }, 'private', []);
  addNotif('u1','Time-Off Request','Sam Torres submitted a time-off request.','request','timeoff');
  addNotif('u2','Time-Off Request','Sam Torres submitted a time-off request.','request','timeoff');

  // 3. Swap request — private visibility, between employees
  var rs = DB.shifts.find(function(s){return s.employeeId==='u3'&&s.date>=todayStr();});
  var recS = DB.shifts.find(function(s){return s.employeeId==='u4'&&s.date>=todayStr()&&(!rs||s.date!==rs.date);});
  if (rs && recS) {
    var swReq = createRequest('swap', 'u3', {
      receiverId: 'u4',
      requesterShiftId: rs.id,
      receiverShiftId: recS.id,
      message: 'Can we swap? I have a dentist appointment.',
      adminNotes: '', responseMessage: '', responseBy: null, responseAt: null,
      expiresAt: new Date(Date.now()+7*864e5).toISOString(),
      reviewedById: null, reviewedAt: null,
    }, 'private', [{
      userId:'u3', userName:'Jamie Park', role:'EMPLOYEE',
      message:'Hope this works for you, Sam!', timestamp:now()
    }]);
    addNotif('u4','Swap Request','Jamie Park requested a shift swap with you.','swap','swaps');
  }

  // 4. Open shift — PUBLIC, posted by admin (u1)
  var tom=new Date();tom.setDate(tom.getDate()+2);tom.setHours(0,0,0,0);
  var tk=DB.tasks[1];
  var osReq = createRequest('openShift', 'u1', {
    date: fmtDate(tom), startTime: '10:00', endTime: '18:00',
    taskId: tk.id, taskName: tk.name, taskColor: tk.color,
    notes: 'Flexible shift, any qualified team member.',
    status: 'OPEN', claimedBy: null, claimType: null, swapShiftId: null,
    approvedBy: null, approvedAt: null,
  }, 'public', []);
  // Notify all active employees
  DB.users.filter(function(u){return u.status==='ACTIVE'&&u.role==='EMPLOYEE';}).forEach(function(emp){
    addNotif(emp.id,'New Open Shift','A Skate Rental shift is available on '+fmtDate(tom)+'.','info','openshift');
  });

  // 5. Employee-posted OPEN SWAP (public marketplace) — Casey (u5) wants coverage
  var caseyShift=DB.shifts.find(function(s){return s.employeeId==='u5'&&s.date>=todayStr();});
  if(caseyShift){
    createRequest('swap','u5',{
      receiverId:null,requesterShiftId:caseyShift.id,receiverShiftId:null,
      message:'Anyone available to cover this shift? Family commitment.',
      adminNotes:'',responseMessage:'',responseBy:null,responseAt:null,
      openSwap:true,
      expiresAt:new Date(Date.now()+7*864e5).toISOString(),
      reviewedById:null,reviewedAt:null,
    },'public',[]);
    DB.users.filter(function(x){return x.status==='ACTIVE'&&x.id!=='u5';}).forEach(function(emp){
      addNotif(emp.id,'Open Swap Available','Casey Nguyen posted a shift to the open swap marketplace.','swap','requests');
    });
  }

  // 6. Coverage request (NOT a swap) - Sam (u4) needs coverage, no exchange
  var samCovShift=DB.shifts.find(function(s){return s.employeeId==='u4'&&s.date>=todayStr();});
  if(samCovShift){
    createRequest('coverage','u4',{
      requesterShiftId:samCovShift.id,
      exchangeRequired:false,
      message:'I have a medical appointment and need someone to cover this shift.',
      status:'OPEN',
    },'public',[]);
    DB.users.filter(function(x){return x.status==='ACTIVE'&&x.id!=='u4';}).forEach(function(emp){
      addNotif(emp.id,'Coverage Needed','Sam Torres needs coverage for a shift.','info','openshift');
    });
  }
})();

// ─── STATE ────────────────────────────────────────────────────────
var state = {
  currentUser:   null,
  page:          'login',
  modal:         null,
  view:          'week',     // week(gantt)|list|month
  weekOffset:    0,
  monthOffset:   0,
  filterEmp:     'all',
  scheduleScope: 'full',     // full | mine
  requestFilter: 'all',      // all|pending|approved|rejected|cancelled
  requestTypeFilter: 'all',  // all|availability|timeOff|swap|openShift
  adminTab:      'users',
  notifOpen:     false,
  notifFilter:   'all',      // all|unread|requests|swaps
  searchUser:    '',
  availTab:      'overview', // overview|requests
  settingsTab:   'tasks',
};


// ─── ESCAPE LISTENER ──────────────────────────────────────────────
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
function getShift(id){return DB.shifts.find(function(s){return s.id===id;})||DB.previewShifts.find(function(s){return s.id===id;});}
function getTask(id){return DB.tasks.find(function(t){return t.id===id;});}
function initials(n){return n.split(' ').map(function(x){return x[0];}).slice(0,2).join('').toUpperCase();}
function isAdminOrMgr(){return state.currentUser&&(state.currentUser.role==='ADMIN'||state.currentUser.role==='MANAGER');}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function validatePassword(pw){if(!pw||pw.length<8)return'Password must be at least 8 characters.';if(!/[A-Z]/.test(pw))return'Must include an uppercase letter.';if(!/[0-9]/.test(pw))return'Must include a number.';return null;}
function validateEmail(em){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);}
function shiftsOverlap(s1,e1,s2,e2){return timeToMins(s1)<timeToMins(e2)&&timeToMins(e1)>timeToMins(s2);}
function hasConflict(eid,date,s,e,excl,arr){
  return (arr||DB.shifts).some(function(sh){return sh.employeeId===eid&&sh.date===date&&sh.id!==excl&&shiftsOverlap(s,e,sh.startTime,sh.endTime);});
}
function isOnApprovedTimeOff(empId,date){
  return DB.requests.some(function(r){return r.type==='timeOff'&&r.userId===empId&&r.status==='approved'&&r.data.startDate<=date&&r.data.endDate>=date;});
}
function getUserAvailability(userId){
  return AVAIL_DAYS.map(function(wd){
    return DB.availability.find(function(a){return a.userId===userId&&a.dayOfWeek===wd.idx;})||
           {userId:userId,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false};
  });
}
// Role badge
function roleBadgeHtml(role){
  if(role==='ADMIN'||role==='admin')   return ' <span class="comment-role-badge badge-admin-role">Admin</span>';
  if(role==='MANAGER'||role==='manager')return ' <span class="comment-role-badge badge-manager-role">Manager</span>';
  return '';
}
// Task badge
function taskBadgeHtml(n,c){return'<span class="task-badge" style="background:'+esc(c||'#6366f1')+'"><span class="task-dot"></span>'+esc(n||'Shift')+'</span>';}
// Request source badge
function reqSourceBadge(createdByRole){
  var cls={employee:'req-source-employee',manager:'req-source-manager',admin:'req-source-admin'}[createdByRole]||'req-source-employee';
  return'<span class="req-source-badge '+cls+'">'+esc(createdByRole||'employee')+'</span>';
}
// Visibility badge
function visibilityBadge(vis){
  var cls=vis==='public'?'req-vis-public':'req-vis-private';
  return'<span class="req-visibility-badge '+cls+'">'+esc(vis||'private')+'</span>';
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
  if(!validateEmail(email)){toast('Please enter a valid email.','error');return;}
  var u=DB.users.find(function(x){return x.email.toLowerCase()===email.toLowerCase();});
  if(!u){toast('No account found with that email.','error');return;}
  if(u.status==='INACTIVE'){toast('This account has been deactivated.','error');return;}
  if(u.password!==pass){toast('Incorrect password.','error');return;}
  state.currentUser=u;state.page='dashboard';
  addNotif(u.id,'Welcome back','Signed in as '+u.name+'.','info',null);
  render();
}
function handleLogin(){var em=document.getElementById('loginEmail'),pw=document.getElementById('loginPass');if(em&&pw)login(em.value.trim(),pw.value);}
function handleRegister(){
  var name=((document.getElementById('regName')||{}).value||'').trim();
  var email=((document.getElementById('regEmail')||{}).value||'').trim().toLowerCase();
  var pw=(document.getElementById('regPass')||{}).value||'';
  var pw2=(document.getElementById('regPass2')||{}).value||'';
  if(!name){toast('Full name is required.','error');return;}
  if(!validateEmail(email)){toast('Enter a valid email.','error');return;}
  var pwe=validatePassword(pw);if(pwe){toast(pwe,'error');return;}
  if(pw!==pw2){toast('Passwords do not match.','error');return;}
  if(DB.users.find(function(u){return u.email.toLowerCase()===email;})){toast('Email already registered.','error');return;}
  var col=AV_COLORS[DB.users.length%AV_COLORS.length];
  var user={id:nextId('u'),name:name,email:email,password:pw,role:'EMPLOYEE',status:'ACTIVE',avatarColor:col,createdAt:now()};
  DB.users.push(user);
  AVAIL_DAYS.forEach(function(wd){DB.availability.push({id:nextId('av'),userId:user.id,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false});});
  DB.auditLog.push({id:nextId('a'),userId:user.id,action:'USER_REGISTERED',entityType:'User',entityId:user.id,createdAt:now()});
  state.currentUser=user;state.page='dashboard';
  addNotif(user.id,'Welcome to ShiftWise','Your account has been created.','info',null);
  toast('Welcome, '+name.split(' ')[0]+'!','success');render();
}
function logout(){state.currentUser=null;state.page='login';state.notifOpen=false;state.modal=null;render();}
function navigate(page){state.page=page;state.notifOpen=false;state.modal=null;render();}

// ─── WEEK / MONTH HELPERS ─────────────────────────────────────────
function getWeekMon(off){var d=new Date();d.setHours(0,0,0,0);var dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow+(off||0)*7);return d;}
function getWeekDays(off){var m=getWeekMon(off),r=[];for(var i=0;i<7;i++){var d=new Date(m);d.setDate(m.getDate()+i);r.push(d);}return r;}
function weekLabel(off){var d=getWeekDays(off);return MONTHS[d[0].getMonth()]+' '+d[0].getDate()+' \u2013 '+MONTHS[d[6].getMonth()]+' '+d[6].getDate()+', '+d[6].getFullYear();}
function getMonthDays(off){
  var n=new Date();n.setHours(0,0,0,0);
  var y=n.getFullYear(),m=n.getMonth()+off;
  while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}
  var first=new Date(y,m,1),last=new Date(y,m+1,0),days=[];
  var sd=(first.getDay()+6)%7;
  for(var i=0;i<sd;i++){var d2=new Date(first);d2.setDate(1-sd+i);days.push({date:d2,otherMonth:true});}
  for(var i=1;i<=last.getDate();i++)days.push({date:new Date(y,m,i),otherMonth:false});
  while(days.length%7!==0){var d3=new Date(days[days.length-1].date);d3.setDate(d3.getDate()+1);days.push({date:d3,otherMonth:true});}
  return{days:days,year:y,month:m};
}
function monthLabel(off){var md=getMonthDays(off);return MONTHS[md.month]+' '+md.year;}
function getVisibleShifts(arr){
  var u=state.currentUser,shifts=(arr||DB.shifts).slice();
  if(isAdminOrMgr()){if(state.filterEmp!=='all')shifts=shifts.filter(function(s){return s.employeeId===state.filterEmp;});}
  else if(state.scheduleScope==='mine')shifts=shifts.filter(function(s){return s.employeeId===u.id;});
  return shifts;
}
function getWeekShifts(off,arr){var dates=getWeekDays(off).map(fmtDate);return getVisibleShifts(arr).filter(function(s){return dates.indexOf(s.date)!==-1;});}


// ─── RENDER CORE ──────────────────────────────────────────────────
function render(){
  var app=document.getElementById('app');if(!app)return;
  expireOpenSwaps(); // auto-expire stale open swaps
  if(state.page==='login'){app.innerHTML=renderLogin();var pw=document.getElementById('loginPass');if(pw)pw.onkeydown=function(e){if(e.key==='Enter')handleLogin();};return;}
  if(state.page==='register'){app.innerHTML=renderRegister();var rp=document.getElementById('regPass2');if(rp)rp.onkeydown=function(e){if(e.key==='Enter')handleRegister();};return;}
  if(!state.currentUser){state.page='login';render();return;}
  var html='<div class="app">'+renderSidebar()+renderMain()+'</div>';
  if(state.notifOpen)html+=renderNotifDrawer();
  if(state.modal)html+=renderModal();
  app.innerHTML=html;
}
function renderLogin(){
  return'<div class="login-screen"><div class="login-card">'+
    '<div class="login-logo"><div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>'+
    '<div class="login-logo-title">ShiftWise</div><div class="login-subtitle">Workforce Operations Platform</div></div>'+
    '<div class="form-group"><label>Email Address</label><input type="email" id="loginEmail" placeholder="you@company.com" autocomplete="email"></div>'+
    '<div class="form-group"><label>Password</label><input type="password" id="loginPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="current-password"></div>'+
    '<button class="login-btn" onclick="handleLogin()">Sign In</button>'+
    '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">Don\'t have an account? <a href="#" onclick="navigate(\'register\');return false;" style="color:var(--brand2);font-weight:600;">Create account</a></div>'+
    '</div></div>';
}
function renderRegister(){
  return'<div class="login-screen"><div class="login-card" style="max-width:440px">'+
    '<div class="login-logo"><div class="logo-mark" style="width:52px;height:52px;border-radius:14px;font-size:20px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center">SW</div>'+
    '<div class="login-logo-title">Create Account</div></div>'+
    '<div class="form-group"><label>Full Name *</label><input id="regName" placeholder="Jane Smith" autocomplete="name"></div>'+
    '<div class="form-group"><label>Email Address *</label><input type="email" id="regEmail" placeholder="you@company.com" autocomplete="email"></div>'+
    '<div class="form-row"><div class="form-group"><label>Password *</label><input type="password" id="regPass" placeholder="Min 8 chars" autocomplete="new-password"></div>'+
    '<div class="form-group"><label>Confirm *</label><input type="password" id="regPass2" placeholder="Repeat" autocomplete="new-password"></div></div>'+
    '<button class="login-btn" onclick="handleRegister()">Create Account</button>'+
    '<div style="text-align:center;margin-top:18px;font-size:13px;color:var(--text2)">Already have an account? <a href="#" onclick="navigate(\'login\');return false;" style="color:var(--brand2);font-weight:600;">Sign in</a></div>'+
    '</div></div>';
}

// ─── SIDEBAR ──────────────────────────────────────────────────────
function renderSidebar(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var pages=[
    {id:'dashboard',   label:'Dashboard',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>'},
    {id:'schedule',    label:'Schedule',    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'},
    {id:'requests',    label:'Requests',    icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'},
    {id:'openshift',   label:'Marketplace', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>'},
    {id:'availability',label:'Availability',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'},
  ];
  if(isMgr){
    pages.push({id:'preview', label:'Preview',  icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'});
    pages.push({id:'settings',label:'Settings', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'});
    pages.push({id:'admin',   label:'Admin',   icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'});
  }
  // Badge counts
  // reqBadge: personal requests only (private swaps + avail + timeoff, excluding public open swaps)
  var pendingReqs=DB.requests.filter(function(r){
    if(r.type==='openShift') return false;
    if(r.type==='coverage'&&r.visibility==='public') return false;
    if(r.type==='swap'&&r.visibility==='public') return false; // those go to openswaps tab
    return r.status==='pending'&&(isMgr||(r.userId===u.id)||(r.type==='swap'&&r.data&&r.data.receiverId===u.id));
  });
  var reqBadge=pendingReqs.length;
  var openBadge=DB.requests.filter(function(r){
    return (r.type==='openShift'&&r.data&&r.data.status==='OPEN')||
           ((r.type==='swap'||r.type==='coverage')&&r.visibility==='public'&&r.status==='pending');
  }).length;
  var prevBadge=isMgr?DB.previewShifts.length:0;
  var html='<aside class="sidebar"><div class="logo"><div class="logo-mark" style="display:flex;align-items:center;justify-content:center">SW</div><span class="logo-text">ShiftWise</span></div><nav class="nav">';
  pages.forEach(function(p){
    var badge='';
    if(p.id==='requests'  && reqBadge>0)      badge='<span class="nav-badge">'+reqBadge+'</span>';
    if(p.id==='openshift' && openBadge>0)     badge='<span class="nav-badge">'+openBadge+'</span>';

    if(p.id==='preview'   && prevBadge>0)     badge='<span class="nav-badge">'+prevBadge+'</span>';
    html+='<div class="nav-item'+(state.page===p.id?' active':'')+'" onclick="navigate(\''+p.id+'\')">'+p.icon+' '+p.label+badge+'</div>';
  });
  html+='</nav><div class="sidebar-footer"><div class="user-chip" onclick="navigate(\'profile\')" title="My Profile"><div class="avatar" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div style="flex:1;min-width:0"><div class="user-name">'+esc(u.name)+'</div><div class="user-role-label">'+esc(u.role.toLowerCase())+'</div></div></div>';
  html+='<div class="nav-item" style="margin-top:2px;color:var(--text3)" onclick="logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign out</div>';
  html+='<div style="font-size:10px;color:var(--text3);text-align:center;padding:6px 0;opacity:.5">ShiftWise v7.0</div></div></aside>';
  return html;
}

// ─── TOPBAR ───────────────────────────────────────────────────────
function renderTopbar(){
  var u=state.currentUser;
  var unread=DB.notifications.filter(function(n){return n.userId===u.id&&!n.read;}).length;
  var titles={dashboard:'Dashboard',schedule:'Schedule',requests:'Requests',admin:'Admin Panel',profile:'Profile',availability:'Availability',openshift:'Shift Marketplace',settings:'Settings',preview:'Preview Schedule'};
  var extra='';
  if(state.page==='schedule'&&state.view==='list'&&isAdminOrMgr())
    extra='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Shift</button>';
  if(state.page==='preview'&&isAdminOrMgr())
    extra='<button class="btn btn-sm btn-primary" onclick="openModal(\'create-shift\',{preview:true})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Preview</button>';
  return'<header class="topbar"><span class="topbar-title">'+(titles[state.page]||'ShiftWise')+'</span>'+extra+
    '<button class="icon-btn" onclick="toggleNotif()" aria-label="Notifications">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>'+
    (unread>0?'<span class="notif-dot"></span>':'')+
    (unread>0?'<span style="position:absolute;top:2px;right:2px;background:var(--brand2);color:#fff;font-size:9px;font-weight:700;border-radius:8px;padding:0 4px;min-width:14px;text-align:center">'+unread+'</span>':'')+
    '</button></header>';
}
function renderMain(){return'<div class="main">'+renderTopbar()+'<div class="content">'+renderPage()+'</div></div>';}
function renderPage(){
  var map={dashboard:renderDashboard,schedule:renderSchedule,requests:renderRequests,
            admin:renderAdmin,profile:renderProfile,availability:renderAvailability,
            openshift:renderMarketplace,settings:renderSettings,preview:renderPreview};
  return(map[state.page]||renderDashboard)();
}


// ─── DASHBOARD ────────────────────────────────────────────────────
function renderDashboard(){
  var u=state.currentUser,isMgr=isAdminOrMgr(),today=todayStr();
  var allSh=isMgr?DB.shifts:DB.shifts.filter(function(s){return s.employeeId===u.id;});
  var todSh=allSh.filter(function(s){return s.date===today;});
  var pendReqs=DB.requests.filter(function(r){return r.status==='pending'&&r.type!=='openShift'&&(isMgr||r.userId===u.id||(r.data&&r.data.receiverId===u.id));});
  var openCnt=DB.requests.filter(function(r){return r.type==='openShift'&&r.data&&r.data.status==='OPEN';}).length;
  var wkD=getWeekDays(0).map(fmtDate);
  var wkSh=allSh.filter(function(s){return wkD.indexOf(s.date)!==-1;});
  var hr=new Date().getHours();var greet=hr<12?'Good morning':hr<18?'Good afternoon':'Good evening';
  var h='<div style="margin-bottom:24px"><div style="font-family:var(--font-display);font-size:22px;font-weight:700">'+greet+', '+esc(u.name.split(' ')[0])+' \uD83D\uDC4B</div>';
  h+='<div style="font-size:13px;color:var(--text2);margin-top:4px">'+new Date().toLocaleDateString('en',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'</div></div>';
  h+='<div class="stat-grid">';
  h+=statCard('Shifts This Week','cal',wkSh.length,'#6366f1','rgba(99,102,241,.12)');
  h+=statCard('Pending Requests','req',pendReqs.length,'#f59e0b','rgba(245,158,11,.12)');
  h+=statCard('Open Shifts','open',openCnt,'#a855f7','rgba(168,85,247,.12)');
  h+=statCard("Today's Shifts",'clock',todSh.length,'#10b981','rgba(16,185,129,.12)');
  h+='</div>';
  h+='<div class="dash-grid">';
  h+='<div class="card"><div class="card-header"><span class="card-title">Today\'s Shifts</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'schedule\')">View \u2192</button></div><div style="padding:0 16px 16px">';
  if(!todSh.length)h+='<div class="empty-state" style="padding:20px 0"><div class="empty-icon">\uD83D\uDCC5</div><div class="empty-title">No shifts today</div></div>';
  else todSh.forEach(function(s){
    var emp=getUser(s.employeeId);if(!emp)return;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(emp.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(s.startTime,s.endTime)+'</div>';
    h+=taskBadgeHtml(s.taskName,s.taskColor)+'</div><span class="badge badge-active">On shift</span></div>';
  });
  h+='</div></div>';
  h+='<div class="card"><div class="card-header"><span class="card-title">Pending Requests</span><button class="btn btn-xs btn-ghost" onclick="navigate(\'requests\')">View \u2192</button></div><div style="padding:0 16px 16px">';
  if(!pendReqs.length)h+='<div class="empty-state" style="padding:20px 0"><div class="empty-icon">\u2705</div><div class="empty-title">No pending requests</div></div>';
  else pendReqs.slice(0,5).forEach(function(r){
    var ru=getUser(r.userId);if(!ru)return;
    var typeLabel={availability:'Availability',timeOff:'Time Off',swap:'Swap',openShift:'Open Shift'}[r.type]||r.type;
    h+='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">';
    h+='<div class="avatar avatar-sm" style="background:'+esc(ru.avatarColor)+'">'+esc(initials(ru.name))+'</div>';
    h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(ru.name)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+typeLabel+' \u00B7 '+relTime(r.createdAt)+'</div></div>';
    h+='<span class="badge badge-pending">Pending</span></div>';
  });
  h+='</div></div></div>';
  return h;
}
function statCard(label,iconKey,val,color,bg){
  var icons={
    cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    req:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    open:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="9" y1="17" x2="15" y2="17"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  };
  return'<div class="stat-card"><div class="stat-icon" style="background:'+bg+';color:'+color+'">'+(icons[iconKey]||'')+'</div><div class="stat-value" style="color:'+color+'">'+val+'</div><div class="stat-label">'+label+'</div></div>';
}

// ─── SCHEDULE PAGE ────────────────────────────────────────────────
function renderSchedule(){
  var isMgr=isAdminOrMgr();
  var h='<div class="week-nav">';
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
  if(state.view==='week')h+=renderGanttView();
  else if(state.view==='list')h+=renderListView();
  else h+=renderMonthView();
  h+='</div>';
  return h;
}
function changeWeek(d){state.weekOffset+=d;render();}
function changeMonth(d){state.monthOffset+=d;render();}
function goToday(){state.weekOffset=0;state.monthOffset=0;render();}
function setView(v){state.view=v;render();}
function setScheduleScope(s){state.scheduleScope=s;render();}

// ── GANTT WEEK VIEW (replaces overlapping calendar) ───────────────
function renderGanttView(shiftsArr){
  var days=getWeekDays(state.weekOffset),today=todayStr();
  var allShifts=getWeekShifts(state.weekOffset,shiftsArr);
  var RANGE=GANTT_END-GANTT_START;
  var LABEL_W=140; // px width of left task-label column

  // Read-only banner
  var h='<div style="background:var(--bg3);border-bottom:1px solid var(--border);padding:8px 16px;font-size:11.5px;color:var(--text3);display:flex;align-items:center;gap:6px">';
  h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  h+='Week view is <strong>read-only</strong>. Switch to <button class="btn btn-xs btn-ghost" style="display:inline-flex;margin:0 2px" onclick="setView(\'list\')">List</button> view to create and edit shifts.';
  h+='</div>';

  // Collect which tasks appear this week
  var taskIds=[];
  allShifts.forEach(function(s){if(taskIds.indexOf(s.taskId)===-1)taskIds.push(s.taskId);});
  taskIds.sort(function(a,b){
    var ta=getTask(a),tb=getTask(b);
    return(ta?ta.name:'').localeCompare(tb?tb.name:'');
  });

  h+='<div class="gantt-wrapper">';

  // Shared hour ruler
  h+='<div style="display:flex;margin-bottom:6px">';
  h+='<div style="width:'+LABEL_W+'px;flex-shrink:0"></div>';
  h+='<div style="flex:1;position:relative;height:18px">';
  for(var hri=GANTT_START;hri<=GANTT_END;hri+=2){
    var pct=((hri-GANTT_START)/RANGE)*100;
    h+='<div style="position:absolute;left:'+pct+'%;font-size:9px;color:var(--text3);transform:translateX(-50%)">'+fmt12(hri+':00')+'</div>';
  }
  h+='</div></div>';

  function gridLines(){
    var g='';
    for(var ghi=GANTT_START;ghi<=GANTT_END;ghi+=2){
      var gp=((ghi-GANTT_START)/RANGE)*100;
      g+='<div style="position:absolute;left:'+gp+'%;top:0;bottom:0;width:1px;background:var(--border);opacity:.4;pointer-events:none"></div>';
    }
    return g;
  }

  // One section per day
  days.forEach(function(d){
    var ds=fmtDate(d),isToday=ds===today;
    var dayShifts=allShifts.filter(function(s){return s.date===ds;});

    h+='<div class="gantt-day-section">';
    h+='<div class="gantt-day-header" style="margin-bottom:8px">';
    h+=DAYS_SHORT[d.getDay()]+' '+MONTHS[d.getMonth()]+' '+d.getDate();
    if(isToday)h+=' <span class="gantt-today-badge">Today</span>';
    h+='</div>';

    if(!dayShifts.length){
      h+='<div class="gantt-empty-day" style="padding-left:'+LABEL_W+'px">No shifts scheduled</div>';
      h+='</div>';
      return;
    }

    // One row per task category
    taskIds.forEach(function(tid){
      var task=getTask(tid);
      var taskShifts=dayShifts.filter(function(s){return s.taskId===tid;});
      if(!taskShifts.length)return;

      var taskColor=task?task.color:'#888';
      var taskName=task?task.name:'Shift';

      taskShifts.sort(function(a,b){return timeToMins(a.startTime)-timeToMins(b.startTime);});
      var laneEnds=[];
      var laned=taskShifts.map(function(s){
        var sm=timeToMins(s.startTime),em=timeToMins(s.endTime);
        var lane=-1;
        for(var li=0;li<laneEnds.length;li++){if(laneEnds[li]<=sm){lane=li;break;}}
        if(lane===-1){lane=laneEnds.length;laneEnds.push(0);}
        laneEnds[lane]=em;
        return{s:s,sm:sm,em:em,lane:lane};
      });
      var laneCount=Math.max(1,laneEnds.length);
      var BAR_H=36,GAP=4;
      var rowH=laneCount*(BAR_H+GAP)+GAP;

      h+='<div style="display:flex;margin-bottom:6px;min-height:'+rowH+'px">';
      // Task label column
      h+='<div style="width:'+LABEL_W+'px;flex-shrink:0;display:flex;align-items:flex-start;padding-top:'+GAP+'px">';
      h+='<div style="display:flex;align-items:center;gap:6px">';
      h+='<div style="width:10px;height:10px;border-radius:50%;background:'+esc(taskColor)+';flex-shrink:0"></div>';
      h+='<span style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:118px">'+esc(taskName)+'</span>';
      h+='</div></div>';
      // Timeline area
      h+='<div style="flex:1;position:relative;height:'+rowH+'px;border-radius:6px">';
      h+=gridLines();
      laned.forEach(function(item){
        var s=item.s;
        var left=Math.max(0,((item.sm/60-GANTT_START)/RANGE)*100);
        var right=Math.min(100,((item.em/60-GANTT_START)/RANGE)*100);
        var width=Math.max(0.5,right-left);
        var top=GAP+item.lane*(BAR_H+GAP);
        var emp=getUser(s.employeeId);
        var onTO=isOnApprovedTimeOff(s.employeeId,ds);
        h+='<div class="gantt-bar" style="'+
          'position:absolute;left:'+left+'%;width:'+width+'%;top:'+top+'px;height:'+BAR_H+'px;'+
          'background:'+esc(taskColor)+(onTO?';opacity:.4':'')+'" '+
          'data-id="'+s.id+'" onclick="viewShift(this)" '+
          'title="'+esc(emp?emp.name:'?')+' \u00B7 '+esc(fmtRange(s.startTime,s.endTime))+'">';
        h+='<div style="overflow:hidden;white-space:nowrap">';
        h+='<div class="gantt-bar-label">'+(emp?esc(emp.name):'?')+'</div>';
        h+='<div class="gantt-bar-time">'+fmtRange(s.startTime,s.endTime)+'</div>';
        if(onTO)h+='<div style="font-size:8px;color:rgba(255,255,255,.9)">\u26D4 Time Off</div>';
        h+='</div></div>';
      });
      h+='</div></div>'; // close timeline + row
    });
    h+='</div>'; // close day section
  });

  h+='</div>'; // close gantt-wrapper
  return h;
}
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
      h+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+(isMgr?esc(emp.name)+' \u00B7 ':'')+fmtRange(s.startTime,s.endTime)+'</div>';
      h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">'+taskBadgeHtml(s.taskName,s.taskColor)+'</div>';
      if(s.notes)h+='<div style="font-size:11px;color:var(--text3);margin-top:2px">\uD83D\uDCCB '+esc(s.notes)+'</div>';
      if(onTO)h+='<div style="font-size:11px;color:var(--amber)">\u26A0 Approved time off</div>';
      if(s.employeeComments&&s.employeeComments.length)h+='<div style="font-size:11px;color:var(--text3);margin-top:2px">\uD83D\uDCAC '+s.employeeComments.length+' comment(s)</div>';
      h+='</div>';
      if(isMgr)h+='<button class="btn btn-xs btn-ghost" data-id="'+s.id+'" onclick="editShiftBtn(event,this)">Edit</button>';
      h+='</div>';
    });
    h+='</div>';
  });
  if(!hasAny)h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDCC5</div><div class="empty-title">No shifts this week</div></div>';
  h+='</div>';return h;
}

// ── MONTH VIEW ────────────────────────────────────────────────────
function renderMonthView(){
  var md=getMonthDays(state.monthOffset),today=todayStr();
  var allShifts=getVisibleShifts();
  var h='<div style="padding:12px"><div class="month-grid">';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(d){h+='<div class="month-day-head">'+d+'</div>';});
  md.days.forEach(function(cell){
    var ds=fmtDate(cell.date),isToday=ds===today;
    var dayShifts=allShifts.filter(function(s){return s.date===ds;});
    var taskCounts={};
    dayShifts.forEach(function(s){var k=s.taskId||'other';if(!taskCounts[k])taskCounts[k]={name:s.taskName||'Shift',color:s.taskColor||'#888',count:0};taskCounts[k].count++;});
    var keys=Object.keys(taskCounts);
    h+='<div class="month-cell'+(cell.otherMonth?' other-month':'')+(isToday?' today':'')+'">';
    h+='<div class="month-date-num'+(isToday?' today':'')+'">'+cell.date.getDate()+'</div>';
    keys.slice(0,3).forEach(function(k){var tc=taskCounts[k];h+='<div class="month-task-pill" style="background:'+esc(tc.color)+'">'+tc.count+' '+esc(tc.name)+'</div>';});
    if(keys.length>3)h+='<div class="month-more">+'+(keys.length-3)+' more</div>';
    h+='</div>';
  });
  h+='</div>';
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  h+='<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;padding:0 4px">';
  activeTasks.forEach(function(t){h+='<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2)"><div style="width:10px;height:10px;border-radius:50%;background:'+esc(t.color)+';flex-shrink:0"></div>'+esc(t.name)+'</div>';});
  h+='</div></div>';return h;
}

function viewShift(el){openModal('view-shift',{id:el.getAttribute('data-id')||''});}
function editShiftBtn(evt,el){evt.stopPropagation();openModal('edit-shift',{id:el.getAttribute('data-id')||''});}


// ─── UNIFIED REQUESTS PAGE ────────────────────────────────────────
function renderRequests(){
  // Requests tab = PERSONAL WORKFLOW ONLY
  // type: availability | timeOff | private swap
  // Public swaps → openswaps tab  |  openShift → openshift tab
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var personal=DB.requests.filter(function(r){
    if(r.type==='openShift') return false;
    if(r.type==='coverage'&&r.visibility==='public') return false;
    if(r.type==='swap'&&r.visibility==='public') return false;
    return canSeeRequest(r,u);
  });
  var types=[{id:'all',label:'All'},{id:'swap',label:'Swaps'},{id:'coverage',label:'Coverage'},{id:'availability',label:'Availability'},{id:'timeOff',label:'Time Off'}];
  var h='<div class="admin-tabs">';
  types.forEach(function(t){
    var cnt=t.id==='all'?personal.length:personal.filter(function(r){return r.type===t.id;}).length;
    h+='<button class="admin-tab'+(state.requestTypeFilter===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setReqTypeFilter(this)">'+t.label+(cnt>0?' <span style="opacity:.5;font-size:10px">('+cnt+')</span>':'')+' </button>';
  });
  h+='</div>';
  var statuses=['all','pending','approved','rejected','cancelled'];
  h+='<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">';
  statuses.forEach(function(s){h+='<button class="btn btn-xs '+(state.requestFilter===s?'btn-primary':'btn-ghost')+'" onclick="setReqFilter(\''+s+'\')">'+esc(s.charAt(0).toUpperCase()+s.slice(1))+'</button>';});
  h+='</div>';
  var filtered=personal.slice();
  if(state.requestTypeFilter!=='all')filtered=filtered.filter(function(r){return r.type===state.requestTypeFilter;});
  if(state.requestFilter!=='all')filtered=filtered.filter(function(r){return r.status===state.requestFilter;});
  filtered.reverse();
  if(!filtered.length){
    var hint=personal.length>0?'No requests match the current filter.':'No personal requests yet.';
    return h+'<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><div class="empty-title">'+hint+'</div></div>';
  }
  filtered.forEach(function(r){h+=renderRequestCard(r);});
  return h;
}
function setReqTypeFilter(el){state.requestTypeFilter=el.getAttribute('data-tab')||'all';render();}
function setReqFilter(s){state.requestFilter=s;render();}

function renderRequestCard(req){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var owner=getUser(req.userId);
  var isOwner=req.userId===u.id;
  var canApprove=isMgr&&req.status==='pending'&&!isOwner;
  var canCancel=isOwner&&['pending'].indexOf(req.status)!==-1;
  var h='<div class="request-card">';
  // Header
  h+='<div class="request-card-header">';
  h+='<div style="flex:1">';
  h+='<div class="request-card-meta">';
  h+=owner?'<div class="avatar avatar-sm" style="background:'+esc(owner.avatarColor)+';width:20px;height:20px;font-size:9px">'+esc(initials(owner.name))+'</div>':'';
  h+='<span style="font-size:13px;font-weight:600;color:var(--text)">'+(owner?esc(owner.name):'Unknown')+'</span>';
  h+=reqSourceBadge(req.createdByRole);
  h+=visibilityBadge(req.visibility);
  h+='<span style="font-size:11px;color:var(--text3)">'+relTime(req.createdAt)+'</span>';
  h+='</div>';
  // Type-specific summary
  h+='<div style="font-size:13px;color:var(--text2);margin-top:4px">'+reqSummary(req)+'</div>';
  if(req.data&&req.data.notes)h+='<div style="font-size:12px;color:var(--text3);margin-top:4px">'+esc(req.data.notes)+'</div>';
  h+='</div>';
  h+='<span class="badge badge-'+req.status+'" style="flex-shrink:0">'+esc(req.status.charAt(0).toUpperCase()+req.status.slice(1))+'</span>';
  h+='</div>';
  // Comments thread
  h+=renderReqComments(req);
  // Actions
  h+='<div class="swap-actions" style="margin-top:12px">';
  // Swap lifecycle: show approval only AFTER receiver has accepted
  var swapAccepted=req.type==='swap'&&req.data&&req.data.responseBy;
  var swapPendingAcceptance=req.type==='swap'&&req.status==='pending'&&!swapAccepted&&req.data&&(req.data.receiverId||req.visibility==='private');
  if(canApprove&&req.type!=='swap'){
    // Non-swap requests: approve directly
    h+='<button class="btn btn-success btn-sm" data-rid="'+req.id+'" onclick="approveRequest(this)">\u2713 Approve</button>';
    h+='<button class="btn btn-danger btn-sm" data-rid="'+req.id+'" onclick="openModal(\'reject-request\',{id:\''+req.id+'\'})">Reject</button>';
  }
  if(canApprove&&req.type==='swap'&&swapAccepted){
    // Swap approved only AFTER acceptance; also block if admin is involved
    var isInvolved=(u.id===req.userId)||(req.data&&req.data.receiverId===u.id);
    if(!isInvolved){
      h+='<button class="btn btn-success btn-sm" data-rid="'+req.id+'" onclick="openModal(\'confirm-swap-approve\',{id:\''+req.id+'\'})">\u2713 Finalize Swap</button>';
      h+='<button class="btn btn-danger btn-sm" data-rid="'+req.id+'" onclick="openModal(\'reject-request\',{id:\''+req.id+'\'})">Reject</button>';
    }
  }
  if(swapPendingAcceptance&&isAdminOrMgr()){
    h+='<span style="font-size:12px;color:var(--text3);font-style:italic">\u23F3 Awaiting employee acceptance</span>';
  }
  // Directed swap: named receiver gets accept/decline with confirmation modal
  if(req.type==='swap'&&req.visibility==='private'&&req.status==='pending'&&req.data&&req.data.receiverId===u.id&&!isOwner&&!swapAccepted){
    h+='<button class="btn btn-success btn-sm" data-rid="'+req.id+'" onclick="openModal(\'confirm-swap-accept\',{id:\''+req.id+'\'})">\u2713 Accept Swap</button>';
    h+='<button class="btn btn-danger btn-sm" data-rid="'+req.id+'" onclick="declineSwapReq(this)">\u2715 Decline</button>';
  }
  if(canCancel)h+='<button class="btn btn-cancel-req btn-sm" data-rid="'+req.id+'" onclick="openModal(\'cancel-request\',{id:\''+req.id+'\'})">Cancel Request</button>';
  h+='</div></div>';
  return h;
}
function reqSummary(req){
  if(req.type==='availability')return'Availability change request';
  if(req.type==='timeOff'){var d=req.data||{};return'Time Off: '+esc(d.startDate||'')+(d.startDate!==d.endDate?' \u2192 '+esc(d.endDate||''):'')+(d.type?' \u00B7 '+esc(d.type):'');}
  if(req.type==='swap'){
    var d=req.data||{};
    var rs=getShift(d.requesterShiftId),recS=d.receiverShiftId?getShift(d.receiverShiftId):null;
    var rec=d.receiverId?getUser(d.receiverId):null;
    return'Swap request'+(rec?' \u2192 '+esc(rec.name):'(open)')+(rs?' \u00B7 '+fmtDateLabel(rs.date)+' '+fmtRange(rs.startTime,rs.endTime):'');
  }
  return req.type;
}

// Comments component — threaded chat-style UI
function renderReqComments(req){
  var u=state.currentUser;
  var locked=commentsLocked(req);
  var comments=req.comments||[];

  // Container: fixed-height scrollable box + pinned input
  var h='<div style="margin-top:14px;border:1px solid var(--border);border-radius:10px;overflow:hidden">';

  // Thread header
  h+='<div style="padding:8px 14px;background:var(--bg3);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  h+='<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Thread';
  if(locked)h+=' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:middle"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
  h+='</span>';
  h+='<span style="font-size:11px;color:var(--text3)">'+comments.length+' message'+(comments.length!==1?'s':'')+'</span>';
  h+='</div>';

  // Scrollable message area
  h+='<div style="max-height:220px;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--bg2)">';

  if(!comments.length){
    h+='<div style="text-align:center;padding:20px 0;font-size:12px;color:var(--text3)">No messages yet'+(locked?'':' \u2014 start the conversation')+'</div>';
  }

  comments.forEach(function(c){
    var cu=getUser(c.userId);
    var isMe=(u&&c.userId===u.id);
    var isPriv=(c.role==='admin'||c.role==='ADMIN'||c.role==='manager'||c.role==='MANAGER');

    // Layout: my messages right-aligned, others left-aligned
    h+='<div style="display:flex;gap:8px;'+(isMe?'flex-direction:row-reverse':'')+'">';
    // Avatar
    h+='<div class="avatar avatar-sm" style="flex-shrink:0;background:'+(cu?esc(cu.avatarColor):'#888')+'">'+
        (cu?esc(initials(cu.name)):'?')+'</div>';
    // Bubble + meta
    h+='<div style="max-width:72%;min-width:80px">';
    // Name + role badge + time — mirrored alignment
    h+='<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;'+(isMe?'justify-content:flex-end;':'justify-content:flex-start;')+'">';
    if(!isMe)h+='<span style="font-size:11px;font-weight:700;color:var(--text)">'+esc(c.userName||'User')+'</span>';
    if(isPriv){
      var badge=c.role==='admin'||c.role==='ADMIN'?
        '<span class="comment-role-badge badge-admin-role">Admin</span>':
        '<span class="comment-role-badge badge-manager-role">Manager</span>';
      h+=badge;
    }
    if(isMe)h+='<span style="font-size:11px;font-weight:700;color:var(--text)">You</span>';
    h+='<span style="font-size:10px;color:var(--text3)">'+relTime(c.timestamp)+'</span>';
    h+='</div>';
    // Message bubble
    var bubbleBg=isMe?'var(--brand-bg)':isPriv?'rgba(239,68,68,.06)':'var(--bg3)';
    var bubbleBorder=isMe?'rgba(99,102,241,.3)':isPriv?'rgba(239,68,68,.15)':'var(--border)';
    var textColor=isMe?'var(--brand2)':isPriv?'var(--text)':'var(--text2)';
    h+='<div style="'+
        'background:'+bubbleBg+';'+
        'border:1px solid '+bubbleBorder+';'+
        'border-radius:'+(isMe?'12px 2px 12px 12px':'2px 12px 12px 12px')+';'+
        'padding:8px 12px;'+
        'font-size:13px;'+
        'color:'+textColor+';'+
        'line-height:1.5'+
        '">';
    h+=esc(c.message);
    h+='</div></div></div>';
  });

  h+='</div>'; // end scrollable area

  // Pinned input
  if(locked){
    h+='<div class="comments-locked" style="border-radius:0;border-top:1px solid var(--border);border-left:none;border-right:none;border-bottom:none">';
    h+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
    h+='Comments are locked \u2014 this request is '+req.status+'.';
    h+='</div>';
  } else {
    h+='<div style="padding:10px 12px;border-top:1px solid var(--border);background:var(--bg2);display:flex;gap:8px">';
    h+='<input id="reqComment-'+req.id+'" placeholder="Write a message\u2026" style="flex:1;font-size:13px">';
    h+='<button class="btn btn-sm btn-primary" data-rid="'+req.id+'" onclick="addReqComment(this)">Send</button>';
    h+='</div>';
  }

  h+='</div>'; // end container
  return h;
}
function addReqComment(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  if(commentsLocked(req)){toast('Comments are locked on resolved requests.','error');return;}
  var inp=document.getElementById('reqComment-'+rid);
  var msg=(inp&&inp.value||'').trim();if(!msg)return;
  var u=state.currentUser;
  req.comments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:msg,timestamp:now()});
  req.updatedAt=now();
  // Notify other participants
  if(req.userId!==u.id)addNotif(req.userId,'Comment Added',u.name+' commented on your '+req.type+' request.','info','requests');
  if(req.data&&req.data.receiverId&&req.data.receiverId!==u.id)addNotif(req.data.receiverId,'Swap Comment',u.name+' added a comment.','info','requests');
  if(inp)inp.value='';
  toast('Comment posted.','success');render();
}

// ── REQUEST ACTIONS ───────────────────────────────────────────────
function approveRequest(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  var u=state.currentUser;
  // Self-approval block: no one can approve their own requests
  if(req.userId===u.id){toast('Cannot approve your own request.','error');return;}
  // Admin/manager self-involvement block
  if(req.type==='swap'&&req.data){
    if(req.data.receiverId===u.id){toast('Cannot approve a swap you are a receiver in.','error');return;}
  }
  // Swap lifecycle guard: admin can only approve AFTER employee acceptance
  if(req.type==='swap'&&!req.data.responseBy){
    toast('Cannot approve: the other employee has not accepted this swap yet.','error');return;
  }
  req.status='approved';req.updatedAt=now();
  applyApprovedRequest(req);
  addNotif(req.userId,'Request Approved','Your '+req.type+' request has been approved.','info','requests');
  if(req.type==='swap'&&req.data.receiverId){
    addNotif(req.data.receiverId,'Swap Approved','The swap has been approved by management.','info','requests');
  }
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'REQUEST_APPROVED',entityType:'Request',entityId:rid,createdAt:now()});
  toast('Request approved.','success');render();
}
function applyApprovedRequest(req){
  if(req.type==='availability'&&req.data.proposedAvailability){
    req.data.proposedAvailability.forEach(function(pa){
      var ex=DB.availability.find(function(a){return a.userId===req.userId&&a.dayOfWeek===pa.dayOfWeek;});
      if(ex){ex.isAvailable=pa.isAvailable;ex.startTime=pa.startTime;ex.endTime=pa.endTime;}
      else DB.availability.push({id:nextId('av'),userId:req.userId,dayOfWeek:pa.dayOfWeek,startTime:pa.startTime,endTime:pa.endTime,isAvailable:pa.isAvailable});
    });
  }
  if(req.type==='swap'){
    var d=req.data||{};
    var rs=getShift(d.requesterShiftId),recS=d.receiverShiftId?getShift(d.receiverShiftId):null;
    if(rs&&recS){var tmp=rs.employeeId;rs.employeeId=recS.employeeId;recS.employeeId=tmp;rs.updatedAt=recS.updatedAt=now();}
    else if(rs&&d.receiverId){rs.employeeId=d.receiverId;rs.updatedAt=now();}
    if(d.receiverId)addNotif(d.receiverId,'Swap Approved','The swap has been approved by management.','info','requests');
  }
}
function acceptSwapReq(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  var u=state.currentUser;
  var d=req.data||{};
  var rs=getShift(d.requesterShiftId);
  if(rs&&hasConflict(u.id,rs.date,rs.startTime,rs.endTime,d.receiverShiftId)){toast('You have a conflicting shift on that date.','error');return;}
  d.responseMessage='Accepted';d.responseBy=u.id;d.responseAt=now();
  // Move to pending admin review (status stays 'pending' but data indicates accepted)
  req.comments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:'\u2713 Accepted swap request. Awaiting manager approval.',timestamp:now()});
  req.updatedAt=now();
  addNotif(req.userId,'Swap Accepted',u.name+' accepted your swap. Awaiting manager approval.','swap','requests');
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Swap Needs Review',getUser(req.userId).name+' and '+u.name+' swap awaiting approval.','swap','requests');});
  toast('Swap accepted. Pending manager approval.','success');render();
}
function declineSwapReq(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  var u=state.currentUser;
  req.status='rejected';req.updatedAt=now();
  req.data.responseMessage='Declined';req.data.responseBy=u.id;req.data.responseAt=now();
  req.comments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:'\u2715 Declined swap request.',timestamp:now()});
  addNotif(req.userId,'Swap Declined',u.name+' declined your swap request.','swap','requests');
  toast('Swap declined.','info');render();
}
// Employee volunteers to take a public open swap
function volunteerOpenSwap(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  var u=state.currentUser;
  if(req.userId===u.id){toast('Cannot take your own swap.','error');return;}
  // Assign this employee as the receiver and move to accepted-pending-review
  req.data.receiverId=u.id;
  req.data.responseMessage='Volunteered to take this swap.';
  req.data.responseBy=u.id;
  req.data.responseAt=now();
  // Change to private now that a receiver is assigned; move to pending admin review
  req.visibility='private';
  req.data.openSwap=false;
  req.comments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),
    message:'\u2713 I can take this swap. Waiting for manager approval.',timestamp:now()});
  req.updatedAt=now();
  addNotif(req.userId,'Swap Volunteer',u.name+' volunteered to take your open swap. Awaiting manager approval.','swap','requests');
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){
    addNotif(mgr.id,'Open Swap Claimed',u.name+' and '+req.userName+' swap is ready for review.','swap','requests');
  });
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'OPEN_SWAP_TAKEN',entityType:'Request',entityId:rid,createdAt:now()});
  toast('You have volunteered for this swap! Awaiting manager approval.','success');render();
}


// ─── OPEN SHIFTS PAGE (globally visible, split by createdByRole) ──
// ─── SHIFT MARKETPLACE (unified: openShift + public swaps) ──────
// Routing rule: type=openShift OR (type=swap && visibility=public)
// Split by createdByRole only — not by system type
function renderMarketplace(){
  var u=state.currentUser,isMgr=isAdminOrMgr();

  // Collect all marketplace items
  var allItems=DB.requests.filter(function(r){
    return (r.type==='openShift'&&r.visibility==='public')||
           (r.type==='coverage'&&r.visibility==='public')||
           (r.type==='swap'&&r.visibility==='public');
  });

  // Pending claims on openShifts needing admin review
  var pendingClaims=allItems.filter(function(r){
    return r.type==='openShift'&&r.data&&r.data.status==='PENDING';
  });

  // Active marketplace pool (open, not yet claimed/approved)
  var active=allItems.filter(function(r){
    if(r.type==='openShift') return r.data&&r.data.status==='OPEN';
    return r.status==='pending'; // open swaps + coverage
  });

  var empPosted=active.filter(function(r){return r.createdByRole==='employee';});
  var mgrPosted=active.filter(function(r){return r.createdByRole==='manager'||r.createdByRole==='admin';});

  var h='';

  // Admin pending claims banner
  if(isMgr&&pendingClaims.length){
    h+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:16px;margin-bottom:20px">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:12px">\u26A0\uFE0F '+pendingClaims.length+' Open Shift Claim'+(pendingClaims.length!==1?'s':'')+' Awaiting Approval</div>';
    pendingClaims.forEach(function(r){
      var claimer=getUser(r.data&&r.data.claimedBy);
      h+='<div class="request-card" style="margin-bottom:8px">';
      h+='<div style="display:flex;align-items:center;justify-content:space-between">';
      h+='<div><div style="font-weight:600;color:var(--text)">'+fmtDateLabel(r.data.date)+' \u00B7 '+fmtRange(r.data.startTime,r.data.endTime)+'</div>';
      h+=taskBadgeHtml(r.data.taskName,r.data.taskColor);
      if(claimer)h+='<div style="font-size:12px;color:var(--text2);margin-top:4px">Claimed by <strong>'+esc(claimer.name)+'</strong></div>';
      h+='</div><div style="display:flex;gap:8px">';
      h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="approveOpenShiftReq(this)">\u2713 Approve</button>';
      h+='<button class="btn btn-danger btn-sm" data-rid="'+r.id+'" onclick="rejectOpenShiftReq(this)">\u2715 Return</button>';
      h+='</div></div></div>';
    });
    h+='</div>';
  }

  // Page header + post button
  h+='<div class="section-header"><div><div class="section-title">Shift Marketplace</div>';
  h+='<div style="font-size:13px;color:var(--text2);margin-top:2px">Open shifts and swap offers \u2014 visible to all employees</div></div>';
  if(isMgr)h+='<button class="btn btn-primary" onclick="openModal(\'create-openshift\',{})">+ Post Open Shift</button>';
  h+='</div>';

  if(!active.length){
    h+='<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">Marketplace is empty</div>';
    h+='<div class="empty-sub">No open shifts or swap offers right now.</div></div>';
    return h;
  }

  // \uD83D\uDFE3 Admin/Manager Posted section
  if(mgrPosted.length){
    h+='<div class="req-section-head"><div class="req-section-dot" style="background:#a855f7"></div>';
    h+='\uD83D\uDFE3 Admin / Manager Posted</div>';
    mgrPosted.slice().reverse().forEach(function(r){h+=renderMarketplaceCard(r);});
  }

  // 🔵 Employee Posted section
  if(empPosted.length){
    h+='<div class="req-section-head" style="margin-top:20px"><div class="req-section-dot" style="background:#10b981"></div>';
    h+='🔵 Employee Posted</div>';
    empPosted.slice().reverse().forEach(function(r){h+=renderMarketplaceCard(r);});
  }

  // Recently resolved/filled
  var resolved=allItems.filter(function(r){
    if(r.type==='openShift') return r.data&&r.data.status==='FILLED';
    return r.status==='approved'||r.status==='rejected'||r.status==='cancelled';
  }).slice(-5).reverse();
  if(resolved.length){
    h+='<div style="margin-top:28px"><div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Recently Resolved</div>';
    resolved.forEach(function(r){
      var owner=getUser(r.userId);
      var label=r.type==='openShift'?'Open Shift':r.type==='coverage'?'Coverage':'Open Swap';
      var statusLabel=r.type==='openShift'?'Filled':(r.status.charAt(0).toUpperCase()+r.status.slice(1));
      var badgeCls=r.type==='openShift'?'badge-active':'badge-'+r.status;
      h+='<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
      h+='<div style="display:flex;align-items:center;gap:8px">';
      if(owner)h+='<div class="avatar avatar-sm" style="background:'+esc(owner.avatarColor)+'">'+esc(initials(owner.name))+'</div>';
      h+='<div><div style="font-size:13px;color:var(--text2)">'+(owner?esc(owner.name):'?')+' \u00B7 '+label+'</div>';
      h+=reqSourceBadge(r.createdByRole)+'</div></div>';
      h+='<span class="badge '+badgeCls+'">'+statusLabel+'</span></div>';
    });
    h+='</div>';
  }
  return h;
}

// Unified marketplace card — handles both openShift and public swap types
function renderMarketplaceCard(r){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var isOwner=r.userId===u.id;
  var isOpenShift=r.type==='openShift';
  var isCoverage=r.type==='coverage';
  var isOpenSwap=r.type==='swap'&&r.visibility==='public';
  var owner=getUser(r.userId);
  var h='<div class="request-card">';

  // Meta row
  h+='<div class="request-card-header">';
  h+='<div style="flex:1">';
  h+='<div class="request-card-meta">';
  if(owner)h+='<div class="avatar avatar-sm" style="background:'+esc(owner.avatarColor)+';width:20px;height:20px;font-size:9px">'+esc(initials(owner.name))+'</div>';
  h+='<span style="font-size:13px;font-weight:600;color:var(--text)">'+(owner?esc(owner.name):'Unknown')+'</span>';
  h+=reqSourceBadge(r.createdByRole);
  h+='<span style="font-size:10px;background:var(--bg3);color:var(--text3);padding:2px 7px;border-radius:4px;font-weight:600">'+(isOpenShift?'Open Shift':isCoverage?'Coverage Request':'Open Swap')+'</span>';
  h+='<span style="font-size:11px;color:var(--text3)">'+relTime(r.createdAt)+'</span>';
  h+='</div>';

  // Shift details
  if(isOpenShift&&r.data){
    h+='<div style="margin-top:8px">';
    h+='<div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(r.data.date)+'</div>';
    h+='<div style="font-size:13px;color:var(--text2);margin-top:2px">'+fmtRange(r.data.startTime,r.data.endTime)+'</div>';
    h+=taskBadgeHtml(r.data.taskName,r.data.taskColor);
    if(r.data.notes)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCDD '+esc(r.data.notes)+'</div>';
    h+='</div>';
  }
  if(isCoverage&&r.data){
    var covShift=r.data.requesterShiftId?getShift(r.data.requesterShiftId):null;
    if(covShift){
      h+='<div style="margin-top:8px">';
      h+='<div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(covShift.date)+'</div>';
      h+='<div style="font-size:13px;color:var(--text2);margin-top:2px">'+fmtRange(covShift.startTime,covShift.endTime)+'</div>';
      h+=taskBadgeHtml(covShift.taskName,covShift.taskColor);
      h+='</div>';
    }
    if(r.data.message)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCAC '+esc(r.data.message)+'</div>';
  }
    if(isOpenSwap&&r.data){
    var rs=r.data.requesterShiftId?getShift(r.data.requesterShiftId):null;
    var recS=r.data.receiverShiftId?getShift(r.data.receiverShiftId):null;
    if(rs){
      h+='<div style="margin-top:8px">';
      h+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:4px">Shift being given up</div>';
      h+='<div style="background:var(--bg3);border-radius:8px;padding:10px 12px;display:inline-flex;flex-direction:column;gap:3px">';
      h+='<div style="font-size:13px;font-weight:700;color:var(--text)">'+fmtDateLabel(rs.date)+'</div>';
      h+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
      h+=taskBadgeHtml(rs.taskName,rs.taskColor);
      h+='</div>';
      if(recS){
        h+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-top:10px;margin-bottom:4px">In exchange for</div>';
        h+='<div style="background:var(--bg3);border-radius:8px;padding:10px 12px;display:inline-flex;flex-direction:column;gap:3px">';
        h+='<div style="font-size:13px;font-weight:700;color:var(--text)">'+fmtDateLabel(recS.date)+'</div>';
        h+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(recS.startTime,recS.endTime)+'</div>';
        h+=taskBadgeHtml(recS.taskName,recS.taskColor);
        h+='</div>';
      }
      h+='</div>';
    }
    if(r.data.message)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCAC '+esc(r.data.message)+'</div>';
  }
  h+='</div>';
  h+='<div style="flex-shrink:0">';
  if(isCoverage)h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0).toUpperCase()+r.status.slice(1)+'</span>';
  if(isOpenShift)h+='<span class="badge badge-'+(r.data&&r.data.status?r.data.status.toLowerCase():'open')+'">'+(r.data&&r.data.status?r.data.status:'Open')+'</span>';
  if(isOpenSwap)h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0).toUpperCase()+r.status.slice(1)+'</span>';
  h+='</div></div>';

  // Comment thread (public)
  h+=renderReqComments(r);

  // Actions
  h+='<div class="swap-actions" style="margin-top:12px">';
  if(isOpenShift&&!isOwner&&r.data&&r.data.status==='OPEN'){
    var conflict=hasConflict(u.id,r.data.date,r.data.startTime,r.data.endTime,null);
    if(!conflict){
      h+='<button class="btn btn-primary btn-sm" data-rid="'+r.id+'" onclick="openModal(\'accept-shift\',{rid:\''+r.id+'\',type:\'openshift\'})">Take Shift</button>';
    } else {
      h+='<span style="font-size:11px;color:var(--amber)">\u26A0 Scheduling conflict</span>';
    }
  }
  if(isCoverage&&!isOwner&&r.status==='pending'){
    h+='<button class="btn btn-primary btn-sm" data-rid="'+r.id+'" onclick="openModal(\'accept-shift\',{rid:\''+r.id+'\',type:\'coverage\'})">Take Shift</button>';
  }
  if(isOpenSwap&&!isOwner&&r.status==='pending'){
    h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="openModal(\'accept-shift\',{rid:\''+r.id+'\',type:\'openswap\'})">Take This Swap</button>';
  }
  if((isMgr||isOwner)&&((isOpenShift&&r.data&&r.data.status==='OPEN')||(isCoverage&&r.status==='pending')||(isOpenSwap&&r.status==='pending'))){
    h+='<button class="btn btn-ghost btn-xs" data-rid="'+r.id+'" onclick="removeMarketplaceItem(this)">Remove</button>';
  }
  h+='</div></div>';
  return h;
}

function removeMarketplaceItem(el){
  if(!confirm('Remove this item from the marketplace?'))return;
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  if(req.type==='openShift')req.data.status='cancelled';
  req.status='cancelled';req.updatedAt=now();
  toast('Removed from marketplace.','info');render();
}

// ─── OPEN SWAPS PAGE (public swap marketplace) ────────────────────
// type === "swap" && visibility === "public"
// Split by createdByRole: employee vs admin/manager
function renderOpenSwaps(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var allPublic=DB.requests.filter(function(r){
    return r.type==='swap'&&r.visibility==='public';
  });
  var active=allPublic.filter(function(r){return r.status==='pending';});
  var empPosted=active.filter(function(r){return r.createdByRole==='employee';});
  var mgrPosted=active.filter(function(r){return r.createdByRole==='manager'||r.createdByRole==='admin';});
  var resolved=allPublic.filter(function(r){return r.status!=='pending';});

  var h='<div class="section-header"><div><div class="section-title">Open Swap Marketplace</div>';
  h+='<div style="font-size:13px;color:var(--text2);margin-top:2px">Public swap board \u2014 visible to all employees</div></div></div>';

  if(!active.length&&!resolved.length){
    h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDD04</div><div class="empty-title">No open swaps</div>';
    h+='<div class="empty-sub">When an employee posts an open swap request it will appear here.</div></div>';
    return h;
  }

  // ── Admin/Manager Posted ───────────────────────────────────────
  if(mgrPosted.length){
    h+='<div class="req-section-head"><div class="req-section-dot" style="background:#a855f7"></div>';
    h+='\uD83D\uDFE3 Admin / Manager Posted</div>';
    mgrPosted.slice().reverse().forEach(function(r){h+=renderOpenSwapCard(r);});
  }

  // ── Employee Posted ────────────────────────────────────────────
  if(empPosted.length){
    h+='<div class="req-section-head" style="margin-top:20px"><div class="req-section-dot" style="background:#10b981"></div>';
    h+='🔵 Employee Posted</div>';
    empPosted.slice().reverse().forEach(function(r){h+=renderOpenSwapCard(r);});
  }

  // ── Recently resolved ─────────────────────────────────────────
  if(resolved.length){
    h+='<div style="margin-top:28px"><div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Recently Resolved</div>';
    resolved.slice(0,5).reverse().forEach(function(r){
      var owner=getUser(r.userId);
      var rs=r.data&&r.data.requesterShiftId?getShift(r.data.requesterShiftId):null;
      h+='<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
      h+='<div style="display:flex;align-items:center;gap:8px">';
      if(owner)h+='<div class="avatar avatar-sm" style="background:'+esc(owner.avatarColor)+'">'+esc(initials(owner.name))+'</div>';
      h+='<div><div style="font-size:13px;color:var(--text2)">'+(owner?esc(owner.name):'?')+(rs?' \u00B7 '+fmtDateLabel(rs.date)+' '+fmtRange(rs.startTime,rs.endTime):'')+'</div>';
      h+=reqSourceBadge(r.createdByRole)+'</div></div>';
      h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0).toUpperCase()+r.status.slice(1)+'</span>';
      h+='</div>';
    });
    h+='</div>';
  }
  return h;
}

function renderOpenSwapCard(r){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var owner=getUser(r.userId);
  var isOwner=r.userId===u.id;
  var rs=r.data&&r.data.requesterShiftId?getShift(r.data.requesterShiftId):null;

  var h='<div class="request-card">';
  // Header: source badge + visibility + owner info
  h+='<div class="request-card-header">';
  h+='<div style="flex:1">';
  h+='<div class="request-card-meta">';
  if(owner)h+='<div class="avatar avatar-sm" style="background:'+esc(owner.avatarColor)+';width:20px;height:20px;font-size:9px">'+esc(initials(owner.name))+'</div>';
  h+='<span style="font-size:13px;font-weight:600;color:var(--text)">'+(owner?esc(owner.name):'Unknown')+'</span>';
  h+=reqSourceBadge(r.createdByRole);
  h+=visibilityBadge(r.visibility);
  h+='<span style="font-size:11px;color:var(--text3)">'+relTime(r.createdAt)+'</span>';
  h+='</div>';
  // Shift details
  if(rs){
    h+='<div style="margin-top:8px;background:var(--bg3);border-radius:8px;padding:10px 12px;display:inline-flex;flex-direction:column;gap:3px">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--text)">'+fmtDateLabel(rs.date)+'</div>';
    h+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
    h+=taskBadgeHtml(rs.taskName,rs.taskColor);
    h+='</div>';
  }
  if(r.data&&r.data.message)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCAC '+esc(r.data.message)+'</div>';
  h+='</div>';
  h+='<span class="badge badge-'+r.status+'" style="flex-shrink:0">'+esc(r.status.charAt(0).toUpperCase()+r.status.slice(1))+'</span>';
  h+='</div>';
  // Comment thread
  h+=renderReqComments(r);
  // Actions
  h+='<div class="swap-actions" style="margin-top:12px">';
  if(!isOwner&&r.status==='pending'){
    h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="volunteerOpenSwap(this)">\u2713 Take This Swap</button>';
  }
  if((isMgr||isOwner)&&r.status==='pending'){
    h+='<button class="btn btn-cancel-req btn-sm" data-rid="'+r.id+'" onclick="openModal(\'cancel-request\',{id:\''+r.id+'\'})">Cancel</button>';
  }
  if(isMgr&&r.status==='pending'){
    h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="approveRequest(this)">\u2713 Approve</button>';
    h+='<button class="btn btn-danger btn-sm" data-rid="'+r.id+'" onclick="openModal(\'reject-request\',{id:\''+r.id+'\'})">Reject</button>';
  }
  h+='</div></div>';
  return h;
}

function renderOpenShifts(){
  var u=state.currentUser,isMgr=isAdminOrMgr();
  var allOpen=DB.requests.filter(function(r){return r.type==='openShift'&&r.visibility==='public';});
  var empPosted=allOpen.filter(function(r){return r.createdByRole==='employee';});
  var mgrPosted=allOpen.filter(function(r){return r.createdByRole==='manager'||r.createdByRole==='admin';});
  // Pending approvals (claimed but not yet approved)
  var pendingClaims=allOpen.filter(function(r){return r.data&&r.data.status==='PENDING';});
  var h='';
  // Admin: pending claims
  if(isMgr&&pendingClaims.length){
    h+='<div style="background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:16px;margin-bottom:24px">';
    h+='<div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:12px">\u26A0\uFE0F '+pendingClaims.length+' Claim'+(pendingClaims.length!==1?'s':'')+' Awaiting Approval</div>';
    pendingClaims.forEach(function(r){
      var claimer=getUser(r.data&&r.data.claimedBy);
      h+='<div class="request-card" style="margin-bottom:8px"><div style="display:flex;align-items:center;justify-content:space-between">';
      h+='<div><div style="font-weight:600;color:var(--text)">'+fmtDateLabel(r.data.date)+' \u00B7 '+fmtRange(r.data.startTime,r.data.endTime)+'</div>';
      h+=taskBadgeHtml(r.data.taskName,r.data.taskColor);
      if(claimer)h+='<div style="font-size:12px;color:var(--text2);margin-top:4px">Claimed by <strong>'+esc(claimer.name)+'</strong> \u00B7 '+(r.data.claimType==='take'?'Extra shift':'With swap')+'</div>';
      h+='</div><div style="display:flex;gap:8px">';
      h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="approveOpenShiftReq(this)">\u2713 Approve</button>';
      h+='<button class="btn btn-danger btn-sm" data-rid="'+r.id+'" onclick="rejectOpenShiftReq(this)">\u2715 Return to Pool</button>';
      h+='</div></div></div>';
    });
    h+='</div>';
  }
  h+='<div class="section-header"><div><div class="section-title">Open Shifts</div><div style="font-size:13px;color:var(--text2);margin-top:2px">All globally visible \u2014 public pool</div></div>';
  if(isMgr)h+='<button class="btn btn-primary" onclick="openModal(\'create-openshift\',{})">+ Post Open Shift</button>';
  h+='</div>';
  // Section: Admin/Manager Posted
  var openMgrList=mgrPosted.filter(function(r){return r.data&&r.data.status==='OPEN';});
  if(openMgrList.length){
    h+='<div class="req-section-head"><div class="req-section-dot" style="background:#a855f7"></div>\uD83D\uDFE3 Admin / Manager Posted</div>';
    openMgrList.forEach(function(r){h+=renderOpenShiftCard(r);});
  }
  // Section: Employee Posted
  var openEmpList=empPosted.filter(function(r){return r.data&&r.data.status==='OPEN';});
  if(openEmpList.length){
    h+='<div class="req-section-head" style="margin-top:20px"><div class="req-section-dot" style="background:#10b981"></div>🔵 Employee Posted</div>';
    openEmpList.forEach(function(r){h+=renderOpenShiftCard(r);});
  }
  if(!openMgrList.length&&!openEmpList.length){
    h+='<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No open shifts available</div><div class="empty-sub">All shifts are currently assigned.</div></div>';
  }
  // Recently Filled
  var filled=allOpen.filter(function(r){return r.data&&r.data.status==='FILLED';});
  if(filled.length){
    h+='<div style="margin-top:28px"><div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:14px">Recently Filled</div>';
    filled.slice(0,5).forEach(function(r){
      var claimer=getUser(r.data&&r.data.claimedBy);
      h+='<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
      h+='<div style="font-size:13px;color:var(--text2)">'+fmtDateLabel(r.data.date)+' \u00B7 '+fmtRange(r.data.startTime,r.data.endTime);
      h+=taskBadgeHtml(r.data.taskName,r.data.taskColor)+'</div>';
      h+='<div style="display:flex;align-items:center;gap:8px">';
      if(claimer)h+='<div class="avatar avatar-sm" style="background:'+esc(claimer.avatarColor)+'">'+esc(initials(claimer.name))+'</div><span style="font-size:12px;color:var(--text2)">'+esc(claimer.name)+'</span>';
      h+='<span class="badge badge-active">Filled</span></div></div>';
    });
    h+='</div>';
  }
  return h;
}
function renderOpenShiftCard(r){
  var u=state.currentUser;
  var conflict=hasConflict(u.id,r.data.date,r.data.startTime,r.data.endTime,null);
  var isOwner=r.userId===u.id;
  var isMgr=isAdminOrMgr();
  var h='<div class="request-card">';
  h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">';
  h+='<div>';
  h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'+reqSourceBadge(r.createdByRole)+visibilityBadge(r.visibility)+'</div>';
  h+='<div style="font-size:15px;font-weight:700;color:var(--text)">'+fmtDateLabel(r.data.date)+'</div>';
  h+='<div style="font-size:13px;color:var(--text2);margin-top:2px">'+fmtRange(r.data.startTime,r.data.endTime)+'</div>';
  h+=taskBadgeHtml(r.data.taskName,r.data.taskColor);
  if(r.data.notes)h+='<div style="font-size:12px;color:var(--text3);margin-top:6px">\uD83D\uDCDD '+esc(r.data.notes)+'</div>';
  h+='</div>';
  h+='<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">';
  if(!isOwner&&!conflict)h+='<button class="btn btn-primary btn-sm" data-rid="'+r.id+'" onclick="openModal(\'claim-openshift\',{id:\''+r.id+'\'})">Take Shift</button>';
  if(!isOwner&&conflict)h+='<span style="font-size:11px;color:var(--amber)">\u26A0 Scheduling conflict</span>';
  if(isMgr||isOwner)h+='<button class="btn btn-ghost btn-xs" data-rid="'+r.id+'" onclick="removeOpenShiftReq(this)">Remove</button>';
  h+='</div></div>';
  // Comment thread (public)
  h+=renderReqComments(r);
  h+='</div>';return h;
}
function approveOpenShiftReq(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req||!req.data)return;
  var newShift={id:nextId('s'),employeeId:req.data.claimedBy,createdById:state.currentUser.id,
    date:req.data.date,startTime:req.data.startTime,endTime:req.data.endTime,
    taskId:req.data.taskId,taskName:req.data.taskName,taskColor:req.data.taskColor,
    notes:req.data.notes||'',employeeComments:[],createdAt:now(),updatedAt:now()};
  DB.shifts.push(newShift);
  req.data.status='FILLED';req.data.approvedBy=state.currentUser.id;req.data.approvedAt=now();
  req.status='approved';req.updatedAt=now();
  addNotif(req.data.claimedBy,'Open Shift Approved','Your claim for the open shift on '+req.data.date+' has been approved!','info','schedule');
  toast('Open shift approved and assigned.','success');render();
}
function rejectOpenShiftReq(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req||!req.data)return;
  var claimer=getUser(req.data.claimedBy);
  req.data.status='OPEN';req.data.claimedBy=null;req.data.claimType=null;req.data.swapShiftId=null;
  req.updatedAt=now();
  if(claimer)addNotif(claimer.id,'Open Shift Returned','Your claim was not approved. Shift returned to pool.','info','openshift');
  toast('Claim rejected. Shift returned to pool.','info');render();
}
function removeOpenShiftReq(el){
  if(!confirm('Remove this open shift from the pool?'))return;
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  req.status='cancelled';req.updatedAt=now();
  toast('Open shift removed.','info');render();
}


// ─── NOTIFICATION DRAWER (right-side) ────────────────────────────
function toggleNotif(){state.notifOpen=!state.notifOpen;render();}
function setNotifFilter(f){state.notifFilter=f;render();}
function markAllRead(){var uid=state.currentUser.id;DB.notifications.filter(function(n){return n.userId===uid;}).forEach(function(n){n.read=true;});render();}
function readAndNavigate(el){
  var id=el.getAttribute('data-nid');
  var n=DB.notifications.find(function(x){return x.id===id;});
  if(n){n.read=true;if(n.linkRef)navigate(n.linkRef);}
  state.notifOpen=false;render();
}
function renderNotifDrawer(){
  var u=state.currentUser;
  var all=DB.notifications.filter(function(n){return n.userId===u.id;});
  var unread=all.filter(function(n){return !n.read;}).length;
  var filtered=all;
  if(state.notifFilter==='unread')filtered=all.filter(function(n){return !n.read;});
  else if(state.notifFilter==='requests')filtered=all.filter(function(n){return n.type==='request'||n.type==='info';});
  else if(state.notifFilter==='swaps')filtered=all.filter(function(n){return n.type==='swap';});
  else if(state.notifFilter==='tasks')filtered=all.filter(function(n){return n.type==='task';});
  var h='<div class="notif-drawer-overlay" onclick="toggleNotif()"></div>';
  h+='<div class="notif-drawer">';
  h+='<div class="notif-drawer-header">';
  h+='<div class="notif-drawer-title">Notifications'+(unread>0?' <span style="background:var(--brand-bg);color:var(--brand2);font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700">'+unread+'</span>':'')+'</div>';
  h+='<div style="display:flex;gap:6px">';
  if(unread>0)h+='<button class="btn btn-xs btn-ghost" onclick="markAllRead()">Mark all read</button>';
  h+='<button class="btn btn-xs btn-ghost" onclick="toggleNotif()">\u2715</button>';
  h+='</div></div>';
  // Filter tabs
  h+='<div class="notif-filter-tabs">';
  [['all','All'],['unread','Unread'],['requests','Requests'],['swaps','Swaps'],['tasks','Tasks']].forEach(function(t){
    h+='<button class="notif-filter-tab'+(state.notifFilter===t[0]?' active':'')+'" onclick="setNotifFilter(\''+t[0]+'\')">'+t[1]+'</button>';
  });
  h+='</div>';
  // Notification list
  h+='<div class="notif-drawer-list">';
  if(!filtered.length){h+='<div class="notif-drawer-empty">\uD83D\uDD14 No notifications here</div>';}
  else filtered.slice(0,50).forEach(function(n){
    h+='<div class="notif-drawer-item'+(n.read?'':' unread')+'" data-nid="'+n.id+'" onclick="readAndNavigate(this)">';
    h+='<div class="notif-drawer-dot" style="opacity:'+(n.read?0:1)+'"></div>';
    h+='<div class="notif-drawer-content">';
    h+='<div class="notif-drawer-item-title">'+esc(n.title)+'</div>';
    h+='<div class="notif-drawer-item-msg">'+esc(n.message)+'</div>';
    h+='<div class="notif-drawer-item-time">'+relTime(n.createdAt)+(n.linkRef?' \u00B7 '+esc(n.linkRef):'')+'</div>';
    h+='</div></div>';
  });
  h+='</div></div>';
  return h;
}

// ─── AVAILABILITY PAGE ────────────────────────────────────────────
function renderAvailability(){
  return isAdminOrMgr()?renderAvailabilityMgrView():renderAvailabilityEmployee();
}
function renderAvailabilityMgrView(){
  var h='<div style="margin-bottom:28px"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">My Availability</div><div style="font-size:12px;color:var(--text3)">Your personal recurring availability</div></div>';
  h+=renderAvailabilityEmployee();
  h+='<div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border)"><div style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">Team Availability Management</div>';var _pac=DB.requests.filter(function(r){return r.type==="availability"&&r.status==="pending";}).length;if(_pac>0)h+='<span style="background:var(--brand-bg);color:var(--brand2);font-size:11px;padding:2px 8px;border-radius:10px;font-weight:700;margin-left:8px">'+_pac+'</span>';h+='';
  h+=renderAvailabilityAdmin();h+='</div>';return h;
}

// Helper: render a 7-day availability grid from a proposedAvailability array (or live DB)
function availGridHtml(avail7, emphColor){
  // avail7 is an array of {dayOfWeek, startTime, endTime, isAvailable}
  // emphColor: color for the time text (green for current, amber for requested)
  var h='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
  AVAIL_DAYS.forEach(function(wd){
    var rec=avail7.find(function(a){return a.dayOfWeek===wd.idx;})||{isAvailable:false,startTime:'09:00',endTime:'17:00'};
    h+='<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:8px 4px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em">'+wd.label.slice(0,3)+'</div>';
    if(rec.isAvailable)h+='<div style="font-size:9px;color:'+(emphColor||'var(--green)')+';line-height:1.6">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>';
    else h+='<div style="font-size:10px;color:var(--text3);font-weight:500">Off</div>';
    h+='</div>';
  });
  return h+'</div>';
}

function renderAvailabilityEmployee(){
  var u=state.currentUser,myAvail=getUserAvailability(u.id);
  var myReqs=DB.requests.filter(function(r){return r.type==='availability'&&r.userId===u.id;}).slice().reverse();
  var hasPending=myReqs.some(function(r){return r.status==='pending';});
  var pendingReq=myReqs.find(function(r){return r.status==='pending';});
  var h='<div style="max-width:720px">';
  h+='<div class="section-header"><div><div class="section-title">My Weekly Availability</div></div>';
  if(!hasPending)h+='<button class="btn btn-primary" onclick="openModal(\'edit-availability\',{})">Request Change</button>';
  else h+='<span class="badge badge-pending">Change request pending</span>';
  h+='</div>';

  // Show ONLY pending requested change as primary — current is context only
  if(pendingReq&&pendingReq.data&&pendingReq.data.proposedAvailability){
    // Requested change is the primary display when pending
    h+='<div class="card" style="margin-bottom:14px;border:1px solid rgba(245,158,11,.3)">';
    h+='<div class="card-header" style="background:rgba(245,158,11,.06)">';
    h+='<span class="card-title" style="color:var(--amber)">\u23F0 Requested Availability <span style="font-size:11px;font-weight:400;color:var(--text3)">Pending review</span></span>';
    h+='</div>';
    h+='<div style="padding:12px 16px 16px">';
    h+=availGridHtml(pendingReq.data.proposedAvailability,'var(--amber)');
    if(pendingReq.data.notes)h+='<div style="font-size:12px;color:var(--text2);margin-top:10px;padding:8px 10px;background:var(--bg3);border-radius:8px">\uD83D\uDCAC '+esc(pendingReq.data.notes)+'</div>';
    h+='<div class="swap-actions" style="margin-top:10px">';
    h+='<button class="btn btn-cancel-req btn-sm" data-rid="'+pendingReq.id+'" onclick="openModal(\'cancel-request\',{id:\''+pendingReq.id+'\'})">Cancel Request</button>';
    h+='</div>';
    h+='</div></div>';
    // Current shown compactly below as context
    h+='<details style="margin-bottom:14px"><summary style="font-size:12px;color:var(--text3);cursor:pointer;padding:6px 0">View current schedule (before change)</summary>';
    h+='<div style="margin-top:8px">'+availGridHtml(myAvail,'var(--green)')+'</div></details>';
  } else {
    // No pending request — show current as primary
    h+='<div class="card" style="margin-bottom:14px">';
    h+='<div class="card-header"><span class="card-title">Current Availability</span></div>';
    h+='<div style="padding:12px 16px 16px">';
    h+=availGridHtml(myAvail,'var(--green)');
    h+='</div></div>';
  }

  // Past requests list
  var pastReqs=myReqs.filter(function(r){return r.status!=='pending';});
  if(pastReqs.length){
    h+='<div style="font-size:13px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Past Requests</div>';
    pastReqs.slice(0,4).forEach(function(r){
      h+='<div class="request-card" style="margin-bottom:8px">';
      h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      h+='<span style="font-size:13px;font-weight:600;color:var(--text)">Availability Change</span>';
      h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0).toUpperCase()+r.status.slice(1)+'</span></div>';
      if(r.data&&r.data.notes)h+='<div style="font-size:12px;color:var(--text2);margin-bottom:4px">'+esc(r.data.notes)+'</div>';
      h+='<div style="font-size:11px;color:var(--text3)">'+relTime(r.createdAt)+'</div>';
      if(r.data&&r.data.proposedAvailability){
        h+='<details style="margin-top:8px"><summary style="font-size:11.5px;color:var(--text3);cursor:pointer">View requested schedule</summary>';
        h+='<div style="margin-top:8px">'+availGridHtml(r.data.proposedAvailability,'var(--amber)')+'</div></details>';
      }
      h+='</div>';
    });
  }
  h+='</div>';return h;
}
function renderAvailabilityAdmin(){
  var tabs=[{id:'overview',label:'Team Overview'},{id:'requests',label:'Change Requests'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.availTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAvailTab(this)">'+t.label+'</button>';});
  h+='</div>';
  return h+(state.availTab==='overview'?renderAvailOverview():renderAvailAdminReqs());
}
function setAvailTab(el){state.availTab=el.getAttribute('data-tab')||'overview';render();}
function renderAvailOverview(){
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE'&&u.role==='EMPLOYEE';});
  var h='<div class="section-header"><div class="section-title">Team Weekly Availability</div></div>';
  employees.forEach(function(emp){
    var avail=getUserAvailability(emp.id);
    h+='<div class="card" style="margin-bottom:16px"><div class="card-header"><div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div></div></div>';
    h+='<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
    AVAIL_DAYS.forEach(function(wd){var rec=avail.find(function(a){return a.dayOfWeek===wd.idx;});
      h+='<div style="text-align:center;background:var(--bg3);border-radius:8px;padding:8px 4px"><div style="font-size:9px;font-weight:700;color:var(--text3);margin-bottom:4px">'+wd.label.slice(0,3).toUpperCase()+'</div>';
      h+=(rec&&rec.isAvailable?'<div style="font-size:9px;color:var(--green);line-height:1.5">'+fmt12(rec.startTime)+'<br>'+fmt12(rec.endTime)+'</div>':'<div style="font-size:10px;color:var(--text3)">Off</div>')+'</div>';
    });
    h+='</div></div>';
  });return h;
}
function renderAvailAdminReqs(){
  var reqs=DB.requests.filter(function(r){return r.type==='availability';}).slice().reverse();
  var h='<div class="section-header"><div class="section-title">Availability Change Requests</div></div>';
  if(!reqs.length)return h+'<div class="empty-state"><div class="empty-icon">\u2705</div><div class="empty-title">No requests</div></div>';
  reqs.forEach(function(r){
    var emp=getUser(r.userId);if(!emp)return;
    var currentAvail=getUserAvailability(r.userId);
    h+='<div class="request-card">';
    // Header row: avatar + name + status badge
    h+='<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">';
    h+='<div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
    h+='<div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div><div class="swap-meta">'+relTime(r.createdAt)+'</div></div></div>';
    h+='<span class="badge badge-'+r.status+'">'+r.status.charAt(0).toUpperCase()+r.status.slice(1)+'</span></div>';
    if(r.data&&r.data.notes)h+='<div class="swap-message" style="margin-bottom:12px">'+esc(r.data.notes)+'</div>';
    // Always show current + requested side by side
    if(r.data&&r.data.proposedAvailability){
      h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px">';
      h+='<div><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Current</div>';
      h+=availGridHtml(currentAvail,'var(--green)');
      h+='</div>';
      h+='<div><div style="font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Requested</div>';
      h+=availGridHtml(r.data.proposedAvailability,'var(--amber)');
      h+='</div></div>';
    }
    if(r.status==='pending'){
      h+='<div class="swap-actions">';
      if(r.userId!==state.currentUser.id){
        h+='<button class="btn btn-success btn-sm" data-rid="'+r.id+'" onclick="approveRequest(this)">\u2713 Approve</button>';
        h+='<button class="btn btn-danger btn-sm" data-rid="'+r.id+'" onclick="openModal(\'reject-request\',{id:\''+r.id+'\'})">Reject</button>';
      } else h+='<span style="font-size:12px;color:var(--text3);font-style:italic">\u26A0 Cannot self-approve</span>';
      h+='</div>';
    }
    h+='</div>';
  });return h;
}

// ─── PREVIEW + SETTINGS ───────────────────────────────────────────
function renderPreview(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var h='<div class="preview-banner"><div><div class="preview-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview Mode</div>';
  h+='<div class="preview-count">'+DB.previewShifts.length+' preview shift'+(DB.previewShifts.length!==1?'s':'')+' staged</div></div>';
  h+='<button class="btn btn-primary" onclick="openModal(\'publish-schedule\',{})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Publish Schedule</button></div>';
  h+='<div class="week-nav"><button class="btn btn-ghost btn-sm" onclick="changeWeek(-1)">\u2039 Prev</button><span class="week-label">'+weekLabel(state.weekOffset)+'</span><button class="btn btn-ghost btn-sm" onclick="changeWeek(1)">Next \u203A</button><button class="btn btn-ghost btn-sm" onclick="goToday()">Today</button>';
  h+='<div class="view-tabs" style="margin-left:auto"><button class="view-tab'+(state.view==='week'?' active':'')+'" onclick="setView(\'week\')">Week</button><button class="view-tab'+(state.view==='list'?' active':'')+'" onclick="setView(\'list\')">List</button></div></div>';
  h+='<div class="card" style="border:2px dashed rgba(245,158,11,.3)">';
  if(!DB.previewShifts.length)h+='<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><div class="empty-title">No preview shifts</div><div class="empty-sub">Use "Add to Preview" to stage shifts before publishing</div></div>';
  else if(state.view==='week')h+=renderGanttView(DB.previewShifts);
  else h+=renderListView(DB.previewShifts);
  h+='</div>';return h;
}
function renderSettings(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var tabs=[{id:'tasks',label:'Task Management'},{id:'scheduling',label:'Scheduling Rules'},{id:'swaps',label:'Swap Rules'},{id:'notifications',label:'Notifications'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.settingsTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setSettingsTab(this)">'+t.label+'</button>';});
  h+='</div>';
  if(state.settingsTab==='tasks')return h+renderSettingsTasks();
  if(state.settingsTab==='scheduling')return h+renderSettingsScheduling();
  if(state.settingsTab==='swaps')return h+renderSettingsSwaps();
  return h+renderSettingsNotifications();
}
function setSettingsTab(el){state.settingsTab=el.getAttribute('data-tab')||'tasks';render();}
function renderSettingsTasks(){
  var h='<div class="section-header"><div class="section-title">Task Management</div><button class="btn btn-primary" onclick="openModal(\'create-task\',{})">+ New Task</button></div>';
  h+='<div class="settings-section"><div class="settings-section-header">Active Tasks</div><div class="settings-section-body">';
  DB.tasks.forEach(function(t){
    h+='<div class="task-item'+(t.active?'':' task-inactive')+'">';
    h+='<div class="task-color-swatch" style="background:'+esc(t.color)+'"></div>';
    h+='<div style="flex:1"><div class="task-name">'+esc(t.name)+'</div><div class="task-desc">'+esc(t.description||'')+'</div></div>';
    h+='<span class="badge badge-'+(t.active?'active':'inactive')+'">'+(t.active?'Active':'Inactive')+'</span>';
    h+='<button class="btn btn-xs btn-ghost" data-tid="'+t.id+'" onclick="openModal(\'edit-task\',{id:\''+t.id+'\'})">Edit</button>';
    h+='<button class="btn btn-xs btn-ghost" data-tid="'+t.id+'" onclick="toggleTaskActive(this)">'+(t.active?'Deactivate':'Activate')+'</button>';
    h+='</div>';
  });
  h+='</div></div>';return h;
}
function toggleTaskActive(el){var id=el.getAttribute('data-tid'),t=getTask(id);if(!t)return;t.active=!t.active;toast('Task '+(t.active?'activated':'deactivated')+'.','success');render();}
function renderSettingsScheduling(){var s=DB.settings;var h='<div class="settings-section"><div class="settings-section-header">Scheduling Rules</div><div class="settings-section-body">';h+=settingRowNum('Max shifts per day','maxShiftsPerDay','Prevents over-scheduling',s.maxShiftsPerDay);h+=settingRowNum('Minimum rest (hours)','minRestHours','Min break between shifts',s.minRestHours);h+=settingRowToggle('Overlap warnings','overlapWarnings','Display scheduling conflict warnings',s.overlapWarnings);h+='</div></div>';return h;}
function renderSettingsSwaps(){var s=DB.settings;var h='<div class="settings-section"><div class="settings-section-header">Swap Rules</div><div class="settings-section-body">';h+=settingRowToggle('Open swaps enabled','openSwapsEnabled','Allow employees to post open shifts',s.openSwapsEnabled);h+=settingRowToggle('Require admin approval','swapApprovalRequired','All swaps need manager approval',s.swapApprovalRequired);h+=settingRowNum('Swap expiry (days)','swapExpiryDays','Days before a swap request expires',s.swapExpiryDays);h+='</div></div>';return h;}
function renderSettingsNotifications(){var s=DB.settings;var h='<div class="settings-section"><div class="settings-section-header">Notification Preferences (UI only)</div><div class="settings-section-body">';h+=settingRowToggle('Swap notifications','notifySwaps','In-app alerts for swap requests',s.notifySwaps);h+=settingRowToggle('Approval notifications','notifyApprovals','Alerts for approvals and rejections',s.notifyApprovals);h+=settingRowToggle('Schedule publish alerts','notifySchedulePublish','Alerts when schedule is published',s.notifySchedulePublish);h+='<div style="font-size:11.5px;color:var(--text3);margin-top:12px;background:var(--bg3);border-radius:8px;padding:10px">\uD83D\uDCA1 UI preference toggles only. No external integrations.</div></div></div>';return h;}
function settingRowToggle(label,key,desc,val){return'<div class="setting-row"><div><div class="setting-label">'+label+'</div><div class="setting-desc">'+desc+'</div></div><label class="toggle-switch"><input type="checkbox" '+(val?'checked':'')+' onchange="toggleSetting(\''+key+'\',this.checked)"><span class="toggle-slider"></span></label></div>';}
function settingRowNum(label,key,desc,val){return'<div class="setting-row"><div><div class="setting-label">'+label+'</div><div class="setting-desc">'+desc+'</div></div><input type="number" value="'+val+'" min="1" max="24" style="width:70px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:4px 8px;font-size:13px;text-align:center" onchange="setSettingNum(\''+key+'\',+this.value)"></div>';}
function toggleSetting(key,val){DB.settings[key]=val;toast('Setting updated.','success');}
function setSettingNum(key,val){if(val>0)DB.settings[key]=val;toast('Setting updated.','success');}


// ─── ADMIN PANEL ──────────────────────────────────────────────────
function renderAdmin(){
  if(!isAdminOrMgr())return'<div class="empty-state"><div class="empty-icon">\uD83D\uDD12</div><div class="empty-title">Access restricted</div></div>';
  var tabs=[{id:'users',label:'Users'},{id:'all-requests',label:'All Requests'},{id:'audit',label:'Audit Log'}];
  var h='<div class="admin-tabs">';
  tabs.forEach(function(t){h+='<button class="admin-tab'+(state.adminTab===t.id?' active':'')+'" data-tab="'+t.id+'" onclick="setAdminTab(this)">'+t.label+'</button>';});
  h+='</div>';
  if(state.adminTab==='users')return h+renderAdminUsers();
  if(state.adminTab==='all-requests'){
    var all=DB.requests.slice().reverse();
    var ah='<div class="section-header"><div class="section-title">All Requests</div><div style="font-size:13px;color:var(--text2)">'+all.length+' total</div></div>';
    all.forEach(function(r){ah+=renderRequestCard(r);});
    return h+ah;
  }
  return h+renderAuditLog();
}
function setAdminTab(el){state.adminTab=el.getAttribute('data-tab')||'users';render();}
function renderAdminUsers(){
  var sq=(state.searchUser||'').toLowerCase();
  var users=DB.users.filter(function(u){return!sq||u.name.toLowerCase().includes(sq)||u.email.toLowerCase().includes(sq);});
  var active=DB.users.filter(function(u){return u.status==='ACTIVE';}).length;
  var h='<div class="section-header"><div><div class="section-title">Users</div><div style="font-size:13px;color:var(--text2)">'+DB.users.length+' total \u00B7 '+active+' active</div></div>';
  h+='<div style="display:flex;gap:10px"><input class="search-input" id="userSearch" placeholder="Search\u2026" value="'+esc(state.searchUser||'')+'" oninput="filterUsers(this.value)" style="width:160px"><button class="btn btn-primary btn-sm" onclick="openModal(\'create-user\',{})">+ Add User</button></div></div>';
  h+='<div class="card table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody>';
  if(!users.length)h+='<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">No users match</td></tr>';
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
function renderAuditLog(){
  var log=DB.auditLog.slice().reverse().slice(0,60);
  var h='<div class="section-header"><div class="section-title">Audit Log</div></div>';
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
  h+='<div class="form-group"><label>New Password</label><input type="password" id="pNewPw" placeholder="Min 8 chars"></div>';
  h+='<div class="form-group"><label>Confirm</label><input type="password" id="pConPw"></div>';
  h+='<button class="btn btn-ghost" onclick="savePassword()">Update Password</button></div></div>';
  return h;
}
function saveProfile(){var el=document.getElementById('pName');if(!el)return;var name=el.value.trim();if(!name){toast('Name cannot be empty.','error');return;}state.currentUser.name=name;toast('Profile updated.','success');render();}
function savePassword(){var n=document.getElementById('pNewPw'),c=document.getElementById('pConPw');if(!n||!c)return;var err=validatePassword(n.value);if(err){toast(err,'error');return;}if(n.value!==c.value){toast('Passwords do not match.','error');return;}state.currentUser.password=n.value;n.value='';c.value='';toast('Password updated.','success');}


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
    'create-user':       renderCreateUserModal,
    'edit-user':         function(){return renderEditUserModal(m.data.id);},
    'edit-availability': renderEditAvailabilityModal,
    'create-timeoff':    renderCreateTimeOffModal,
    'reject-request':    function(){return renderRejectRequestModal(m.data.id);},
    'cancel-request':    function(){return renderCancelRequestModal(m.data.id);},
    'claim-openshift':   renderClaimOpenShiftModal,
    'create-openshift':  renderCreateOpenShiftModal,
    'create-task':       renderCreateTaskModal,
    'edit-task':         function(){return renderEditTaskModal(m.data.id);},
    'publish-schedule':  renderPublishScheduleModal,
    'request-swap':      function(){return renderRequestSwapModal(m.data.shiftId);},
    'confirm-swap-accept':function(){return renderConfirmSwapAcceptModal(m.data.id);},
    'confirm-swap-approve':function(){return renderConfirmSwapApproveModal(m.data.id);},
    'accept-shift':      function(){return renderAcceptShiftModal(m.data.rid,m.data.type);},
    'mark-absent':       function(){return renderMarkAbsentModal(m.data.shiftId,m.data.empId);},
  };
  return(fns[m.type]||function(){return'';})();
}

// ─── CONFIRMATION MODALS ─────────────────────────────────────────
// Confirm swap acceptance (directed swap: named receiver)
function renderConfirmSwapAcceptModal(id){
  var req=getReq(id);if(!req)return'';
  var owner=getUser(req.userId);
  var rs=req.data&&req.data.requesterShiftId?getShift(req.data.requesterShiftId):null;
  var body='<div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:18px">';
  body+='<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Confirm you are accepting this swap:</div>';
  if(owner)body+='<div style="font-size:13px;color:var(--text2);margin-bottom:10px">Requested by <strong>'+esc(owner.name)+'</strong></div>';
  if(rs){
    body+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:6px">SHIFT YOU WILL TAKE:</div>';
    body+='<div style="background:'+esc(rs.taskColor||'#6366f1')+';border-radius:8px;padding:12px;color:#fff;margin-bottom:12px">';
    body+='<div style="font-weight:700">'+fmtDateLabel(rs.date)+'</div>';
    body+='<div style="font-size:13px;opacity:.9">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
    body+='<div style="font-size:12px;opacity:.8">'+esc(rs.taskName||'Shift')+'</div>';
    body+='</div>';
  }
  if(req.data&&req.data.message)body+='<div style="font-size:12px;color:var(--text2);font-style:italic">\\u201C'+esc(req.data.message)+'\\u201D</div>';
  body+='</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-success" data-rid="'+id+'" onclick="confirmSwapAccept(this)">Confirm Accept</button></div>';
  return modalWrap('Accept Swap',body);
}
function confirmSwapAccept(el){
  var rid=el.getAttribute('data-rid');
  acceptSwapReq({getAttribute:function(){return rid;}});
  closeModal();
}

// Confirm swap finalization (admin finalizes after employee accepted)
function renderConfirmSwapApproveModal(id){
  var req=getReq(id);if(!req)return'';
  var requester=getUser(req.userId),receiver=getUser(req.data&&req.data.receiverId);
  var rs=req.data&&req.data.requesterShiftId?getShift(req.data.requesterShiftId):null;
  var body='<div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:18px">';
  body+='<div style="font-size:13px;color:var(--text2);margin-bottom:12px">Both employees have agreed. Finalizing this swap will update the schedule immediately.</div>';
  if(requester&&receiver){
    body+='<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-bottom:12px">';
    body+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center"><div class="avatar avatar-sm" style="background:'+esc(requester.avatarColor)+';margin:0 auto 4px">'+esc(initials(requester.name))+'</div><div style="font-size:12px;font-weight:600">'+esc(requester.name)+'</div></div>';
    body+='<div style="font-size:20px;text-align:center;color:var(--text3)">\u21C4</div>';
    body+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center"><div class="avatar avatar-sm" style="background:'+esc(receiver.avatarColor)+';margin:0 auto 4px">'+esc(initials(receiver.name))+'</div><div style="font-size:12px;font-weight:600">'+esc(receiver.name)+'</div></div>';
    body+='</div>';
  }
  if(rs)body+='<div style="font-size:12px;color:var(--text3)">Shift: '+fmtDateLabel(rs.date)+' \u00B7 '+fmtRange(rs.startTime,rs.endTime)+'</div>';
  body+='</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-success" data-rid="'+id+'" onclick="finalizeSwapApproval(this)">\u2713 Finalize Swap</button></div>';
  return modalWrap('Finalize Swap',body,'lg');
}
function finalizeSwapApproval(el){
  var rid=el.getAttribute('data-rid');
  approveRequest({getAttribute:function(){return rid;}});
  closeModal();
}

// Unified accept-shift modal (openShift take OR openSwap volunteer)
function renderAcceptShiftModal(rid,type){
  var req=getReq(rid);if(!req)return'';
  var isShift=type==='openshift';
  var isCov=m.data&&m.data.type==='coverage';var title=isShift?'Take This Shift':isCov?'Take This Shift':'Accept This Swap';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:18px">';
  if(isShift&&req.data){
    body+='<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Confirm you are taking this shift:</div>';
    body+='<div style="background:'+esc(req.data.taskColor||'#6366f1')+';border-radius:8px;padding:14px;color:#fff;margin-bottom:10px">';
    body+='<div style="font-size:15px;font-weight:700">'+fmtDateLabel(req.data.date)+'</div>';
    body+='<div style="font-size:13px;opacity:.9">'+fmtRange(req.data.startTime,req.data.endTime)+'</div>';
    body+='<div style="font-size:12px;opacity:.8">'+esc(req.data.taskName||'Shift')+'</div>';
    if(req.data.notes)body+='<div style="font-size:12px;opacity:.7;margin-top:6px">'+esc(req.data.notes)+'</div>';
    body+='</div>';
  } else if(!isShift&&req.data){
    var rs=req.data.requesterShiftId?getShift(req.data.requesterShiftId):null;
    var owner=getUser(req.userId);
    body+='<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Confirm you are taking this swap offer:</div>';
    if(owner)body+='<div style="font-size:13px;color:var(--text2);margin-bottom:8px">Posted by <strong>'+esc(owner.name)+'</strong></div>';
    if(rs){
      body+='<div style="background:'+esc(rs.taskColor||'#6366f1')+';border-radius:8px;padding:12px;color:#fff;margin-bottom:10px">';
      body+='<div style="font-weight:700">'+fmtDateLabel(rs.date)+'</div>';
      body+='<div style="font-size:13px;opacity:.9">'+fmtRange(rs.startTime,rs.endTime)+'</div>';
      body+='<div style="font-size:12px;opacity:.8">'+esc(rs.taskName||'Shift')+'</div>';
      body+='</div>';
    }
    if(req.data.message)body+='<div style="font-size:12px;color:var(--text2);font-style:italic">\\u201C'+esc(req.data.message)+'\\u201D</div>';
  }
  body+='</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body+='<button class="btn btn-primary" data-rid="'+rid+'" data-type="'+type+'" onclick="executeAcceptShift(this)">Confirm</button></div>';
  return modalWrap(title,body);
}
function executeAcceptShift(btn){
  var rid=btn.getAttribute('data-rid'),type=btn.getAttribute('data-type');
  var req=getReq(rid);if(!req)return;
  var u=state.currentUser;
  closeModal();
  if(type==='openshift'){
    // Take the open shift directly (no DOM form needed)
    if(!req.data||req.data.status!=='OPEN'){toast('This shift is no longer available.','error');return;}
    req.data.status='PENDING';req.data.claimedBy=u.id;req.data.claimType='take';req.data.swapShiftId=null;req.updatedAt=now();
    DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){
      addNotif(mgr.id,'Shift Claimed',u.name+' wants the open shift on '+req.data.date+'.','info','openshift');
    });
    toast('Claim submitted! Awaiting approval.','success');render();
  } else {
    // Take open swap
    volunteerOpenSwap({getAttribute:function(){return rid;}});
  }
}

// ─── CANCEL REQUEST MODAL ─────────────────────────────────────────
function renderCancelRequestModal(id){
  var req=getReq(id);if(!req)return'';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:20px">';
  body+='<div style="font-size:13px;color:var(--text2)">Are you sure you want to cancel this <strong>'+req.type+'</strong> request?</div>';
  body+='<div style="font-size:12px;color:var(--text3);margin-top:6px">This action cannot be undone. The request status will be set to cancelled.</div>';
  body+='</div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">No, Keep Request</button><button class="btn btn-danger" data-rid="'+id+'" onclick="executeCancelRequest(this)">Yes, Cancel Request</button></div>';
  return modalWrap('Cancel Request',body);
}
function executeCancelRequest(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  if(req.userId!==state.currentUser.id){toast('You can only cancel your own requests.','error');return;}
  req.status='cancelled';req.updatedAt=now();
  // Notify managers
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){
    addNotif(mgr.id,'Request Cancelled',state.currentUser.name+' cancelled their '+req.type+' request.','info','requests');
  });
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'REQUEST_CANCELLED',entityType:'Request',entityId:rid,createdAt:now()});
  toast('Request cancelled.','info');closeModal();
}

// ─── REJECT REQUEST MODAL ─────────────────────────────────────────
function renderRejectRequestModal(id){
  var req=getReq(id),owner=req?getUser(req.userId):null;if(!req||!owner)return'';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:16px">';
  body+='<div style="font-weight:600;color:var(--text)">'+esc(owner.name)+'\'s '+req.type+' request</div>';
  if(req.data&&req.data.notes)body+='<div style="font-size:12px;color:var(--text2);margin-top:4px">'+esc(req.data.notes)+'</div>';
  body+='</div><div class="form-group"><label>Reason for Rejection</label><textarea id="rejectReason" placeholder="Explain why..."></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" data-rid="'+id+'" onclick="executeRejectRequest(this)">Reject Request</button></div>';
  return modalWrap('Reject Request',body);
}
function executeRejectRequest(el){
  var rid=el.getAttribute('data-rid'),req=getReq(rid);if(!req)return;
  var reason=((document.getElementById('rejectReason')||{}).value||'').trim();
  req.status='rejected';req.updatedAt=now();
  if(reason)req.comments.push({userId:state.currentUser.id,userName:state.currentUser.name,role:state.currentUser.role.toLowerCase(),message:'Rejected: '+reason,timestamp:now()});
  addNotif(req.userId,'Request Rejected','Your '+req.type+' request was rejected.'+(reason?' Reason: '+reason:''),'info','requests');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:'REQUEST_REJECTED',entityType:'Request',entityId:rid,createdAt:now()});
  toast('Request rejected.','info');closeModal();
}

// ─── SHIFT MODALS (v7 task-based) ────────────────────────────────
function renderCreateShiftModal(){
  var preview=state.modal.data&&state.modal.data.preview;
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var isMgr=isAdminOrMgr();
  var body='';
  if(isMgr){body+='<div class="form-group"><label>Employee *</label><select id="mEmp"><option value="">Select employee\u2026</option>';employees.forEach(function(u){body+='<option value="'+u.id+'">'+esc(u.name)+'</option>';});body+='</select></div>';}
  body+='<div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+todayStr()+'"></div>';
  body+='<div class="form-group"><label>Task *</label><select id="mTask"><option value="">Select task\u2026</option>';
  activeTasks.forEach(function(t){body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'">'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="09:00"></div><div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="17:00"></div></div>';
  body+='<div class="form-group"><label>Shift Instructions</label><textarea id="mNotes" placeholder="Instructions for this shift\u2026"></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-preview="'+(preview?'1':'0')+'" onclick="createShift(this)">'+(preview?'Add to Preview':'Create Shift')+'</button></div>';
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
  if(!start||!end){toast('Times are required.','error');return;}
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start.','error');return;}
  var tp=taskVal.split('|');
  var arr=preview?DB.previewShifts:DB.shifts;
  if(hasConflict(empId,date,start,end,null,arr)){toast('Conflict: overlapping shift exists.','error');return;}
  if(!preview&&isOnApprovedTimeOff(empId,date)){if(!confirm('\u26A0\uFE0F Employee has approved time off on '+date+'. Schedule anyway?'))return;}
  var shift={id:nextId('s'),employeeId:empId,createdById:state.currentUser.id,
    date:date,startTime:start,endTime:end,taskId:tp[0],taskName:tp[1],taskColor:tp[2],
    notes:notes,employeeComments:[],createdAt:now(),updatedAt:now()};
  arr.push(shift);
  if(!preview)addNotif(empId,'Shift Assigned','New '+tp[1]+' shift on '+date+' from '+fmt12(start)+' to '+fmt12(end)+'.','info','schedule');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,action:preview?'PREVIEW_SHIFT_CREATED':'SHIFT_CREATED',entityType:'Shift',entityId:shift.id,createdAt:now()});
  toast(preview?'Preview shift added.':'Shift created.','success');closeModal();
}
function renderEditShiftModal(id){
  var s=getShift(id);if(!s)return modalWrap('Not Found','<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var employees=DB.users.filter(function(u){return u.status==='ACTIVE';});
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var body='<div class="form-group"><label>Employee *</label><select id="mEmp">';
  employees.forEach(function(u){body+='<option value="'+u.id+'"'+(u.id===s.employeeId?' selected':'')+'>'+esc(u.name)+'</option>';});
  body+='</select></div><div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="mDate" value="'+esc(s.date)+'"></div>';
  body+='<div class="form-group"><label>Task *</label><select id="mTask"><option value="">Select task\u2026</option>';
  activeTasks.forEach(function(t){body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'"'+(t.id===s.taskId?' selected':'')+'>'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="mStart" value="'+esc(s.startTime)+'"></div><div class="form-group"><label>End Time *</label><input type="time" id="mEnd" value="'+esc(s.endTime)+'"></div></div>';
  body+='<div class="form-group"><label>Shift Instructions</label><textarea id="mNotes">'+esc(s.notes||'')+'</textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-danger" onclick="deleteShiftConfirm(\''+id+'\')">Delete</button><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="updateShift(\''+id+'\')">Save</button></div>';
  return modalWrap('Edit Shift',body);
}
function updateShift(id){
  var s=getShift(id);if(!s)return;
  var empId=(document.getElementById('mEmp')||{}).value||s.employeeId;
  var date=(document.getElementById('mDate')||{}).value||s.date;
  var taskVal=(document.getElementById('mTask')||{}).value||'';
  var start=(document.getElementById('mStart')||{}).value||s.startTime;
  var end=(document.getElementById('mEnd')||{}).value||s.endTime;
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start.','error');return;}
  if(taskVal){var tp=taskVal.split('|');s.taskId=tp[0];s.taskName=tp[1];s.taskColor=tp[2];}
  s.employeeId=empId;s.date=date;s.startTime=start;s.endTime=end;
  s.notes=(document.getElementById('mNotes')||{}).value||'';s.updatedAt=now();
  addNotif(s.employeeId,'Shift Updated','Your shift on '+date+' updated to '+fmt12(start)+' \u2013 '+fmt12(end)+'.','info','schedule');
  toast('Shift updated.','success');closeModal();
}
function deleteShiftConfirm(id){
  if(!confirm('Delete this shift?'))return;
  var s=getShift(id);if(s)addNotif(s.employeeId,'Shift Removed','Your shift on '+s.date+' has been removed.','info','schedule');
  DB.shifts=DB.shifts.filter(function(x){return x.id!==id;});
  DB.previewShifts=DB.previewShifts.filter(function(x){return x.id!==id;});
  toast('Shift deleted.','success');closeModal();
}
function renderViewShiftModal(id){
  var s=getShift(id);if(!s)return modalWrap('Not Found','<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');
  var emp=getUser(s.employeeId),u=state.currentUser,isMgr=isAdminOrMgr();
  var isOwn=s.employeeId===u.id,isPast=s.date<todayStr();
  var onTO=isOnApprovedTimeOff(s.employeeId,s.date);
  var body='<div style="border-radius:10px;padding:16px;margin-bottom:20px;background:'+esc(s.taskColor||'#6366f1')+';border:1px solid rgba(255,255,255,.07)">';
  if(isMgr&&emp)body+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div class="avatar" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div><div style="font-weight:700;color:#fff">'+esc(emp.name)+'</div></div>';
  body+='<div style="color:#fff;font-size:15px;font-weight:700">'+fmtDateLabel(s.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:14px;margin-top:4px">'+fmtRange(s.startTime,s.endTime)+'</div>';
  body+='<div style="margin-top:8px"><span style="background:rgba(255,255,255,.2);color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px">'+esc(s.taskName||'Shift')+'</span></div>';
  if(s.notes)body+='<div style="font-size:12px;margin-top:10px;color:rgba(255,255,255,.8)">\uD83D\uDCCB '+esc(s.notes)+'</div>';
  body+='</div>';
  if(isPast)body+='<div style="font-size:12px;color:var(--text3);margin-bottom:12px">\u23F0 This shift is in the past.</div>';
  if(onTO)body+='<div style="font-size:12px;color:var(--red);background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px;margin-bottom:12px">\u26D4 Employee has approved time off on this date.</div>';
  // Chat-style shift comments
  if(!s.employeeComments)s.employeeComments=[];
  var sComments=s.employeeComments;
  body+='<div style="margin-top:14px;border:1px solid var(--border);border-radius:10px;overflow:hidden">';
  body+='<div style="padding:8px 14px;background:var(--bg3);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  body+='<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">Shift Log</span>';
  body+='<span style="font-size:11px;color:var(--text3)">'+sComments.length+' note'+(sComments.length!==1?'s':'')+'</span>';
  body+='</div>';
  body+='<div style="max-height:180px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;background:var(--bg2)">';
  if(!sComments.length){
    body+='<div style="text-align:center;padding:16px 0;font-size:12px;color:var(--text3)">No notes yet \u2014 log a task update below</div>';
  }
  sComments.forEach(function(c){
    var cu=getUser(c.userId);
    var isMe=(state.currentUser&&c.userId===state.currentUser.id);
    var isPriv=(c.role==='admin'||c.role==='ADMIN'||c.role==='manager'||c.role==='MANAGER');
    body+='<div style="display:flex;gap:8px;'+(isMe?'flex-direction:row-reverse':'')+'">';
    body+='<div class="avatar avatar-sm" style="flex-shrink:0;background:'+(cu?esc(cu.avatarColor):'#888')+'">'+(cu?esc(initials(cu.name)):'?')+'</div>';
    body+='<div style="max-width:75%">';
    body+='<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;'+(isMe?'justify-content:flex-end':'justify-content:flex-start')+'">';
    if(!isMe)body+='<span style="font-size:11px;font-weight:700;color:var(--text)">'+esc(c.userName||'User')+'</span>';
    if(isPriv){body+=(c.role==='admin'||c.role==='ADMIN'?'<span class="comment-role-badge badge-admin-role">Admin</span>':'<span class="comment-role-badge badge-manager-role">Manager</span>');}
    if(isMe)body+='<span style="font-size:11px;font-weight:700;color:var(--text)">You</span>';
    body+='<span style="font-size:10px;color:var(--text3)">'+relTime(c.timestamp)+'</span>';
    body+='</div>';
    var bg=isMe?'var(--brand-bg)':isPriv?'rgba(239,68,68,.06)':'var(--bg3)';
    var bdr=isMe?'rgba(99,102,241,.3)':isPriv?'rgba(239,68,68,.15)':'var(--border)';
    body+='<div style="background:'+bg+';border:1px solid '+bdr+';border-radius:'+(isMe?'12px 2px 12px 12px':'2px 12px 12px 12px')+';padding:7px 11px;font-size:13px;line-height:1.5;color:var(--text2)">'+esc(c.message)+'</div>';
    body+='</div></div>';
  });
  body+='</div>';
  if(isOwn||isMgr){
    body+='<div style="padding:8px 12px;border-top:1px solid var(--border);background:var(--bg2);display:flex;gap:8px">';
    body+='<input id="shiftComment-'+id+'" placeholder="Log a task update or note\u2026" style="flex:1;font-size:13px">';
    body+='<button class="btn btn-sm btn-primary" data-sid="'+id+'" onclick="addShiftComment(this)">Post</button>';
    body+='</div>';
  }
  body+='</div>';
  body+='<div class="modal-actions" style="flex-wrap:wrap;margin-top:16px">';
  if(isOwn&&!isPast)body+='<button class="btn btn-brand" onclick="closeModal();openModal(\'request-swap\',{shiftId:\''+id+'\'})">Request Swap</button>';
  if(isMgr){
    body+='<button class="btn btn-ghost" onclick="closeModal();openModal(\'edit-shift\',{id:\''+id+'\'})">Edit Shift</button>';
    // Attendance marking for today/past shifts only
    if(s.date<=todayStr()){
      var att=getShiftAttendance(s.id,s.employeeId);
      if(!att){
        body+='<button class="btn btn-ghost" style="color:var(--red)" onclick="closeModal();openModal(\'mark-absent\',{shiftId:\''+s.id+'\',empId:\''+s.employeeId+'\'})">Mark Absent</button>';
      } else {
        body+='<span style="font-size:12px;color:var(--red);font-weight:600;padding:4px 8px">⚠ '+att.status.replace(/_/g,' ')+'</span>';
      }
    }
  }
  if(isOwn&&!isPast)body+='<button class="btn btn-amber" onclick="closeModal();submitCoverageFromShift(\''+id+'\')">Request Coverage</button>';
  body+='</div>';
  return modalWrap('Shift Details',body,'lg');
}
function addShiftComment(btn){
  var sid=btn.getAttribute('data-sid'),s=getShift(sid);if(!s)return;
  var inp=document.getElementById('shiftComment-'+sid);
  var msg=(inp&&inp.value||'').trim();if(!msg)return;
  var u=state.currentUser;
  if(!s.employeeComments)s.employeeComments=[];
  s.employeeComments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:msg,timestamp:now()});
  if(inp)inp.value='';s.updatedAt=now();
  // Notify assigned employee + managers about task comment
  if(s.employeeId!==u.id)addNotif(s.employeeId,'Task Comment',u.name+' commented on your '+esc(s.taskName||'shift')+' on '+fmtDateLabel(s.date)+'.','task','schedule');
  DB.users.filter(function(x){return(x.role==='ADMIN'||x.role==='MANAGER')&&x.status==='ACTIVE'&&x.id!==u.id;}).forEach(function(mgr){
    addNotif(mgr.id,'Task Comment',u.name+' added a note to '+(getUser(s.employeeId)?getUser(s.employeeId).name+"'s":'')+' '+esc(s.taskName||'shift')+'.','task','schedule');
  });
    toast('Comment posted.','success');render();
}
// Swap request (creates a swap type request)
// Submit coverage request directly from shift modal
function submitCoverageFromShift(shiftId){
  var u=state.currentUser,shift=getShift(shiftId);
  if(!shift){toast('Shift not found.','error');return;}
  if(shift.date<todayStr()){toast('Cannot request coverage for a past shift.','error');return;}
  // Check for existing coverage request on this shift
  var existing=DB.requests.find(function(r){return r.type==='coverage'&&r.data&&r.data.requesterShiftId===shiftId&&r.status==='pending';});
  if(existing){toast('A coverage request already exists for this shift.','error');return;}
  var req=createRequest('coverage',u.id,{
    requesterShiftId:shiftId,
    exchangeRequired:false,
    message:u.name+' needs coverage for '+fmtDateLabel(shift.date)+' ('+fmtRange(shift.startTime,shift.endTime)+' \u00B7 '+(shift.taskName||'Shift')+')',
    status:'OPEN',
  },'public',msg?[{userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:u.name+' needs coverage for this shift.',timestamp:now()}]:[]);
  // Notify all active users
  DB.users.filter(function(x){return x.status==='ACTIVE'&&x.id!==u.id;}).forEach(function(emp){
    addNotif(emp.id,'Coverage Needed',u.name+' needs coverage for a shift on '+fmtDateLabel(shift.date)+'.','info','openshift');
  });
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'COVERAGE_REQUESTED',entityType:'Request',entityId:req.id,createdAt:now()});
  toast('Coverage request posted to the marketplace!','success');
  navigate('openshift');
}


function renderRequestSwapModal(shiftId){
  var u=state.currentUser,shift=getShift(shiftId);
  if(!shift)return modalWrap('Not Found','<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');

  // Step 1: Show the shift being surrendered
  var body='<div style="margin-bottom:16px">';
  body+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">Shift you are giving up</div>';
  body+='<div style="border-radius:8px;padding:12px;background:'+esc(shift.taskColor||'#6366f1')+';border:1px solid rgba(255,255,255,.06)">';
  body+='<div style="color:#fff;font-weight:600">'+fmtDateLabel(shift.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:13px">'+fmtRange(shift.startTime,shift.endTime)+'</div>';
  body+='<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:4px">'+esc(shift.taskName||'Shift')+'</div>';
  body+='</div></div>';

  // Step 2: Compute eligible shifts to swap with
  var today=todayStr();
  var eligible=DB.shifts.filter(function(s){
    if(s.employeeId===u.id) return false;
    if(s.date<today) return false;
    var emp=getUser(s.employeeId);
    if(!emp||emp.status!=='ACTIVE') return false;
    // Would I conflict if I took this shift?
    if(hasConflict(u.id,s.date,s.startTime,s.endTime,shift.id)) return false;
    // Would the other employee conflict taking MY shift?
    if(hasConflict(s.employeeId,shift.date,shift.startTime,shift.endTime,s.id)) return false;
    return true;
  });
  eligible.sort(function(a,b){return a.date===b.date?timeToMins(a.startTime)-timeToMins(b.startTime):a.date<b.date?-1:1;});

  body+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px">Available shifts to swap with</div>';

  if(!eligible.length){
    body+='<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:20px;text-align:center;margin-bottom:16px">';
    body+='<div style="font-size:13px;color:var(--text3)">No eligible shifts found for swap.</div>';
    body+='<div style="font-size:12px;color:var(--text3);margin-top:6px">Try requesting coverage instead to post this shift to the marketplace.</div>';
    body+='</div>';
  } else {
    body+='<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;margin-bottom:16px">';
    eligible.forEach(function(s,idx){
      var emp=getUser(s.employeeId);
      body+='<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background=\'rgba(99,102,241,.06)\'" onmouseout="this.style.background=\'transparent\'">';
      body+='<input type="radio" name="swapTarget" value="'+s.id+'" style="flex-shrink:0"'+(idx===0?' checked':'')+' >';
      body+='<div style="width:4px;height:32px;border-radius:2px;flex-shrink:0;background:'+esc(s.taskColor||'#6366f1')+'"></div>';
      if(emp)body+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+';flex-shrink:0;width:28px;height:28px;font-size:10px">'+esc(initials(emp.name))+'</div>';
      body+='<div style="flex:1;min-width:0">';
      body+='<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(emp?esc(emp.name):'?')+' \u00B7 '+fmtDateLabel(s.date)+'</div>';
      body+='<div style="font-size:12px;color:var(--text2)">'+fmtRange(s.startTime,s.endTime)+' \u00B7 '+esc(s.taskName||'Shift')+'</div>';
      body+='</div></label>';
    });
    body+='</div>';
  }

  body+='<div class="form-group"><label>Message (optional)</label><textarea id="swMsg" placeholder="Reason for swap\u2026" rows="2"></textarea></div>';
  body+='<div style="font-size:12px;color:var(--text3);background:var(--bg3);border-radius:8px;padding:10px 12px;margin-bottom:16px;line-height:1.6">\u26A0\uFE0F Swaps require the other employee to accept, then manager/admin approval.</div>';
  body+='<div class="modal-actions">';
  body+='<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  if(eligible.length)body+='<button class="btn btn-primary" data-shiftid="'+shiftId+'" onclick="submitSwapRequest(this)">Propose Swap</button>';
  body+='</div>';
  return modalWrap('Request Shift Swap',body,'lg');
}

function submitSwapRequest(btn){
  var shiftId=btn.getAttribute('data-shiftid'),u=state.currentUser,shift=getShift(shiftId);
  if(!shift){toast('Shift not found.','error');return;}
  if(shift.date<todayStr()){toast('Cannot swap a past shift.','error');return;}
  var radio=document.querySelector('input[name="swapTarget"]:checked');
  if(!radio||!radio.value){toast('Please select a shift to swap with.','error');return;}
  var targetShiftId=radio.value;
  var targetShift=getShift(targetShiftId);
  if(!targetShift){toast('Selected shift no longer exists.','error');return;}
  var msg=(document.getElementById('swMsg')||{}).value||'';
  var receiverId=targetShift.employeeId;
  var initComments=[];
  if(msg)initComments.push({userId:u.id,userName:u.name,role:u.role.toLowerCase(),message:msg,timestamp:now()});
  var req=createRequest('swap',u.id,{
    receiverId:receiverId,
    requesterShiftId:shiftId,
    receiverShiftId:targetShiftId,
    exchangeRequired:true,
    message:msg,
    adminNotes:'',responseMessage:'',responseBy:null,responseAt:null,
    expiresAt:new Date(Date.now()+DB.settings.swapExpiryDays*864e5).toISOString(),
    reviewedById:null,reviewedAt:null,
  },'private',initComments);
  var receiver=getUser(receiverId);
  addNotif(receiverId,'Swap Proposal',u.name+' proposed exchanging shifts with you: '+fmtDateLabel(shift.date)+' \u2194 '+fmtDateLabel(targetShift.date)+'.','swap','requests');
  DB.users.filter(function(x){return(x.role==='ADMIN'||x.role==='MANAGER')&&x.status==='ACTIVE';}).forEach(function(mgr){
    addNotif(mgr.id,'New Swap Proposal',u.name+' proposed a shift exchange with '+(receiver?receiver.name:'?')+'.','swap','requests');
  });
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SWAP_PROPOSED',entityType:'Request',entityId:req.id,createdAt:now()});
  toast('Swap proposal sent to '+(receiver?receiver.name:'employee')+'!','success');closeModal();
}

// ─── AVAILABILITY + TIME-OFF MODALS ──────────────────────────────
function renderEditAvailabilityModal(){
  var u=state.currentUser,cur=getUserAvailability(u.id);
  var body='<p style="font-size:13px;color:var(--text2);margin-bottom:16px">Your request will be reviewed by a manager before taking effect.</p>';
  body+='<div class="form-group"><label>Reason / Notes (optional)</label><textarea id="availNotes" placeholder="Explain the reason\u2026"></textarea></div>';
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
  if(DB.requests.some(function(r){return r.type==='availability'&&r.userId===u.id&&r.status==='pending';})){toast('You already have a pending availability request.','error');return;}
  var proposed=[],valid=true;
  AVAIL_DAYS.forEach(function(wd){
    var chk=document.getElementById('avchk-'+wd.idx),st=document.getElementById('avst-'+wd.idx),et=document.getElementById('avet-'+wd.idx);
    var avail=chk&&chk.checked,start=(st&&st.value)||'09:00',end=(et&&et.value)||'17:00';
    if(avail&&timeToMins(end)<=timeToMins(start)){toast('End time must be after start for '+wd.label,'error');valid=false;return;}
    proposed.push({dayOfWeek:wd.idx,startTime:start,endTime:end,isAvailable:avail});
  });
  if(!valid||proposed.length!==7)return;
  var req=createRequest('availability',u.id,{notes:notes,proposedAvailability:proposed},'private',[]);
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Availability Request',u.name+' submitted an availability change request.','request','availability');});
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'AVAILABILITY_REQUEST_SUBMITTED',entityType:'Request',entityId:req.id,createdAt:now()});
  toast('Availability change request submitted.','success');closeModal();
}
function renderCreateTimeOffModal(){
  var u=state.currentUser,today=todayStr();
  var body='<div class="form-row"><div class="form-group"><label>Start Date *</label><input type="date" id="toStart" value="'+today+'" min="'+today+'"></div><div class="form-group"><label>End Date *</label><input type="date" id="toEnd" value="'+today+'" min="'+today+'"></div></div>';
  body+='<div class="form-group"><label>Request Type *</label><div style="display:flex;gap:10px;margin-top:6px"><button id="toBtnSick" class="btn btn-amber" style="flex:1;justify-content:center" onclick="setTOType(\'sick\')">\uD83E\uDD12 Sick</button><button id="toBtnUnpaid" class="btn btn-ghost" style="flex:1;justify-content:center" onclick="setTOType(\'unpaid\')">\uD83D\uDCBC Unpaid</button></div><input type="hidden" id="toType" value="sick"></div>';
  body+='<div class="form-group"><label>Notes (optional)</label><textarea id="toNotes" placeholder="Additional context\u2026"></textarea></div>';
  body+='<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:14px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Digital Signature</div>';
  body+='<div style="font-size:12px;color:var(--text3);margin-bottom:10px">By typing your full name you confirm this request is accurate.</div>';
  body+='<div class="form-group" style="margin-bottom:0"><label>Type your full legal name *</label><input id="toSig" placeholder="'+esc(u.name)+'" autocomplete="off"></div></div>';
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
  if(end<start){toast('End date must be on or after start.','error');return;}
  if(!sig){toast('Digital signature is required.','error');return;}
  if(sig.toLowerCase()!==u.name.toLowerCase()){toast('Signature must match your full name: "'+u.name+'".','error');return;}
  if(DB.requests.some(function(r){return r.type==='timeOff'&&r.userId===u.id&&r.status!=='rejected'&&r.status!=='cancelled'&&r.data.startDate<=end&&r.data.endDate>=start;})){toast('You already have a request for an overlapping period.','error');return;}
  var req=createRequest('timeOff',u.id,{startDate:start,endDate:end,type:type,notes:notes,digitalSignatureName:sig,submittedAt:now()},'private',[]);
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Time-Off Request',u.name+' submitted a '+type+' time-off request.','request','requests');});
  DB.auditLog.push({id:nextId('a'),userId:u.id,action:'TIMEOFF_SUBMITTED',entityType:'Request',entityId:req.id,createdAt:now()});
  toast('Time-off request submitted.','success');closeModal();
}

// ─── OPEN SHIFT + TASK MODALS ─────────────────────────────────────
function renderClaimOpenShiftModal(){
  var m=state.modal,rid=m&&m.data&&m.data.id;
  var req=getReq(rid);if(!req||!req.data)return'';
  var d=req.data;
  var body='<div style="border-radius:10px;padding:14px;margin-bottom:18px;background:'+esc(d.taskColor||'#6366f1')+';border:1px solid rgba(255,255,255,.07)">';
  body+='<div style="color:#fff;font-size:15px;font-weight:700">'+fmtDateLabel(d.date)+'</div>';
  body+='<div style="color:rgba(255,255,255,.9);font-size:14px;margin-top:4px">'+fmtRange(d.startTime,d.endTime)+'</div>';
  body+='<div style="color:rgba(255,255,255,.8);font-size:12px;margin-top:4px">'+esc(d.taskName||'Shift')+'</div>';
  if(d.notes)body+='<div style="color:rgba(255,255,255,.7);font-size:12px;margin-top:6px">\uD83D\uDCDD '+esc(d.notes)+'</div>';
  body+='</div>';
  body+='<div class="form-group"><label>How would you like to take this shift?</label><div style="display:flex;gap:10px;margin-top:8px">';
  body+='<button id="claimTakeBtn" class="btn btn-primary" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'take\')"><div style="font-weight:700;margin-bottom:4px">\u2795 Take Shift</div><div style="font-size:11px;opacity:.7;font-weight:400">Extra work</div></button>';
  body+='<button id="claimSwapBtn" class="btn btn-ghost" style="flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center" onclick="setClaimType(\'swap\')"><div style="font-weight:700;margin-bottom:4px">\uD83D\uDD04 Take + Swap</div><div style="font-size:11px;opacity:.7;font-weight:400">Propose swap</div></button>';
  body+='</div><input type="hidden" id="claimType" value="take"></div>';
  body+='<div id="swapShiftSection" style="display:none" class="form-group"><label>Your shift to propose swap</label><select id="swapShiftId"><option value="">Select\u2026</option>';
  DB.shifts.filter(function(s){return s.employeeId===state.currentUser.id&&s.date>=todayStr();}).forEach(function(s){body+='<option value="'+s.id+'">'+fmtDateLabel(s.date)+' '+fmtRange(s.startTime,s.endTime)+' \u00B7 '+esc(s.taskName||'Shift')+'</option>';});
  body+='</select></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-rid="'+rid+'" onclick="submitClaimOpenShift(this)">Submit Claim</button></div>';
  return modalWrap('Claim Open Shift',body);
}
function setClaimType(type){var inp=document.getElementById('claimType');if(inp)inp.value=type;var take=document.getElementById('claimTakeBtn'),swap=document.getElementById('claimSwapBtn'),sec=document.getElementById('swapShiftSection');if(take){take.className='btn '+(type==='take'?'btn-primary':'btn-ghost');take.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center';}if(swap){swap.className='btn '+(type==='swap'?'btn-brand':'btn-ghost');swap.style.cssText='flex:1;justify-content:center;flex-direction:column;height:auto;padding:12px 8px;text-align:center';}if(sec)sec.style.display=type==='swap'?'block':'none';}
function submitClaimOpenShift(btn){
  var rid=btn.getAttribute('data-rid'),req=getReq(rid);
  if(!req||!req.data||req.data.status!=='OPEN'){toast('This shift is no longer available.','error');return;}
  var type=(document.getElementById('claimType')||{}).value||'take';
  var swapShiftId=type==='swap'?((document.getElementById('swapShiftId')||{}).value||null):null;
  req.data.status='PENDING';req.data.claimedBy=state.currentUser.id;req.data.claimType=type;req.data.swapShiftId=swapShiftId||null;req.updatedAt=now();
  DB.users.filter(function(x){return x.role==='ADMIN'||x.role==='MANAGER';}).forEach(function(mgr){addNotif(mgr.id,'Open Shift Claimed',state.currentUser.name+' wants to take the open shift on '+req.data.date+'.','info','openshift');});
  toast('Claim submitted! Awaiting manager approval.','success');closeModal();
}
function renderCreateOpenShiftModal(){
  var today=todayStr();
  var activeTasks=DB.tasks.filter(function(t){return t.active;});
  var body='<div class="form-row"><div class="form-group"><label>Date *</label><input type="date" id="osDate" value="'+today+'" min="'+today+'"></div>';
  body+='<div class="form-group"><label>Task *</label><select id="osTask"><option value="">Select task\u2026</option>';
  activeTasks.forEach(function(t){body+='<option value="'+t.id+'|'+esc(t.name)+'|'+esc(t.color)+'">'+esc(t.name)+'</option>';});
  body+='</select></div></div>';
  body+='<div class="form-row"><div class="form-group"><label>Start Time *</label><input type="time" id="osStart" value="09:00"></div><div class="form-group"><label>End Time *</label><input type="time" id="osEnd" value="17:00"></div></div>';
  body+='<div class="form-group"><label>Notes</label><textarea id="osNotes" placeholder="Details\u2026"></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createOpenShift()">Post Open Shift</button></div>';
  return modalWrap('Post Open Shift',body);
}
function createOpenShift(){
  var date=(document.getElementById('osDate')||{}).value||'';
  var taskVal=(document.getElementById('osTask')||{}).value||'';
  var start=(document.getElementById('osStart')||{}).value||'';
  var end=(document.getElementById('osEnd')||{}).value||'';
  var notes=(document.getElementById('osNotes')||{}).value||'';
  if(!date||!taskVal||!start||!end){toast('Date, task, and times are required.','error');return;}
  if(timeToMins(end)<=timeToMins(start)){toast('End time must be after start.','error');return;}
  var tp=taskVal.split('|');
  var u=state.currentUser;
  var req=createRequest('openShift',u.id,{
    date:date,startTime:start,endTime:end,taskId:tp[0],taskName:tp[1],taskColor:tp[2],
    notes:notes,status:'OPEN',claimedBy:null,claimType:null,swapShiftId:null,approvedBy:null,approvedAt:null,
  },'public',[]);
  DB.users.filter(function(x){return x.status==='ACTIVE'&&x.role==='EMPLOYEE';}).forEach(function(emp){addNotif(emp.id,'New Open Shift',tp[1]+' shift available on '+date+'.','info','openshift');});
  toast('Open shift posted.','success');closeModal();
}

// Task modals
var TASK_COLORS=['#6366f1','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#14b8a6','#a855f7','#06b6d4','#84cc16'];
function colorSwatchHtml(sel,fid){
  var h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" id="tc_'+fid+'">';
  TASK_COLORS.forEach(function(c){h+='<div onclick="pickTaskColor(\''+c+'\',\''+fid+'\')" style="width:22px;height:22px;border-radius:50%;background:'+c+';cursor:pointer;border:3px solid '+(c===sel?'var(--text)':'transparent')+';transition:.1s" data-color="'+c+'"></div>';});
  return h+'</div><input type="hidden" id="'+fid+'" value="'+(sel||'#6366f1')+'">';
}
function pickTaskColor(color,fid){var inp=document.getElementById(fid);if(inp)inp.value=color;var c=document.getElementById('tc_'+fid);if(c)c.querySelectorAll('div[data-color]').forEach(function(d){d.style.borderColor=d.getAttribute('data-color')===color?'var(--text)':'transparent';});}
function renderCreateTaskModal(){var body='<div class="form-group"><label>Task Name *</label><input id="tkName" placeholder="e.g. Skate Guard"></div><div class="form-group"><label>Description</label><textarea id="tkDesc" placeholder="What does this task involve?"></textarea></div><div class="form-group"><label>Color</label>'+colorSwatchHtml('#6366f1','tkColor')+'</div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createTask()">Create Task</button></div>';return modalWrap('Create Task',body);}
function createTask(){var name=((document.getElementById('tkName')||{}).value||'').trim();var desc=((document.getElementById('tkDesc')||{}).value||'').trim();var color=(document.getElementById('tkColor')||{}).value||'#6366f1';if(!name){toast('Task name is required.','error');return;}DB.tasks.push({id:nextId('t'),name:name,color:color,description:desc,active:true});toast('Task created.','success');closeModal();}
function renderEditTaskModal(id){var t=getTask(id);if(!t)return'';var body='<div class="form-group"><label>Task Name *</label><input id="tkName" value="'+esc(t.name)+'"></div><div class="form-group"><label>Description</label><textarea id="tkDesc">'+esc(t.description||'')+'</textarea></div><div class="form-group"><label>Color</label>'+colorSwatchHtml(t.color,'tkColor')+'</div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+id+'" onclick="updateTask(this)">Save</button></div>';return modalWrap('Edit Task',body);}
function updateTask(btn){var id=btn.getAttribute('data-id'),t=getTask(id);if(!t)return;var name=((document.getElementById('tkName')||{}).value||'').trim();if(!name){toast('Task name is required.','error');return;}t.name=name;t.description=((document.getElementById('tkDesc')||{}).value||'').trim();t.color=(document.getElementById('tkColor')||{}).value||t.color;DB.shifts.forEach(function(s){if(s.taskId===id){s.taskName=t.name;s.taskColor=t.color;}});DB.previewShifts.forEach(function(s){if(s.taskId===id){s.taskName=t.name;s.taskColor=t.color;}});toast('Task updated.','success');closeModal();}

// Publish modal
function renderPublishScheduleModal(){
  var u=state.currentUser;
  var body='<div class="publish-auth"><div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px">\uD83D\uDD10 Authentication Required</div>';
  body+='<div style="font-size:12px;color:var(--text2);margin-bottom:14px">Publishing will make '+DB.previewShifts.length+' preview shift'+(DB.previewShifts.length!==1?'s':'')+' live. All employees will be notified.</div>';
  body+='<div class="form-group"><label>Your Full Name</label><input id="pubName" placeholder="'+esc(u.name)+'" autocomplete="off"></div>';
  body+='<div class="form-group"><label>Your Password</label><input type="password" id="pubPass" autocomplete="current-password"></div></div>';
  body+='<div id="publishResult"></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="executePublish()">\u2192 Publish Schedule</button></div>';
  return modalWrap('Publish Schedule',body);
}
function executePublish(){
  var nameIn=((document.getElementById('pubName')||{}).value||'').trim();
  var passIn=(document.getElementById('pubPass')||{}).value||'';
  var res=document.getElementById('publishResult');
  var u=state.currentUser;
  if(!nameIn||!passIn){if(res)res.innerHTML='<div class="publish-result denied">All fields are required.</div>';return;}
  if(nameIn.toLowerCase()!==u.name.toLowerCase()||passIn!==u.password){if(res)res.innerHTML='<div class="publish-result denied">\uD83D\uDEAB Denied — incorrect credentials.</div>';return;}
  if(!DB.previewShifts.length){if(res)res.innerHTML='<div class="publish-result error">\u26A0\uFE0F No preview shifts to publish.</div>';return;}
  try{
    DB.previewShifts.forEach(function(s){var c=JSON.parse(JSON.stringify(s));c.id=nextId('s');DB.shifts.push(c);});
    var count=DB.previewShifts.length;DB.previewShifts=[];
    DB.users.filter(function(x){return x.status==='ACTIVE';}).forEach(function(emp){addNotif(emp.id,'Schedule Published','A new schedule has been published. Check your shifts!','info','schedule');});
    DB.auditLog.push({id:nextId('a'),userId:u.id,action:'SCHEDULE_PUBLISHED',entityType:'Schedule',entityId:'',createdAt:now()});
    if(res)res.innerHTML='<div class="publish-result success">\u2705 Schedule Published Successfully<br><span style="font-size:13px;font-weight:400">'+count+' shift'+(count!==1?'s':'')+' moved to live schedule</span></div>';
    setTimeout(function(){closeModal();navigate('schedule');},2000);
  }catch(e){if(res)res.innerHTML='<div class="publish-result error">\u274C Error: '+e.message+'</div>';}
}

// User modals
function renderCreateUserModal(){var body='<div class="form-row"><div class="form-group"><label>Full Name *</label><input id="uName" placeholder="Jane Smith" autocomplete="off"></div><div class="form-group"><label>Email *</label><input type="email" id="uEmail" placeholder="jane@company.com" autocomplete="off"></div></div><div class="form-row"><div class="form-group"><label>Password *</label><input type="password" id="uPass" placeholder="Min 8 chars"></div><div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></div></div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createUser()">Create User</button></div>';return modalWrap('Create User',body);}
function createUser(){var name=((document.getElementById('uName')||{}).value||'').trim(),email=((document.getElementById('uEmail')||{}).value||'').trim().toLowerCase();var pass=(document.getElementById('uPass')||{}).value||'',role=(document.getElementById('uRole')||{}).value||'EMPLOYEE';if(!name){toast('Full name is required.','error');return;}if(!validateEmail(email)){toast('Enter a valid email.','error');return;}var pwErr=validatePassword(pass);if(pwErr){toast(pwErr,'error');return;}if(DB.users.find(function(u){return u.email.toLowerCase()===email;})){toast('Email already registered.','error');return;}var col=AV_COLORS[DB.users.length%AV_COLORS.length];var user={id:nextId('u'),name:name,email:email,password:pass,role:role,status:'ACTIVE',avatarColor:col,createdAt:now()};DB.users.push(user);AVAIL_DAYS.forEach(function(wd){DB.availability.push({id:nextId('av'),userId:user.id,dayOfWeek:wd.idx,startTime:'09:00',endTime:'17:00',isAvailable:false});});toast('User '+name+' created.','success');closeModal();}
function renderEditUserModal(id){var u=getUser(id);if(!u)return modalWrap('Not Found','<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>');var body='<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:14px;background:var(--bg3);border-radius:10px"><div class="avatar avatar-lg" style="background:'+esc(u.avatarColor)+'">'+esc(initials(u.name))+'</div><div><div style="font-weight:700;font-size:15px">'+esc(u.name)+'</div><div style="font-size:12px;color:var(--text2)">'+esc(u.email)+'</div></div></div>';body+='<div class="form-row"><div class="form-group"><label>Full Name</label><input id="uName" value="'+esc(u.name)+'"></div><div class="form-group"><label>Role</label><select id="uRole"><option value="EMPLOYEE"'+(u.role==='EMPLOYEE'?' selected':'')+'>Employee</option><option value="MANAGER"'+(u.role==='MANAGER'?' selected':'')+'>Manager</option><option value="ADMIN"'+(u.role==='ADMIN'?' selected':'')+'>Admin</option></select></div></div>';body+='<div class="form-group"><label>New Password <span style="color:var(--text3);font-size:11px">(leave blank to keep)</span></label><input type="password" id="uPass" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"></div>';body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" data-id="'+id+'" onclick="updateUserSubmit(this)">Save</button></div>';return modalWrap('Edit User',body);}
function updateUserSubmit(btn){updateUser(btn.getAttribute('data-id')||'');}
function updateUser(id){var u=getUser(id);if(!u)return;var name=((document.getElementById('uName')||{}).value||'').trim(),role=(document.getElementById('uRole')||{}).value;var pass=(document.getElementById('uPass')||{}).value||'';if(!name){toast('Name cannot be empty.','error');return;}if(pass){var err=validatePassword(pass);if(err){toast(err,'error');return;}u.password=pass;}u.name=name;u.role=role;toast('User updated.','success');closeModal();}


// ─── ATTENDANCE SYSTEM (absence-only tracking) ────────────────────
function renderMarkAbsentModal(shiftId, empId){
  var s=getShift(shiftId),emp=getUser(empId);
  if(!s||!emp)return'';
  var body='<div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:18px">';
  body+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  body+='<div class="avatar avatar-sm" style="background:'+esc(emp.avatarColor)+'">'+esc(initials(emp.name))+'</div>';
  body+='<div><div style="font-weight:600;color:var(--text)">'+esc(emp.name)+'</div>';
  body+='<div style="font-size:12px;color:var(--text2)">'+fmtDateLabel(s.date)+' \u00B7 '+fmtRange(s.startTime,s.endTime)+'</div></div></div>';
  body+='</div>';
  body+='<div class="form-group"><label>Absence Type *</label><select id="absType">';
  [['called_out','Called Out'],['no_show','No Show'],['emergency','Emergency']].forEach(function(o){
    body+='<option value="'+o[0]+'">'+o[1]+'</option>';
  });
  body+='</select></div>';
  body+='<div class="form-group"><label>Notes (optional)</label><textarea id="absNotes" placeholder="Any additional context..."></textarea></div>';
  body+='<div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>';
  body+='<button class="btn btn-danger" data-sid="'+shiftId+'" data-eid="'+empId+'" onclick="executeMarkAbsent(this)">Mark Absent</button></div>';
  return modalWrap('Mark Absence',body);
}
function executeMarkAbsent(btn){
  var sid=btn.getAttribute('data-sid'),eid=btn.getAttribute('data-eid');
  var s=getShift(sid);if(!s)return;
  var type=(document.getElementById('absType')||{}).value||'no_show';
  var notes=((document.getElementById('absNotes')||{}).value||'').trim();
  // Remove any existing log for same shift+emp
  DB.attendanceLog=DB.attendanceLog.filter(function(a){return!(a.shiftId===sid&&a.employeeId===eid);});
  DB.attendanceLog.push({
    id:nextId('att'),shiftId:sid,employeeId:eid,date:s.date,
    status:type,reason:type,notes:notes,
    markedById:state.currentUser.id,markedAt:now()
  });
  var emp=getUser(eid);
  addNotif(eid,'Attendance Noted',
    'An absence has been recorded for your shift on '+s.date+'.',
    'info','schedule');
  DB.auditLog.push({id:nextId('a'),userId:state.currentUser.id,
    action:'ATTENDANCE_MARKED',entityType:'Shift',entityId:sid,createdAt:now()});
  toast('Absence recorded for '+(emp?emp.name:'employee')+'.','info');
  closeModal();
}
function getShiftAttendance(shiftId, empId){
  return DB.attendanceLog.find(function(a){return a.shiftId===shiftId&&a.employeeId===empId;});
}
function attendanceBadge(shiftId, empId){
  var a=getShiftAttendance(shiftId,empId);
  if(!a)return'';
  var labels={called_out:'Called Out',no_show:'No Show',emergency:'Emergency'};
  return'<span style="font-size:10px;background:rgba(239,68,68,.12);color:var(--red);padding:2px 7px;border-radius:4px;font-weight:700">'+(labels[a.status]||a.status)+'</span>';
}

// ─── EXPOSE + BOOT ────────────────────────────────────────────────
var expose=[
  'navigate','logout','handleLogin','handleRegister',
  'changeWeek','changeMonth','goToday','setView','setScheduleScope',
  'setReqTypeFilter','setReqFilter','addReqComment','approveRequest','acceptSwapReq','declineSwapReq','executeCancelRequest','executeRejectRequest',
  'openModal','closeModal','pickTaskColor',
  'viewShift','editShiftBtn','createShift','updateShift','deleteShiftConfirm','addShiftComment','submitCoverageFromShift','submitSwapRequest','volunteerOpenSwap',
  'renderMarketplace','renderMarketplaceCard','removeMarketplaceItem',
  'renderConfirmSwapAcceptModal','confirmSwapAccept','renderConfirmSwapApproveModal','finalizeSwapApproval',
  'renderAcceptShiftModal','executeAcceptShift',
  'renderMarkAbsentModal','executeMarkAbsent',
  'expireOpenSwaps',
  'approveOpenShiftReq','rejectOpenShiftReq','removeOpenShiftReq','submitClaimOpenShift','setClaimType','createOpenShift',
  'createUser','updateUser','updateUserSubmit','toggleStatusBtn','editUserBtn','filterUsers','setAdminTab',
  'toggleNotif','setNotifFilter','markAllRead','readAndNavigate',
  'saveProfile','savePassword',
  'setAvailTab','availToggle','submitAvailRequest','setTOType','submitTimeOff',
  'setSettingsTab','toggleSetting','setSettingNum','toggleTaskActive','createTask','updateTask',
  'executePublish',
];
var fns={navigate:navigate,logout:logout,handleLogin:handleLogin,handleRegister:handleRegister,changeWeek:changeWeek,changeMonth:changeMonth,goToday:goToday,setView:setView,setScheduleScope:setScheduleScope,setReqTypeFilter:setReqTypeFilter,setReqFilter:setReqFilter,addReqComment:addReqComment,approveRequest:approveRequest,acceptSwapReq:acceptSwapReq,declineSwapReq:declineSwapReq,executeCancelRequest:executeCancelRequest,executeRejectRequest:executeRejectRequest,openModal:openModal,closeModal:closeModal,pickTaskColor:pickTaskColor,viewShift:viewShift,editShiftBtn:editShiftBtn,createShift:createShift,updateShift:updateShift,deleteShiftConfirm:deleteShiftConfirm,addShiftComment:addShiftComment,submitCoverageFromShift:submitCoverageFromShift,submitSwapRequest:submitSwapRequest,volunteerOpenSwap:volunteerOpenSwap,removeMarketplaceItem:removeMarketplaceItem,confirmSwapAccept:confirmSwapAccept,finalizeSwapApproval:finalizeSwapApproval,executeAcceptShift:executeAcceptShift,executeMarkAbsent:executeMarkAbsent,expireOpenSwaps:expireOpenSwaps,approveOpenShiftReq:approveOpenShiftReq,rejectOpenShiftReq:rejectOpenShiftReq,removeOpenShiftReq:removeOpenShiftReq,submitClaimOpenShift:submitClaimOpenShift,setClaimType:setClaimType,createOpenShift:createOpenShift,createUser:createUser,updateUser:updateUser,updateUserSubmit:updateUserSubmit,toggleStatusBtn:toggleStatusBtn,editUserBtn:editUserBtn,filterUsers:filterUsers,setAdminTab:setAdminTab,toggleNotif:toggleNotif,setNotifFilter:setNotifFilter,markAllRead:markAllRead,readAndNavigate:readAndNavigate,saveProfile:saveProfile,savePassword:savePassword,setAvailTab:setAvailTab,availToggle:availToggle,submitAvailRequest:submitAvailRequest,setTOType:setTOType,submitTimeOff:submitTimeOff,setSettingsTab:setSettingsTab,toggleSetting:toggleSetting,setSettingNum:setSettingNum,toggleTaskActive:toggleTaskActive,createTask:createTask,updateTask:updateTask,executePublish:executePublish};
expose.forEach(function(name){window[name]=fns[name];});

render();

})(); // end IIFE — ShiftWise v7.0
