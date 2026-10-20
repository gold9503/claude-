(() => {
  "use strict";

  const DEFAULT_POS = { lat: 36.5684, lng: 128.7294, label: "안동시청" }; // 위치 권한이 없을 때 기준점
  const WX_CACHE_KEY = "gbgolf.wx.v1";
  const FEE_KEY = "gbgolf.fees.v1";
  const PREF_KEY = "gbgolf.prefs.v1";

  const $ = (s) => document.querySelector(s);
  const listEl = $("#list");
  const locStatus = $("#locStatus");
  const sortSel = $("#sortSel");
  const regionSel = $("#regionSel");
  const refreshBtn = $("#refreshBtn");

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 무시 */ }
    },
  };

  const state = {
    pos: null,          // { lat, lng, label }
    weather: {},        // courseId -> weather
    weatherTime: null,
    weatherError: null,
    fees: store.get(FEE_KEY, {}),
  };

  // ---------- 날씨 코드 (WMO) ----------
  const WMO = {
    0: ["☀️", "맑음"], 1: ["🌤️", "대체로 맑음"], 2: ["⛅", "구름 조금"], 3: ["☁️", "흐림"],
    45: ["🌫️", "안개"], 48: ["🌫️", "짙은 안개"],
    51: ["🌦️", "약한 이슬비"], 53: ["🌦️", "이슬비"], 55: ["🌧️", "강한 이슬비"],
    56: ["🌧️", "어는 이슬비"], 57: ["🌧️", "어는 이슬비"],
    61: ["🌦️", "약한 비"], 63: ["🌧️", "비"], 65: ["🌧️", "강한 비"],
    66: ["🌧️", "어는 비"], 67: ["🌧️", "강한 어는 비"],
    71: ["🌨️", "약한 눈"], 73: ["🌨️", "눈"], 75: ["❄️", "많은 눈"], 77: ["🌨️", "싸락눈"],
    80: ["🌦️", "소나기"], 81: ["🌧️", "강한 소나기"], 82: ["⛈️", "폭우"],
    85: ["🌨️", "눈 소나기"], 86: ["❄️", "강한 눈 소나기"],
    95: ["⛈️", "뇌우"], 96: ["⛈️", "뇌우·우박"], 99: ["⛈️", "강한 뇌우·우박"],
  };
  const wmo = (code) => WMO[code] || ["🌡️", "-"];

  // ---------- 유틸 ----------
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const won = (n) => (n == null || isNaN(n)) ? "-" : (n / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만원";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function feeOf(c) {
    const f = state.fees[c.id];
    return {
      weekday: f?.weekday ?? c.feeWeekday,
      weekend: f?.weekend ?? c.feeWeekend,
      custom: !!f,
    };
  }

  // 라운드 적합도 (0~100): 강수, 강수확률, 바람, 기온, 뇌우를 반영
  function golfScore(w) {
    if (!w) return null;
    let s = 100;
    if (w.precip > 0) s -= w.precip >= 2 ? 40 : 25;
    if (w.maxPop >= 60) s -= 30; else if (w.maxPop >= 30) s -= 15;
    if (w.wind >= 9) s -= 30; else if (w.wind >= 6) s -= 15; else if (w.wind >= 4) s -= 5;
    if (w.temp < 3 || w.temp > 34) s -= 30; else if (w.temp < 8 || w.temp > 31) s -= 15;
    if ([95, 96, 99].includes(w.code)) s -= 40;
    if ([71, 73, 75, 77, 85, 86].includes(w.code)) s -= 40;
    if ([45, 48].includes(w.code)) s -= 10;
    return Math.max(0, Math.min(100, s));
  }
  function scoreBadge(score) {
    if (score == null) return "";
    if (score >= 75) return `<span class="badge good">라운드 좋음 ${score}</span>`;
    if (score >= 50) return `<span class="badge ok">보통 ${score}</span>`;
    return `<span class="badge bad">비추천 ${score}</span>`;
  }

  // ---------- 위치 ----------
  function getPosition() {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, label: "현재 위치" }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
      );
    });
  }

  // ---------- 날씨 (Open-Meteo, API 키 불필요) ----------
  async function fetchWeather() {
    const lats = COURSES.map((c) => c.lat).join(",");
    const lngs = COURSES.map((c) => c.lng).join(",");
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${lats}&longitude=${lngs}`
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m"
      + "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m"
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"
      + "&wind_speed_unit=ms&timezone=Asia%2FSeoul&forecast_days=2";
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    let data = await res.json();
    if (!Array.isArray(data)) data = [data];

    const out = {};
    data.forEach((d, i) => {
      const c = COURSES[i];
      const cur = d.current;
      // 현재 시각 이후 12시간 예보
      const nowIdx = Math.max(0, d.hourly.time.findIndex((t) => t >= cur.time.slice(0, 13)));
      const hours = [];
      for (let k = nowIdx; k < Math.min(nowIdx + 12, d.hourly.time.length); k++) {
        hours.push({
          time: d.hourly.time[k].slice(11, 13) + "시",
          temp: d.hourly.temperature_2m[k],
          pop: d.hourly.precipitation_probability[k],
          code: d.hourly.weather_code[k],
          wind: d.hourly.wind_speed_10m[k],
        });
      }
      const next6 = hours.slice(0, 6);
      out[c.id] = {
        temp: cur.temperature_2m,
        feels: cur.apparent_temperature,
        humidity: cur.relative_humidity_2m,
        precip: cur.precipitation,
        code: cur.weather_code,
        wind: cur.wind_speed_10m,
        gust: cur.wind_gusts_10m,
        maxPop: Math.max(0, ...next6.map((h) => h.pop ?? 0)),
        tMax: d.daily.temperature_2m_max[0],
        tMin: d.daily.temperature_2m_min[0],
        sunset: d.daily.sunset[0]?.slice(11),
        hours,
      };
    });
    return out;
  }

  // ---------- 렌더링 ----------
  function sortedCourses() {
    const region = regionSel.value;
    const items = COURSES.filter((c) => !region || c.region === region).map((c) => {
      const w = state.weather[c.id];
      return {
        c, w,
        dist: state.pos ? haversineKm(state.pos, c) : null,
        score: golfScore(w),
        fee: feeOf(c),
      };
    });
    const by = sortSel.value;
    const cmp = {
      distance: (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9),
      weather: (a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.dist ?? 0) - (b.dist ?? 0),
      feeWeekday: (a, b) => a.fee.weekday - b.fee.weekday,
      feeWeekend: (a, b) => a.fee.weekend - b.fee.weekend,
      name: (a, b) => a.c.name.localeCompare(b.c.name, "ko"),
    }[by];
    return items.sort(cmp);
  }

  function render() {
    const items = sortedCourses();
    let html = "";
    if (state.weatherError) {
      html += `<p class="err">날씨를 불러오지 못했습니다 (${esc(state.weatherError)}).${state.weatherTime ? " 마지막으로 저장된 날씨를 표시합니다." : ""}</p>`;
    }
    for (const { c, w, dist, score, fee } of items) {
      const [icon, desc] = w ? wmo(w.code) : ["⏳", "날씨 불러오는 중"];
      const distHtml = dist == null ? `<b>-</b><small>위치 확인 중</small>`
        : `<b>${dist < 10 ? dist.toFixed(1) : Math.round(dist)}km</b><small>직선거리 · 약 ${Math.round(dist * 1.3 / 70 * 60)}분</small>`;
      const mapQ = encodeURIComponent(c.name);
      html += `
      <article class="card">
        <div class="card-head">
          <div>
            <h2 class="name">${esc(c.name)}</h2>
            <div class="meta">${esc(c.region)} · ${c.holes ? c.holes + "홀 · " : ""}${esc(c.type)}</div>
          </div>
          <div class="dist">${distHtml}</div>
        </div>
        <div class="wx">
          <span class="wx-icon">${icon}</span>
          <div>
            <div class="wx-temp">${w ? Math.round(w.temp) + "°" : "--"}</div>
            <div class="wx-desc">${esc(desc)}${w ? ` · 최저 ${Math.round(w.tMin)}° / 최고 ${Math.round(w.tMax)}°` : ""}</div>
          </div>
          ${scoreBadge(score)}
        </div>
        ${w ? `
        <div class="wx-grid">
          <div>체감<b>${Math.round(w.feels)}°</b></div>
          <div>바람<b>${w.wind.toFixed(1)}m/s</b></div>
          <div>강수확률<b>${w.maxPop}%</b></div>
          <div>습도<b>${w.humidity}%</b></div>
        </div>
        <div class="hourly">
          ${w.hours.map((h) => `<div>${h.time}<span class="ic">${wmo(h.code)[0]}</span>${Math.round(h.temp)}°<br>☔${h.pop ?? 0}%</div>`).join("")}
        </div>
        <div class="note">돌풍 최대 ${w.gust.toFixed(1)}m/s · 일몰 ${esc(w.sunset)}</div>` : ""}
        <div class="fee${fee.custom ? " custom" : ""}" data-fee="${c.id}" role="button" tabindex="0">
          <div>주중 그린피<b>${won(fee.weekday)}</b></div>
          <div>주말 그린피<b>${won(fee.weekend)}</b></div>
          <span class="edit">✏️ 수정</span>
        </div>
        <div class="actions">
          <a class="primary" href="https://map.kakao.com/link/search/${mapQ}" target="_blank" rel="noopener">🗺️ 지도·길찾기</a>
          ${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^0-9]/g, ""))}">📞 예약 전화</a>` : `<a href="https://search.naver.com/search.naver?query=${mapQ}+예약" target="_blank" rel="noopener">🔎 예약 검색</a>`}
        </div>
        <div class="note">${esc(c.address)}${c.note ? " · " + esc(c.note) : ""}</div>
      </article>`;
    }
    listEl.innerHTML = html || `<p class="skeleton">해당 지역에 골프장이 없습니다.</p>`;
  }

  function updateLocStatus() {
    const parts = [];
    if (state.pos) parts.push(state.pos.label === "현재 위치" ? "📍 현재 위치 기준" : `📍 위치 권한 없음 → ${state.pos.label} 기준`);
    if (state.weatherTime) {
      const t = new Date(state.weatherTime);
      parts.push(`날씨 ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")} 업데이트`);
    }
    locStatus.textContent = parts.join(" · ") || "불러오는 중…";
  }

  // ---------- 그린피 수정 ----------
  const dlg = $("#feeDlg");
  let editingId = null;
  listEl.addEventListener("click", (e) => {
    const el = e.target.closest("[data-fee]");
    if (!el) return;
    editingId = el.dataset.fee;
    const c = COURSES.find((x) => x.id === editingId);
    const f = feeOf(c);
    $("#feeDlgTitle").textContent = `${c.name} 그린피`;
    $("#feeWd").value = f.weekday;
    $("#feeWe").value = f.weekend;
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (!editingId) return;
    if (dlg.returnValue === "save") {
      const wd = parseInt($("#feeWd").value, 10), we = parseInt($("#feeWe").value, 10);
      if (!isNaN(wd) && !isNaN(we)) state.fees[editingId] = { weekday: wd, weekend: we };
    } else if (dlg.returnValue === "reset") {
      delete state.fees[editingId];
    }
    store.set(FEE_KEY, state.fees);
    editingId = null;
    render();
  });

  // ---------- 초기화 ----------
  function initControls() {
    const regions = [...new Set(COURSES.map((c) => c.region))].sort((a, b) => a.localeCompare(b, "ko"));
    regionSel.insertAdjacentHTML("beforeend", regions.map((r) => `<option>${esc(r)}</option>`).join(""));
    const prefs = store.get(PREF_KEY, {});
    if (prefs.sort) sortSel.value = prefs.sort;
    if (prefs.region && regions.includes(prefs.region)) regionSel.value = prefs.region;
    const save = () => { store.set(PREF_KEY, { sort: sortSel.value, region: regionSel.value }); render(); };
    sortSel.addEventListener("change", save);
    regionSel.addEventListener("change", save);
    refreshBtn.addEventListener("click", refresh);
  }

  async function refresh() {
    refreshBtn.classList.add("spin");
    locStatus.textContent = "위치·날씨 불러오는 중…";
    const [pos, wx] = await Promise.allSettled([getPosition(), fetchWeather()]);
    state.pos = (pos.status === "fulfilled" && pos.value) || DEFAULT_POS;
    if (wx.status === "fulfilled") {
      state.weather = wx.value;
      state.weatherTime = Date.now();
      state.weatherError = null;
      store.set(WX_CACHE_KEY, { time: state.weatherTime, data: state.weather });
    } else {
      state.weatherError = navigator.onLine ? (wx.reason?.message || "오류") : "오프라인";
    }
    refreshBtn.classList.remove("spin");
    updateLocStatus();
    render();
  }

  // 홈 화면 설치 버튼 (안드로이드 크롬)
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("#installBtn").hidden = false;
  });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("#installBtn").hidden = true;
  });

  const inAndroidApp = navigator.userAgent.includes("GolfWeatherApp"); // APK(WebView) 안에서 실행 중
  if ("serviceWorker" in navigator && !inAndroidApp) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // 30분 이상 지난 화면으로 돌아오면 자동 새로고침
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.weatherTime && Date.now() - state.weatherTime > 30 * 60 * 1000) refresh();
  });

  initControls();
  const cached = store.get(WX_CACHE_KEY, null);
  if (cached) { state.weather = cached.data; state.weatherTime = cached.time; }
  render();
  refresh();
})();
