/* Meal Check-In app connected to Supabase */
var S_BREAKFAST = "Breakfast";
var S_LUNCH = "Lunch";
var S_BREAKFAST4 = "Break-fast 4pm";
var S_SUPPER = "Supper";
var MEALS = [S_BREAKFAST, S_LUNCH, S_BREAKFAST4, S_SUPPER];
var REG_PATTERN = /^[0-9]{5}$/;
var MEALKEY = "mealNowServing_v2";

var db = null;
var currentUser = null;
var currentProfile = null;
var realtimeChannel = null;
var todayRows = [];
var nowServing = localStorage.getItem(MEALKEY) || "";
var isCheckingIn = false;

function byId(id){ return document.getElementById(id); }
function norm(s){ return String(s || "").toUpperCase().trim().replace(/\s+/g, ""); }
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function todayStr(){
  var d = new Date();
  var p = function(n){ return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function localTime(iso){
  if(!iso) return "";
  return new Date(iso).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function setBusy(button, busy, busyText){
  if(!button) return;
  if(busy){
    button.dataset.originalText = button.textContent;
    button.textContent = busyText || "Working...";
    button.disabled = true;
  }else{
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function setConnection(text, state){
  var el = byId("connectionStatus");
  if(!el) return;
  el.textContent = "● " + text;
  el.className = "status " + (state || "connecting");
}

function configIsReady(){
  var c = window.APP_CONFIG || {};
  return c.SUPABASE_URL &&
    c.SUPABASE_PUBLISHABLE_KEY &&
    c.SUPABASE_URL.indexOf("YOUR_PROJECT_REF") === -1 &&
    c.SUPABASE_PUBLISHABLE_KEY.indexOf("REPLACE_ME") === -1;
}

function showFatal(message){
  byId("loginError").textContent = message;
  byId("loginError").style.display = "block";
  byId("loginForm").style.display = "none";
}

async function init(){
  renderMeals();
  renderCounts();

  if(!configIsReady()){
    showFatal("Supabase is not configured yet. Open config.js, add your Project URL and Publishable key, then upload the files again.");
    return;
  }

  if(!window.supabase || !window.supabase.createClient){
    showFatal("The Supabase library could not be loaded. Check the internet connection and reload the page.");
    return;
  }

  db = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  var sessionResult = await db.auth.getSession();
  if(sessionResult.error){
    showLogin(sessionResult.error.message);
  }else if(sessionResult.data.session){
    await openApp(sessionResult.data.session.user);
  }else{
    showLogin();
  }

  db.auth.onAuthStateChange(function(event, session){
    setTimeout(async function(){
      if(session && session.user){
        await openApp(session.user);
      }else{
        closeApp();
        showLogin();
      }
    }, 0);
  });

  window.addEventListener("online", function(){
    setConnection("Connecting", "connecting");
    if(currentUser){
      loadToday();
      subscribeRealtime();
    }
  });
  window.addEventListener("offline", function(){ setConnection("Offline", "offline"); });
}

function showLogin(message){
  byId("loginScreen").style.display = "flex";
  byId("appWrap").style.display = "none";
  byId("loginForm").style.display = "block";
  var error = byId("loginError");
  if(message){
    error.textContent = message;
    error.style.display = "block";
  }else{
    error.textContent = "";
    error.style.display = "none";
  }
  setTimeout(function(){ byId("email").focus(); }, 50);
}

async function signIn(){
  var email = byId("email").value.trim();
  var password = byId("password").value;
  var button = byId("loginBtn");
  var error = byId("loginError");
  error.style.display = "none";

  if(!email || !password){
    error.textContent = "Enter both the email address and password.";
    error.style.display = "block";
    return;
  }

  setBusy(button, true, "Signing in...");
  var result = await db.auth.signInWithPassword({ email: email, password: password });
  setBusy(button, false);

  if(result.error){
    error.textContent = result.error.message;
    error.style.display = "block";
  }
}

async function signOut(){
  if(db) await db.auth.signOut();
}

async function loadProfile(user){
  var result = await db
    .from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", user.id)
    .single();

  if(result.error) throw result.error;
  if(!result.data.is_active) throw new Error("This staff account has been disabled.");
  return result.data;
}

async function openApp(user){
  currentUser = user;
  try{
    currentProfile = await loadProfile(user);
  }catch(error){
    await db.auth.signOut();
    showLogin(error.message || "Your staff profile could not be loaded.");
    return;
  }

  byId("loginScreen").style.display = "none";
  byId("appWrap").style.display = "block";
  byId("operatorName").textContent = currentProfile.display_name;
  byId("clearBtn").style.display = currentProfile.role === "admin" ? "block" : "none";
  setConnection(navigator.onLine ? "Connecting" : "Offline", navigator.onLine ? "connecting" : "offline");

  await loadToday();
  subscribeRealtime();
  byId("reg").focus();
}

function closeApp(){
  currentUser = null;
  currentProfile = null;
  todayRows = [];
  if(realtimeChannel && db){ db.removeChannel(realtimeChannel); }
  realtimeChannel = null;
  renderCounts();
}

function renderMeals(){
  var box = byId("meals");
  if(!box) return;
  box.innerHTML = "";
  MEALS.forEach(function(meal){
    var button = document.createElement("button");
    button.className = "meal" + (meal === nowServing ? " sel" : "");
    button.textContent = meal;
    button.onclick = function(){
      nowServing = meal;
      localStorage.setItem(MEALKEY, meal);
      renderMeals();
      byId("reg").focus();
    };
    box.appendChild(button);
  });
}

async function loadToday(){
  if(!db || !currentUser) return;
  var result = await db
    .from("check_ins")
    .select("id, student_id, meal_session, service_date, checked_in_at, students(registration_number, full_name), profiles(display_name)")
    .eq("service_date", todayStr())
    .order("checked_in_at", { ascending: true });

  if(result.error){
    setConnection(navigator.onLine ? "Sync error" : "Offline", navigator.onLine ? "error" : "offline");
    byId("dataWarn").textContent = "Could not load the shared check-ins: " + result.error.message;
    byId("dataWarn").style.display = "block";
    return;
  }

  todayRows = result.data || [];
  byId("dataWarn").style.display = "none";
  renderCounts();
  if(navigator.onLine) setConnection("Live sync", "online");
}

function subscribeRealtime(){
  if(!db || !currentUser || !navigator.onLine) return;
  if(realtimeChannel) db.removeChannel(realtimeChannel);

  realtimeChannel = db
    .channel("meal-check-ins-" + todayStr())
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "check_ins",
        filter: "service_date=eq." + todayStr()
      },
      function(){ loadToday(); }
    )
    .subscribe(function(status){
      if(status === "SUBSCRIBED") setConnection("Live sync", "online");
      else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("Sync error", "error");
      else setConnection("Connecting", "connecting");
    });
}

function renderCounts(){
  var counts = {};
  MEALS.forEach(function(meal){ counts[meal] = 0; });
  todayRows.forEach(function(row){
    if(Object.prototype.hasOwnProperty.call(counts, row.meal_session)) counts[row.meal_session]++;
  });

  var box = byId("counts");
  if(box){
    box.innerHTML = "";
    MEALS.forEach(function(meal){
      var card = document.createElement("div");
      card.className = "count";
      card.innerHTML = '<div class="n">' + counts[meal] + '</div><div class="l">' + esc(meal) + '</div>';
      box.appendChild(card);
    });
  }
  renderPlan();
}

function renderPlan(){
  var breakfast = {};
  var breakfast4 = {};
  todayRows.forEach(function(row){
    if(row.meal_session === S_BREAKFAST) breakfast[row.student_id] = true;
    if(row.meal_session === S_BREAKFAST4) breakfast4[row.student_id] = true;
  });

  var lunch = Object.keys(breakfast).length;
  var supperStudents = {};
  Object.keys(breakfast).forEach(function(id){ supperStudents[id] = true; });
  Object.keys(breakfast4).forEach(function(id){ supperStudents[id] = true; });
  var supper = Object.keys(supperStudents).length;

  var plan = byId("plan");
  if(plan){
    plan.innerHTML = '<span class="pk">To cook today</span>&nbsp;&nbsp; Lunch <b>' + lunch + '</b> &nbsp;&middot;&nbsp; Supper <b>' + supper + '</b>';
  }
}

function showRes(cls, ico, title, lines){
  var inner = byId("resInner");
  inner.className = "inner " + cls;
  inner.innerHTML = '<div class="ico">' + ico + '</div><h2>' + esc(title) + '</h2>' + lines + '<div class="tap">tap anywhere to continue</div>';
  byId("res").style.display = "flex";
  if(window._resultTimer) clearTimeout(window._resultTimer);
  window._resultTimer = setTimeout(hideRes, 3000);
}

function hideRes(){
  byId("res").style.display = "none";
  byId("reg").value = "";
  byId("reg").focus();
}

function nameBlock(name){ return name ? '<p class="bigname">' + esc(name) + '</p>' : ""; }
function regBlock(reg, hasName){ return '<p class="' + (hasName ? "small" : "big") + '">' + esc(reg) + '</p>'; }

async function doCheckIn(){
  if(isCheckingIn) return;
  var reg = norm(byId("reg").value);

  if(!currentUser){ showLogin("Your session has ended. Sign in again."); return; }
  if(!navigator.onLine){
    showRes("bad", "&#10005;", "No connection", "<p>This shared system needs an internet connection to save a check-in safely.</p>");
    return;
  }
  if(!nowServing){
    showRes("bad", "&#10005;", "Pick a session", "<p>Choose what you are serving, up top.</p>");
    return;
  }
  if(!reg){ byId("reg").focus(); return; }
  if(!REG_PATTERN.test(reg)){
    showRes("bad", "&#10005;", "Check the number", '<p class="big">' + esc(reg) + '</p><p>That is not a 5-digit number.</p>');
    return;
  }

  var button = byId("checkInBtn");
  isCheckingIn = true;
  setBusy(button, true, "Saving...");

  var result = await db.rpc("check_in_student", {
    p_registration_number: reg,
    p_meal_session: nowServing,
    p_service_date: todayStr()
  });

  isCheckingIn = false;
  setBusy(button, false);

  if(result.error){
    showRes("bad", "&#10005;", "Could not save", "<p>" + esc(result.error.message) + "</p>");
    return;
  }

  var data = result.data || {};
  var name = data.full_name || "";
  var number = data.registration_number || reg;

  if(data.status === "checked_in"){
    showRes(
      "ok",
      "&#10003;",
      "Checked in",
      nameBlock(name) + regBlock(number, !!name) + '<p>' + esc(data.meal_session) + '</p><p>' + esc(localTime(data.checked_in_at)) + '</p>'
    );
    await loadToday();
    return;
  }

  if(data.status === "duplicate"){
    showRes(
      "dup",
      "&#9888;",
      "Already checked in",
      nameBlock(name) + regBlock(number, !!name) + '<p>' + esc(data.meal_session || nowServing) + ' &middot; today</p><p>First check-in at ' + esc(localTime(data.first_checked_in_at)) + '</p>'
    );
    await loadToday();
    return;
  }

  if(data.status === "not_eligible"){
    showRes(
      "bad",
      "&#10005;",
      "Not eligible",
      nameBlock(name) + regBlock(number, !!name) + '<p>' + esc(data.message || "The required earlier meal was not found.") + '</p>'
    );
    return;
  }

  if(data.status === "not_found"){
    showRes("bad", "&#10005;", "Not on the list", regBlock(number, false) + '<p>' + esc(data.message) + '</p>');
    return;
  }

  showRes("bad", "&#10005;", "Check-in not saved", "<p>" + esc(data.message || "Please try again.") + "</p>");
}

/* Camera scanning: BarcodeDetector fast path, jsQR fallback */
var cameraStream = null;
var scanning = false;
var detector = null;
var scanCanvas = document.createElement("canvas");
var scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

async function startScan(){
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  }catch(error){
    alert("Camera not available here. You can still type the registration number.");
    return;
  }

  var video = byId("video");
  video.srcObject = cameraStream;
  try{ await video.play(); }catch(error){}
  byId("cam").style.display = "flex";
  scanning = true;

  if("BarcodeDetector" in window){
    try{ detector = new BarcodeDetector({ formats: ["qr_code"] }); }
    catch(error){ detector = null; }
  }
  requestAnimationFrame(scanTick);
}

function stopScan(){
  scanning = false;
  byId("cam").style.display = "none";
  if(cameraStream){
    cameraStream.getTracks().forEach(function(track){ track.stop(); });
    cameraStream = null;
  }
}

async function scanTick(){
  if(!scanning) return;
  var video = byId("video");
  if(video.readyState === video.HAVE_ENOUGH_DATA){
    var code = null;
    if(detector){
      try{
        var found = await detector.detect(video);
        if(found && found.length) code = found[0].rawValue;
      }catch(error){}
    }

    if(!code){
      scanCanvas.width = video.videoWidth;
      scanCanvas.height = video.videoHeight;
      scanContext.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
      try{
        var image = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
        var qr = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if(qr && qr.data) code = qr.data;
      }catch(error){}
    }

    if(code){ onScan(code); return; }
  }
  requestAnimationFrame(scanTick);
}

function onScan(text){
  var reg = text;
  var match = /[?&]reg=([^&]+)/i.exec(text);
  if(match) reg = decodeURIComponent(match[1]);
  stopScan();
  byId("reg").value = norm(reg);
  doCheckIn();
}

/* CSV export */
function download(name, text){
  var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(function(){ URL.revokeObjectURL(link.href); }, 1000);
}

function csvCell(value){
  var text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function exportRowsToCsv(rows, label){
  if(!rows.length){ alert("Nothing to export yet."); return; }
  var output = [["Date", "Time", "Reg Number", "Name", "Session", "Kitchen Head"]];
  rows.forEach(function(row){
    output.push([
      row.service_date,
      localTime(row.checked_in_at),
      row.registration_number,
      row.full_name,
      row.meal_session,
      row.checked_in_by
    ]);
  });
  var csv = output.map(function(row){ return row.map(csvCell).join(","); }).join("\n");
  download("meal-checkins-" + label + ".csv", csv);
}

async function fetchExportPage(from, to, serviceDate){
  var query = db
    .from("check_in_export")
    .select("service_date, checked_in_at, registration_number, full_name, meal_session, checked_in_by")
    .order("checked_in_at", { ascending: true })
    .range(from, to);
  if(serviceDate) query = query.eq("service_date", serviceDate);
  return query;
}

async function exportCsv(which){
  if(!db || !currentUser) return;
  var pageSize = 1000;
  var from = 0;
  var rows = [];
  var serviceDate = which === "today" ? todayStr() : null;

  while(true){
    var result = await fetchExportPage(from, from + pageSize - 1, serviceDate);
    if(result.error){ alert("Export failed: " + result.error.message); return; }
    var page = result.data || [];
    rows = rows.concat(page);
    if(page.length < pageSize) break;
    from += pageSize;
  }

  exportRowsToCsv(rows, which === "today" ? todayStr() : "all");
}

async function clearToday(){
  if(!currentProfile || currentProfile.role !== "admin") return;
  var ok = confirm("Delete every check-in for today from the shared database? This cannot be undone. Export first if you need a record.");
  if(!ok) return;

  var result = await db.rpc("delete_check_ins_for_date", { p_service_date: todayStr() });
  if(result.error){ alert("Could not clear today: " + result.error.message); return; }
  await loadToday();
  alert(String(result.data || 0) + " check-ins deleted.");
}

byId("loginForm").addEventListener("submit", function(event){
  event.preventDefault();
  signIn();
});
byId("reg").addEventListener("keydown", function(event){
  if(event.key === "Enter") doCheckIn();
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(function(){});
}

init();
