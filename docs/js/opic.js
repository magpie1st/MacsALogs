/* OPIc 음원 페이지 — 재생목록 렌더링 + 하단 고정 플레이어 */
(function () {
  'use strict';

  var SPEEDS = [0.75, 0.9, 1.0, 1.25, 1.5];
  var STORE_KEY = 'opic-player-prefs';

  var audio = new Audio();
  var tracks = [];        // 평탄화된 재생목록
  var current = -1;
  var speedIndex = 2;
  var looping = false;

  var el = {};

  /* ── 저장된 환경설정 (실패해도 페이지는 정상 동작해야 한다) ── */
  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof saved.speedIndex === 'number' && SPEEDS[saved.speedIndex]) speedIndex = saved.speedIndex;
      if (typeof saved.looping === 'boolean') looping = saved.looping;
    } catch (e) { /* 시크릿 모드 등: 기본값 사용 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ speedIndex: speedIndex, looping: looping }));
    } catch (e) { /* 저장 실패는 무시 */ }
  }

  /* ── 유틸 ── */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 렌더링 ── */
  function renderList(data) {
    var listEl = document.getElementById('opic-list');
    var html = '';
    var order = 0;

    data.topics.forEach(function (topic) {
      html += '<section class="opic-topic">';
      html += '<h2 class="opic-topic-name">' + escapeHtml(topic.topic) + '</h2>';

      topic.stories.forEach(function (story) {
        var id = order++;
        tracks.push({ title: story.title, topic: topic.topic, audio: story.audio });

        html += '<article class="opic-track" id="track-' + id + '">';
        html += '<button type="button" class="opic-track-main" data-track="' + id + '">';
        html += '<span class="opic-track-icon" aria-hidden="true">▶</span>';
        html += '<span class="opic-track-text">';
        html += '<span class="opic-track-title">' + escapeHtml(story.title) + '</span>';
        html += '<span class="opic-track-meta">' + formatTime(story.duration) +
                ' · ' + Math.round(story.bytes / 1024 / 102.4) / 10 + 'MB</span>';
        html += '</span></button>';

        html += '<div class="opic-track-foot">';
        html += '<button type="button" class="opic-script-toggle" data-script="' + id + '" aria-expanded="false">스크립트 보기</button>';
        html += '<div class="opic-script" id="script-' + id + '" hidden>' +
                story.paragraphs.map(function (p) { return '<p>' + escapeHtml(p) + '</p>'; }).join('') +
                '</div>';
        html += '</div></article>';
      });

      html += '</section>';
    });

    listEl.innerHTML = html;
  }

  function renderStats(data) {
    var count = 0, seconds = 0;
    data.topics.forEach(function (topic) {
      topic.stories.forEach(function (story) { count++; seconds += story.duration; });
    });
    document.getElementById('opic-stats').innerHTML =
      ['스토리 ' + count + '개',
       '총 ' + Math.round(seconds / 60) + '분',
       'Kokoro ' + data.voice,
       '갱신 ' + data.generated]
      .map(function (s) { return '<span class="opic-stat">' + escapeHtml(s) + '</span>'; }).join('');
  }

  /* ── 플레이어 ── */
  function markPlaying() {
    var previous = document.querySelector('.opic-track.is-playing');
    if (previous) {
      previous.classList.remove('is-playing');
      previous.querySelector('.opic-track-icon').textContent = '▶︎';
    }
    if (current < 0) return;
    var node = document.getElementById('track-' + current);
    if (node) {
      node.classList.add('is-playing');
      node.querySelector('.opic-track-icon').textContent = audio.paused ? '▶︎' : '❚❚';
    }
  }

  function updatePlayButton() {
    el.play.textContent = audio.paused ? '▶︎' : '❚❚';
    el.play.setAttribute('aria-label', audio.paused ? '재생' : '일시정지');
    markPlaying();
  }

  /* 목록 끝에서 반대편으로 넘어간다 (전체 순환) */
  function wrap(index) {
    var n = tracks.length;
    return ((index % n) + n) % n;
  }

  function play(index) {
    if (!tracks.length) return;
    index = wrap(index);
    if (index !== current) {
      current = index;
      audio.src = tracks[index].audio;
      el.title.textContent = tracks[index].title;
      el.topic.textContent = tracks[index].topic;
      el.seek.value = 0;
      el.elapsed.textContent = '0:00';
      el.total.textContent = '0:00';
    }
    audio.playbackRate = SPEEDS[speedIndex];
    document.body.classList.add('has-player');
    el.player.hidden = false;
    audio.play().catch(function (err) { console.error('재생 실패', err); });
  }

  function toggle(index) {
    if (index === current && !audio.paused) { audio.pause(); return; }
    play(index);
  }

  function bindControls() {
    el.play.addEventListener('click', function () {
      if (current < 0) { play(0); return; }
      if (audio.paused) { audio.play(); } else { audio.pause(); }
    });
    el.prev.addEventListener('click', function () { play(current - 1); });
    el.next.addEventListener('click', function () { play(current + 1); });

    el.back.addEventListener('click', function () {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });

    el.speed.addEventListener('click', function () {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      audio.playbackRate = SPEEDS[speedIndex];
      el.speed.textContent = SPEEDS[speedIndex] + '×';
      savePrefs();
    });

    el.loop.addEventListener('change', function () {
      looping = el.loop.checked;
      audio.loop = looping;
      savePrefs();
    });

    el.seek.addEventListener('input', function () {
      if (isFinite(audio.duration)) audio.currentTime = (el.seek.value / 1000) * audio.duration;
    });

    audio.addEventListener('loadedmetadata', function () {
      el.total.textContent = formatTime(audio.duration);
    });
    audio.addEventListener('timeupdate', function () {
      if (!isFinite(audio.duration)) return;
      el.seek.value = (audio.currentTime / audio.duration) * 1000;
      el.elapsed.textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener('play', updatePlayButton);
    audio.addEventListener('pause', updatePlayButton);
    // 반복이 켜져 있으면 audio.loop가 처리하므로 ended 자체가 발생하지 않는다.
    // 꺼져 있을 때만 다음 곡으로 넘어가고, 마지막 곡 뒤에는 처음으로 돌아간다.
    audio.addEventListener('ended', function () {
      play(current + 1);
    });
    audio.addEventListener('error', function () {
      el.topic.textContent = '음원을 불러오지 못했습니다';
    });

    document.getElementById('opic-list').addEventListener('click', function (event) {
      var trackBtn = event.target.closest('[data-track]');
      if (trackBtn) { toggle(Number(trackBtn.dataset.track)); return; }

      var scriptBtn = event.target.closest('[data-script]');
      if (scriptBtn) {
        var panel = document.getElementById('script-' + scriptBtn.dataset.script);
        var open = panel.hidden;
        panel.hidden = !open;
        scriptBtn.textContent = open ? '스크립트 숨기기' : '스크립트 보기';
        scriptBtn.setAttribute('aria-expanded', String(open));
      }
    });

    // 데스크톱 편의: 스페이스바 재생/일시정지
    document.addEventListener('keydown', function (event) {
      if (event.code !== 'Space' || event.target.matches('input, textarea, button')) return;
      if (current < 0) return;
      event.preventDefault();
      if (audio.paused) { audio.play(); } else { audio.pause(); }
    });
  }

  function init() {
    var dataEl = document.getElementById('opic-data');
    var listEl = document.getElementById('opic-list');
    if (!dataEl || !listEl) return;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (e) {
      listEl.innerHTML = '<div class="empty-state"><p>재생목록을 불러올 수 없습니다.</p></div>';
      console.error(e);
      return;
    }
    if (!data.topics || !data.topics.length) {
      listEl.innerHTML = '<div class="empty-state"><p>아직 음원이 없습니다.</p></div>';
      return;
    }

    el = {
      player: document.getElementById('opic-player'),
      title: document.getElementById('opic-now-title'),
      topic: document.getElementById('opic-now-topic'),
      seek: document.getElementById('opic-seek'),
      elapsed: document.getElementById('opic-elapsed'),
      total: document.getElementById('opic-total'),
      play: document.getElementById('opic-play'),
      prev: document.getElementById('opic-prev'),
      next: document.getElementById('opic-next'),
      back: document.getElementById('opic-back'),
      speed: document.getElementById('opic-speed'),
      loop: document.getElementById('opic-loop')
    };

    loadPrefs();
    renderStats(data);
    renderList(data);

    audio.preload = 'metadata';
    audio.loop = looping;
    el.speed.textContent = SPEEDS[speedIndex] + '×';
    el.loop.checked = looping;

    bindControls();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
