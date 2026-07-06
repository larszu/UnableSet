/*
 * UnableSet Bridge — Weg B (Max for Live, [js]-Objekt, ES5).
 *
 * Implementiert die vom UnableSet-Host genutzte AbletonOSC-Teilmenge direkt
 * über die LiveAPI und pusht die Song-Position mit einem 20-ms-Task —
 * deutlich enger als das Remote-Script-Polling (Weg A). Der Host spricht
 * dieses Device mit denselben Adressen an:
 *
 *   node packages/server/dist/index.js --osc-port 11010 --osc-listen-port 11011
 *
 * Patch-Verdrahtung (siehe unableset-bridge.maxpat):
 *   [udpreceive 11010] → [js unableset-bridge.js] → [udpsend 127.0.0.1 11011]
 */

autowatch = 1;
inlets = 1;
outlets = 1;

var liveSet = null;
var pollTask = null;
var lastTime = -1;
var lastPlaying = -1;
var lastTempo = -1;

function bang() {
  init();
}

function init() {
  liveSet = new LiveAPI('live_set');
  if (pollTask) pollTask.cancel();
  pollTask = new Task(poll, this);
  pollTask.interval = 20; // ms — beat-genau genug für Quantisierung im Host
  pollTask.repeat();
  post('UnableSet-Bridge (Weg B) bereit\n');
}

function send(address, args) {
  var out = [address];
  if (args) {
    for (var i = 0; i < args.length; i++) out.push(args[i]);
  }
  outlet(0, out);
}

/** 20-ms-Poll: nur Änderungen pushen (Position, Playing, Tempo). */
function poll() {
  if (!liveSet) return;
  var time = Number(liveSet.get('current_song_time'));
  if (time !== lastTime) {
    lastTime = time;
    send('/live/song/get/current_song_time', [time]);
  }
  var playing = Number(liveSet.get('is_playing'));
  if (playing !== lastPlaying) {
    lastPlaying = playing;
    send('/live/song/get/is_playing', [playing]);
  }
  var tempo = Number(liveSet.get('tempo'));
  if (tempo !== lastTempo) {
    lastTempo = tempo;
    send('/live/song/get/tempo', [tempo]);
  }
}

/** Alle eingehenden OSC-Nachrichten landen hier (Adresse = Messagename). */
function anything() {
  var address = messagename;
  var args = arrayfromargs(arguments);
  if (!liveSet) init();

  switch (address) {
    case '/live/test':
      send('/live/test', ['ok']);
      break;
    case '/live/application/get/version': {
      var app = new LiveAPI('live_app');
      send('/live/application/get/version', [
        Number(app.call('get_major_version')),
        Number(app.call('get_minor_version')),
      ]);
      break;
    }

    // --- Song: Getter ---
    case '/live/song/get/tempo':
      send(address, [Number(liveSet.get('tempo'))]);
      break;
    case '/live/song/get/is_playing':
      send(address, [Number(liveSet.get('is_playing'))]);
      break;
    case '/live/song/get/current_song_time':
      send(address, [Number(liveSet.get('current_song_time'))]);
      break;
    case '/live/song/get/song_length':
      send(address, [Number(liveSet.get('song_length'))]);
      break;
    case '/live/song/get/signature_numerator':
      send(address, [Number(liveSet.get('signature_numerator'))]);
      break;
    case '/live/song/get/signature_denominator':
      send(address, [Number(liveSet.get('signature_denominator'))]);
      break;
    case '/live/song/get/num_tracks': {
      send(address, [trackCount()]);
      break;
    }
    case '/live/song/get/track_names': {
      var names = [];
      var count = trackCount();
      for (var t = 0; t < count; t++) {
        names.push(String(trackApi(t).get('name')));
      }
      send(address, names);
      break;
    }
    case '/live/song/get/cue_points': {
      var out = [];
      var cueIds = liveSet.get('cue_points');
      // LiveAPI liefert ["id", 1, "id", 2, …]
      for (var c = 1; c < cueIds.length; c += 2) {
        var cue = new LiveAPI('id ' + cueIds[c]);
        out.push(String(cue.get('name')));
        out.push(Number(cue.get('time')));
      }
      send(address, out);
      break;
    }

    // --- Song: Transport & Setter ---
    case '/live/song/start_playing':
      liveSet.call('start_playing');
      break;
    case '/live/song/stop_playing':
      liveSet.call('stop_playing');
      break;
    case '/live/song/continue_playing':
      liveSet.call('continue_playing');
      break;
    case '/live/song/set/current_song_time':
      liveSet.set('current_song_time', Number(args[0]));
      break;
    case '/live/song/cue_point/jump': {
      var jumpIds = liveSet.get('cue_points');
      var index = Number(args[0]);
      var idPos = 1 + index * 2;
      if (idPos < jumpIds.length) {
        new LiveAPI('id ' + jumpIds[idPos]).call('jump');
      }
      break;
    }
    case '/live/song/set/loop':
      liveSet.set('loop', Number(args[0]));
      break;
    case '/live/song/set/loop_start':
      liveSet.set('loop_start', Number(args[0]));
      break;
    case '/live/song/set/loop_length':
      liveSet.set('loop_length', Number(args[0]));
      break;

    // --- Tracks / Mixer ---
    case '/live/track/get/name':
      send(address, [Number(args[0]), String(trackApi(Number(args[0])).get('name'))]);
      break;
    case '/live/track/get/volume':
      send(address, [Number(args[0]), Number(mixerApi(Number(args[0]), 'volume').get('value'))]);
      break;
    case '/live/track/set/volume':
      mixerApi(Number(args[0]), 'volume').set('value', Number(args[1]));
      break;
    case '/live/track/get/mute':
      send(address, [Number(args[0]), Number(trackApi(Number(args[0])).get('mute'))]);
      break;
    case '/live/track/set/mute':
      trackApi(Number(args[0])).set('mute', Number(args[1]));
      break;
    case '/live/track/get/solo':
      send(address, [Number(args[0]), Number(trackApi(Number(args[0])).get('solo'))]);
      break;
    case '/live/track/set/solo':
      trackApi(Number(args[0])).set('solo', Number(args[1]));
      break;
    case '/live/track/get/arrangement_clips': {
      var trackIndex = Number(args[0]);
      var clipsOut = [trackIndex];
      var clipIds = trackApi(trackIndex).get('arrangement_clips');
      for (var k = 1; k < clipIds.length; k += 2) {
        var clip = new LiveAPI('id ' + clipIds[k]);
        clipsOut.push(String(clip.get('name')));
        clipsOut.push(Number(clip.get('start_time')));
        clipsOut.push(Number(clip.get('length')));
      }
      send(address, clipsOut);
      break;
    }

    default:
      // start_listen/stop_listen: der 20-ms-Poll pusht ohnehin — ignorieren
      break;
  }
}

function trackCount() {
  var ids = liveSet.get('tracks');
  return Math.floor(ids.length / 2);
}

function trackApi(index) {
  return new LiveAPI('live_set tracks ' + index);
}

function mixerApi(index, device) {
  return new LiveAPI('live_set tracks ' + index + ' mixer_device ' + device);
}
